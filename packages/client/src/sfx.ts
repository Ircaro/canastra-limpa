export type SoundName = 'select' | 'deselect' | 'draw' | 'discard' | 'meld' | 'add' | 'morto' | 'bater' | 'turn' | 'error' | 'deal' | 'lixo' | 'canastraLimpa' | 'canastraSuja' | 'mortoVoa' | 'mortoMonte' | 'brilho';

const KEY = 'canastra-limpa:som';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = load();

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function ensure(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = 0.7;
  const compressor = context.createDynamicsCompressor();
  master.connect(compressor).connect(context.destination);
  noise = context.createBuffer(1, context.sampleRate * 0.4, context.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return context;
}

function tone(frequency: number, duration: number, options: { type?: OscillatorType; gain?: number; delay?: number; slide?: number } = {}): void {
  if (!context || !master) return;
  const start = context.currentTime + (options.delay ?? 0);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.slide) oscillator.frequency.exponentialRampToValueAtTime(options.slide, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.12, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function swish(duration: number, frequency: number, options: { gain?: number; delay?: number } = {}): void {
  if (!context || !master || !noise) return;
  const start = context.currentTime + (options.delay ?? 0);
  const source = context.createBufferSource();
  source.buffer = noise;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, start);
  filter.frequency.exponentialRampToValueAtTime(frequency * 0.5, start + duration);
  filter.Q.value = 1.2;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.25, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(start);
  source.stop(start + duration + 0.02);
}

const SOUNDS: Record<SoundName, () => void> = {
  select: () => tone(1250, 0.05, { type: 'triangle', gain: 0.05 }),
  deselect: () => tone(820, 0.05, { type: 'triangle', gain: 0.04 }),
  draw: () => swish(0.16, 2600, { gain: 0.22 }),
  lixo: () => {
    swish(0.14, 2200, { gain: 0.2 });
    swish(0.14, 1800, { gain: 0.16, delay: 0.07 });
  },
  discard: () => {
    swish(0.1, 1600, { gain: 0.22 });
    tone(170, 0.09, { type: 'sine', gain: 0.18, delay: 0.03, slide: 110 });
  },
  meld: () => {
    tone(660, 0.16, { type: 'triangle', gain: 0.1 });
    tone(880, 0.22, { type: 'triangle', gain: 0.1, delay: 0.08 });
  },
  add: () => tone(880, 0.16, { type: 'triangle', gain: 0.09 }),
  morto: () => [523, 659, 784].forEach((frequency, i) => tone(frequency, 0.22, { type: 'triangle', gain: 0.1, delay: i * 0.09 })),
  bater: () => [523, 659, 784, 1046].forEach((frequency, i) => tone(frequency, i === 3 ? 0.5 : 0.18, { type: 'square', gain: 0.06, delay: i * 0.11 })),
  turn: () => {
    [659, 880, 1319].forEach((frequency, i) => {
      tone(frequency, i === 2 ? 0.7 : 0.35, { type: 'sine', gain: 0.13, delay: i * 0.13 });
      tone(frequency * 2, i === 2 ? 0.5 : 0.25, { type: 'sine', gain: 0.03, delay: i * 0.13 });
    });
    swish(0.25, 5200, { gain: 0.05, delay: 0.26 });
  },
  error: () => tone(190, 0.16, { type: 'square', gain: 0.05, slide: 150 }),
  canastraLimpa: () => {
    [784, 988, 1175, 1568].forEach((frequency, i) => tone(frequency, i === 3 ? 0.45 : 0.16, { type: 'triangle', gain: 0.09, delay: i * 0.08 }));
    [2637, 3136].forEach((frequency, i) => tone(frequency, 0.25, { type: 'sine', gain: 0.03, delay: 0.34 + i * 0.07 }));
  },
  canastraSuja: () => [392, 494, 587, 784].forEach((frequency, i) => tone(frequency, i === 3 ? 0.4 : 0.15, { type: 'triangle', gain: 0.09, delay: i * 0.09 })),
  mortoVoa: () => {
    swish(0.45, 1400, { gain: 0.22 });
    tone(330, 0.5, { type: 'sine', gain: 0.08, slide: 660 });
  },
  brilho: () => {
    [1568, 2093, 2637, 3136].forEach((frequency, i) => tone(frequency, 0.35, { type: 'sine', gain: 0.045, delay: i * 0.06 }));
    swish(0.3, 6000, { gain: 0.06, delay: 0.05 });
  },
  mortoMonte: () => {
    [784, 659, 523, 392].forEach((frequency, i) => tone(frequency, 0.2, { type: 'triangle', gain: 0.09, delay: i * 0.08 }));
    swish(0.18, 900, { gain: 0.2, delay: 0.3 });
  },
  deal: () => {
    for (let i = 0; i < 6; i++) swish(0.08, 2400, { gain: 0.14, delay: i * 0.06 });
  },
};

export const sound = {
  get enabled(): boolean {
    return enabled;
  },
  unlock(): void {
    const audio = ensure();
    if (audio?.state === 'suspended') void audio.resume();
  },
  play(name: SoundName): void {
    if (!enabled) return;
    const audio = ensure();
    if (!audio || audio.state !== 'running') return;
    SOUNDS[name]();
  },
  toggle(): boolean {
    enabled = !enabled;
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      return enabled;
    }
    return enabled;
  },
};
