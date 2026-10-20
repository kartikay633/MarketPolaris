/**
 * MARKET POLARIS — Audio Engine
 * Synthetic sound design using Web Audio API
 * Produces cinematic impacts, tones, and ambient atmosphere
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.initialized = false;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.15;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  playTone(freq, type, volume, duration) {
    if (!this.initialized) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type || 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume || 0.05, this.ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (duration || 1.0));

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + (duration || 1.0) + 0.1);
  }

  playImpact(intensity) {
    if (!this.initialized) return;

    const vol = (intensity || 0.2) * 0.3;

    // Sub bass thump
    this.playTone(40 + intensity * 20, 'sine', vol, 0.6);

    // Noise burst
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 15) * vol;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 + intensity * 1200;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.5;

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start();
  }

  playChord() {
    if (!this.initialized) return;

    // Ethereal chord: D4, F#4, A4, C#5 (Dmaj7)
    const freqs = [293.66, 369.99, 440.0, 554.37];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        this.playTone(f, 'sine', 0.025, 3.0);
      }, i * 80);
    });
  }

  setPulseIntensity(val) {
    // Could modulate ambient drone intensity
  }

  fadeToAmbient() {
    if (!this.initialized || !this.masterGain) return;

    this.masterGain.gain.linearRampToValueAtTime(
      0.05,
      this.ctx.currentTime + 3.0
    );
  }
}
