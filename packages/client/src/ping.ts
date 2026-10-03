import { el } from './dom';

const REFRESH_MS = 1000;

function reading(latency: number | null | undefined): { text: string; level: string } {
  if (latency === null || latency === undefined) return { text: '… ms', level: 'wait' };
  const ms = Math.round(latency);
  return { text: `${ms} ms`, level: ms < 100 ? 'good' : ms < 250 ? 'ok' : 'bad' };
}

export function pingBadge(latency: () => number | null | undefined): HTMLElement {
  const label = el('span', 'ping-ms');
  const element = el('span', 'ping', el('i', 'ping-dot'), label);
  const update = () => {
    const { text, level } = reading(latency());
    element.className = `ping ${level}`;
    label.textContent = text;
  };
  update();
  let attached = false;
  const timer = setInterval(() => {
    if (element.isConnected) attached = true;
    else if (attached) {
      clearInterval(timer);
      return;
    }
    update();
  }, REFRESH_MS);
  return element;
}
