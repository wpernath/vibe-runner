import { player } from './state.js';

const audio = {
    ready: false,
    ctx: null,
    gainNode: null,
    osc1: null,
    osc2: null,
    filter: null,
};

/** One-shot procedural crash SFX (noise, low thud, crunch). */
export function playCrashSound() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = audio.ctx || (Ctx && new Ctx());
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const t0 = ctx.currentTime;
        const duration = 0.5;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.95, t0 + 0.008);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        gainNode.connect(ctx.destination);

        const noiseDuration = 0.22;
        const bufferSize = ctx.sampleRate * noiseDuration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        const peakAt = bufferSize * 0.08;
        for (let i = 0; i < bufferSize; i++) {
            const env = i < peakAt
                ? i / peakAt
                : Math.exp(-(i - peakAt) / (bufferSize * 0.25));
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.connect(gainNode);
        noise.start(t0);
        noise.stop(t0 + noiseDuration);

        const thud = ctx.createOscillator();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(90, t0);
        thud.frequency.exponentialRampToValueAtTime(28, t0 + 0.12);
        thud.connect(gainNode);
        thud.start(t0);
        thud.stop(t0 + 0.28);

        const thud2 = ctx.createOscillator();
        thud2.type = 'sine';
        thud2.frequency.setValueAtTime(55, t0);
        thud2.frequency.exponentialRampToValueAtTime(22, t0 + 0.18);
        const thud2Gain = ctx.createGain();
        thud2Gain.gain.setValueAtTime(0.7, t0);
        thud2Gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
        thud2.connect(thud2Gain);
        thud2Gain.connect(gainNode);
        thud2.start(t0);
        thud2.stop(t0 + 0.25);

        const crunch = ctx.createOscillator();
        crunch.type = 'sawtooth';
        crunch.frequency.setValueAtTime(180, t0);
        crunch.frequency.exponentialRampToValueAtTime(50, t0 + 0.06);
        const crunchGain = ctx.createGain();
        crunchGain.gain.setValueAtTime(0.4, t0);
        crunchGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        crunch.connect(crunchGain);
        crunchGain.connect(gainNode);
        crunch.start(t0);
        crunch.stop(t0 + 0.08);
    } catch (_) {}
}

/** Initializes engine sound (AudioContext, oscillators, filter). Idempotent. */
export function startEngineSound() {
    if (audio.ready) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        audio.ctx = ctx;
        if (ctx.state === 'suspended') ctx.resume();

        audio.gainNode = ctx.createGain();
        audio.gainNode.gain.value = 0;
        audio.gainNode.connect(ctx.destination);

        audio.osc1 = ctx.createOscillator();
        audio.osc1.type = 'sawtooth';
        audio.osc1.frequency.value = 40;
        audio.osc1.connect(audio.gainNode);
        audio.osc1.start(0);

        audio.osc2 = ctx.createOscillator();
        audio.osc2.type = 'square';
        audio.osc2.frequency.value = 60;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        audio.osc2.connect(osc2Gain);
        osc2Gain.connect(audio.gainNode);
        audio.osc2.start(0);

        audio.filter = ctx.createBiquadFilter();
        audio.filter.type = 'lowpass';
        audio.filter.frequency.value = 400;
        audio.filter.Q.value = 0.7;
        audio.gainNode.disconnect();
        audio.gainNode.connect(audio.filter);
        audio.filter.connect(ctx.destination);

        audio.ready = true;
    } catch (_) { audio.ready = false; }
}

/** Updates engine oscillator frequencies and gain from RPM and throttle. */
export function updateEngineSound(rpm, throttle) {
    if (!audio.ready || !audio.gainNode || !audio.osc1 || !audio.osc2) return;
    const baseFreq = 0.012 * rpm + 25;
    audio.osc1.frequency.setTargetAtTime(baseFreq, 0, 0.02);
    audio.osc2.frequency.setTargetAtTime(baseFreq * 1.5, 0, 0.02);
    if (audio.filter) audio.filter.frequency.setTargetAtTime(200 + 0.04 * rpm, 0, 0.02);
    const vol = player.crashed ? 0 : (0.08 + 0.12 * throttle + 0.002 * (rpm / 1000));
    audio.gainNode.gain.setTargetAtTime(Math.min(0.35, vol), 0, 0.03);
}
