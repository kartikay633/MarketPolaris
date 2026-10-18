"""LoRA fine-tune of a local Qwen model to read NSE disclosures (research).

Runs in the separate CUDA environment (D:/MarketPulseML/venv), not .venv-pulse:
  D:/MarketPulseML/venv/Scripts/python.exe ml/news_finetune.py --data D:/MarketPulseML/news_dataset.csv --out D:/MarketPulseML/runs/qwen05-news

Two outputs trained jointly (multi-label BCE): big_move (first-session move above
1.5 sigma) and drift5_up (abnormal return from the next open over 5 sessions).
Chronological split from ml.news_text_baseline; the test period is scored once
after training, and results are compared with the TF-IDF baseline on the same rows.
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
import pandas as pd
import torch
from peft import LoraConfig, get_peft_model
from sklearn.metrics import roc_auc_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_cosine_schedule_with_warmup

TARGETS = ["big_move", "drift5_up"]


def batches(frame, tok, size, max_len, shuffle, seed=0):
    idx = np.random.default_rng(seed).permutation(len(frame)) if shuffle else np.arange(len(frame))
    for i in range(0, len(idx), size):
        part = frame.iloc[idx[i:i + size]]
        enc = tok(part.doc.tolist(), truncation=True, max_length=max_len, padding=True, return_tensors="pt")
        yield enc, torch.tensor(part[TARGETS].to_numpy(), dtype=torch.float32)


@torch.no_grad()
def predict(model, tok, frame, max_len, size=64):
    model.eval()
    out = []
    for enc, _ in batches(frame, tok, size, max_len, False):
        enc = {k: v.cuda() for k, v in enc.items()}
        with torch.autocast("cuda", dtype=torch.float16):
            out.append(torch.sigmoid(model(**enc).logits.float()).cpu().numpy())
    model.train()
    return np.concatenate(out)


def metrics(frame, p):
    res = {}
    for j, t in enumerate(TARGETS):
        y, q = frame[t].to_numpy(), p[:, j]
        thr = .5
        top = np.argsort(-np.abs(q - np.median(q)))[: max(1, len(q) // 10)]
        res[t] = {"auc": float(roc_auc_score(y, q)), "accuracy": float(((q >= thr) == y).mean()),
                  "accuracyConfident10pct": float(((q[top] >= np.median(q)) == y[top]).mean()) if t == "drift5_up" else float(((q[top] >= thr) == y[top]).mean()),
                  "majorityAccuracy": float(max(y.mean(), 1 - y.mean())), "samples": int(len(y))}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B")
    ap.add_argument("--train-rows", type=int, default=60000)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-4)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    torch.manual_seed(271828)
    d = pd.read_csv(args.data)
    d["doc"] = d.doc.fillna("").astype(str)
    train = d[d.split == "train"].sample(min(args.train_rows, (d.split == "train").sum()), random_state=271828)
    valid = d[d.split == "valid"].sample(min(8000, (d.split == "valid").sum()), random_state=1)
    test = d[d.split == "test"]
    tok = AutoTokenizer.from_pretrained(args.model)
    tok.padding_side = "right"
    model = AutoModelForSequenceClassification.from_pretrained(args.model, num_labels=len(TARGETS), problem_type="multi_label_classification",
                                                               torch_dtype=torch.float32)
    model.config.pad_token_id = tok.pad_token_id
    model = get_peft_model(model, LoraConfig(task_type="SEQ_CLS", r=16, lora_alpha=32, lora_dropout=.05,
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()
    model.cuda().train()
    model.gradient_checkpointing_enable() if hasattr(model, "gradient_checkpointing_enable") else None
    steps = int(len(train) / args.batch * args.epochs)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=.01)
    sched = get_cosine_schedule_with_warmup(opt, int(steps * .05), steps)
    scaler = torch.amp.GradScaler("cuda")
    loss_fn = torch.nn.BCEWithLogitsLoss()  # unweighted, so probabilities stay comparable with the baselines
    step, started, log = 0, time.time(), []
    epoch = 0
    while step < steps:
        for enc, y in batches(train, tok, args.batch, args.max_len, True, seed=epoch):
            enc, y = {k: v.cuda() for k, v in enc.items()}, y.cuda()
            with torch.autocast("cuda", dtype=torch.float16):
                logits = model(**enc).logits.float()
            loss = loss_fn(logits, y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
            scaler.step(opt)
            scaler.update()
            sched.step()
            step += 1
            if step % 200 == 0:
                rate = step / (time.time() - started)
                print(f"step {step}/{steps} loss {loss.item():.4f} {rate:.2f} it/s ~{(steps - step) / rate / 60:.0f} min left", flush=True)
            if step % 1000 == 0 or step == steps:
                v = metrics(valid, predict(model, tok, valid, args.max_len))
                log.append({"step": step, "valid": v})
                print("  valid", json.dumps({t: round(v[t]["auc"], 4) for t in TARGETS}), flush=True)
            if step >= steps:
                break
        epoch += 1
    model.save_pretrained(os.path.join(args.out, "adapter"))
    tok.save_pretrained(os.path.join(args.out, "adapter"))
    p = predict(model, tok, test, args.max_len)
    pd.DataFrame(p, columns=[f"p_{t}" for t in TARGETS], index=test.index).assign(symbol=test.symbol, ts=test.ts).to_csv(os.path.join(args.out, "test-predictions.csv"))
    result = {"model": args.model, "lora": {"r": 16, "alpha": 32}, "trainRows": int(len(train)), "steps": steps,
              "validation": log, "test": metrics(test, p), "minutes": round((time.time() - started) / 60, 1)}
    json.dump(result, open(os.path.join(args.out, "result.json"), "w"), indent=2)
    print("TEST", json.dumps(result["test"], indent=1), flush=True)


if __name__ == "__main__":
    main()
