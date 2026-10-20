/**
 * MARKET POLARIS — UI Controller
 * Manages all DOM overlay elements:
 * start prompt, progress ticker, brand reveal, corner marks, data readout
 */
export class UIController {
  constructor() {
    this.soundHint = document.getElementById('sound-hint');
    this.progressTicker = document.getElementById('progress-ticker');
    this.tickerLabel = this.progressTicker?.querySelector('.ticker-label');
    this.brandContainer = document.getElementById('brand-container');
    this.cornerMarks = document.querySelectorAll('.corner-mark');
    this.dataReadout = document.getElementById('data-readout');
    this.scanlines = document.querySelector('.scanlines');

    // Readout items
    this.readouts = [
      document.getElementById('readout-1'),
      document.getElementById('readout-2'),
      document.getElementById('readout-3'),
    ];

    this.readoutInterval = null;
  }

  showStartPrompt() {
    if (this.soundHint) {
      this.soundHint.classList.add('visible');
    }
  }

  hideStartPrompt() {
    if (this.soundHint) {
      this.soundHint.classList.add('hidden');
      this.soundHint.classList.remove('visible');
    }
  }

  showProgressTicker() {
    if (this.progressTicker) {
      this.progressTicker.classList.add('active');
    }
  }

  hideProgressTicker() {
    if (this.progressTicker) {
      this.progressTicker.classList.add('hidden');
      setTimeout(() => {
        this.progressTicker.classList.remove('active');
      }, 600);
    }
  }

  setTickerLabel(text) {
    if (this.tickerLabel) {
      this.tickerLabel.textContent = text;
    }
  }

  showCornerMarks() {
    this.cornerMarks.forEach((mark, i) => {
      setTimeout(() => mark.classList.add('visible'), i * 100);
    });
  }

  showScanlines() {
    if (this.scanlines) {
      this.scanlines.classList.add('active');
    }
  }

  showDataReadout() {
    if (this.dataReadout) {
      this.dataReadout.classList.add('visible');
    }

    // Animate readout data
    const marketData = [
      ['SIGNAL', 'ALPHA', 'DELTA', 'THETA', 'GAMMA'],
      ['0.9847', '1.0234', '0.7891', '2.3456', '0.5678'],
      ['↑ 0.12%', '↑ 0.34%', '↓ 0.08%', '↑ 0.56%', '→ 0.01%'],
    ];

    const labels = ['SYS', 'IDX', 'Δ'];

    let idx = 0;
    const updateReadout = () => {
      this.readouts.forEach((el, i) => {
        if (el) {
          const dataIdx = (idx + i) % marketData[0].length;
          el.textContent = `${labels[i]} ${marketData[0][dataIdx]} ${marketData[1][dataIdx]} ${marketData[2][dataIdx]}`;
        }
      });
      idx++;
    };

    updateReadout();
    this.readoutInterval = setInterval(updateReadout, 2500);
  }

  revealBrand() {
    if (this.brandContainer) {
      this.brandContainer.classList.add('revealed');
    }

    // Stagger reveal word by word
    const words = document.querySelectorAll('.brand-word');
    const separator = document.querySelector('.brand-separator');
    const tagline = document.querySelector('.brand-tagline');

    words.forEach((word, i) => {
      setTimeout(() => word.classList.add('visible'), 200 + i * 300);
    });

    if (separator) {
      setTimeout(() => separator.classList.add('visible'), 600);
    }

    if (tagline) {
      setTimeout(() => tagline.classList.add('visible'), 1000);
    }
  }

  dispose() {
    if (this.readoutInterval) clearInterval(this.readoutInterval);
  }
}
