export interface Snapshot {
  cards: Map<string, DOMRect>;
  anchors: Map<string, DOMRect>;
}

export interface Flight {
  from: string;
  to: string;
  count: number;
}

export interface MotionPlan {
  sourceFor(element: HTMLElement): string | null;
  forceFresh(element: HTMLElement): boolean;
  vanishTarget: string | null;
  stagger: boolean;
  flights: Flight[];
}

const MAX_VANISH = 14;
const SNAP_PX = 8;
const SEAT_CARD_PX = 22;
const DURATION = 460;
const EASING = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
const FACE_DOWN_SOURCES = ['monte', 'mortos'];

interface Flying {
  clone: HTMLElement;
  animation: Animation;
}

const flying = new Map<string, Flying>();

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function anchorRect(element: HTMLElement): DOMRect {
  const rect = element.classList.contains('backs') && element.lastElementChild ? element.lastElementChild.getBoundingClientRect() : element.getBoundingClientRect();
  if (rect.width > 0) return rect;
  return seatSpot(element);
}

function seatSpot(element: HTMLElement): DOMRect {
  const seat = (element.closest<HTMLElement>('.seat') ?? element).getBoundingClientRect();
  const width = Math.min(SEAT_CARD_PX, seat.width);
  const height = width * 1.4;
  return new DOMRect(seat.left + seat.width / 2 - width / 2, seat.top + seat.height / 2 - height / 2, width, height);
}

export function snapshot(root: HTMLElement): Snapshot {
  const cards = new Map<string, DOMRect>();
  for (const element of root.querySelectorAll<HTMLElement>('.card[data-id]')) {
    const id = element.dataset.id as string;
    cards.set(id, (flying.get(id)?.clone ?? element).getBoundingClientRect());
  }
  const anchors = new Map<string, DOMRect>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-anchor]')) anchors.set(element.dataset.anchor as string, anchorRect(element));
  return { cards, anchors };
}

function centerOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function landscape(rect: DOMRect): boolean {
  return rect.width > rect.height * 1.1;
}

function portraitWidth(rect: DOMRect): number {
  return landscape(rect) ? rect.height : rect.width;
}

function place(element: HTMLElement, rect: DOMRect): void {
  Object.assign(element.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    transform: 'none',
    zIndex: '45',
    pointerEvents: 'none',
    visibility: 'visible',
    opacity: '1',
  });
  element.style.setProperty('--card-w', `${rect.width}px`);
}

function faceClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.remove('selected', 'lifted', 'target');
  clone.removeAttribute('tabindex');
  clone.removeAttribute('style');
  return clone;
}

function backCard(): HTMLElement {
  const back = document.createElement('div');
  back.className = 'card back';
  return back;
}

function flipper(front: HTMLElement | null, rect: DOMRect): { wrapper: HTMLElement; inner: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'flying';
  place(wrapper, rect);
  const inner = document.createElement('div');
  inner.className = 'flip-inner';
  const back = backCard();
  back.classList.add('face', 'face-back');
  inner.append(back);
  if (front) {
    front.classList.add('face', 'face-front');
    inner.append(front);
  }
  wrapper.append(inner);
  document.body.append(wrapper);
  return { wrapper, inner };
}

function travel(from: DOMRect, to: DOMRect): { dx: number; dy: number; scale: number; rotate: string } {
  const a = centerOf(from);
  const b = centerOf(to);
  return { dx: a.x - b.x, dy: a.y - b.y, scale: portraitWidth(from) / Math.max(1, to.width), rotate: landscape(from) ? '90deg' : '0deg' };
}

function arc(dx: number, dy: number): string {
  const lift = Math.min(60, Math.hypot(dx, dy) * 0.12);
  return `${dx * 0.45}px ${dy * 0.45 - lift}px`;
}

function flyFrom(element: HTMLElement, from: DOMRect, to: DOMRect, delay: number, faceDown: boolean): void {
  const move = travel(from, to);
  if (Math.abs(move.dx) < SNAP_PX && Math.abs(move.dy) < SNAP_PX && Math.abs(move.scale - 1) < 0.02) return;
  const id = element.dataset.id as string;
  const { wrapper, inner } = flipper(faceClone(element), to);
  if (!faceDown) inner.classList.add('shown');
  element.style.opacity = '0';
  const animation = wrapper.animate(
    [
      { translate: `${move.dx}px ${move.dy}px`, scale: String(move.scale), rotate: move.rotate },
      { translate: arc(move.dx, move.dy), scale: String((move.scale + 1) / 2 + 0.06), rotate: '0deg', offset: 0.55 },
      { translate: '0px 0px', scale: '1', rotate: '0deg' },
    ],
    { duration: DURATION, delay, easing: EASING, fill: 'backwards' },
  );
  if (faceDown) {
    inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.25 }, { transform: 'rotateY(0deg)' }], {
      duration: DURATION,
      delay,
      easing: 'ease-in-out',
      fill: 'both',
    });
  }
  const done = () => {
    wrapper.remove();
    element.style.opacity = '';
    if (flying.get(id)?.clone === wrapper) flying.delete(id);
  };
  animation.onfinish = done;
  animation.oncancel = done;
  flying.set(id, { clone: wrapper, animation });
}

function toHand(from: DOMRect, target: HTMLElement, front: HTMLElement | null, delay: number): void {
  let to = target.getBoundingClientRect();
  if (to.width === 0) to = seatSpot(target);
  const lying = landscape(to);
  const start = new DOMRect(centerOf(from).x - from.width / 2, centerOf(from).y - from.height / 2, from.width, from.height);
  const { wrapper, inner } = flipper(front, start);
  if (front) inner.classList.add('shown');
  const a = centerOf(start);
  const b = centerOf(to);
  const endScale = (lying ? to.height : to.width) / Math.max(1, start.width);
  target.style.opacity = '0';
  const animation = wrapper.animate(
    [
      { translate: '0px 0px', scale: '1', rotate: '0deg' },
      { translate: arc(b.x - a.x, b.y - a.y), scale: String((1 + endScale) / 2), rotate: lying ? '45deg' : '0deg', offset: 0.5 },
      { translate: `${b.x - a.x}px ${b.y - a.y}px`, scale: String(endScale), rotate: lying ? '90deg' : '0deg' },
    ],
    { duration: DURATION + 60, delay, easing: EASING, fill: 'backwards' },
  );
  if (front) {
    inner.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)', offset: 0.6 }, { transform: 'rotateY(180deg)' }], {
      duration: DURATION + 60,
      delay,
      easing: 'ease-in-out',
      fill: 'both',
    });
  }
  const done = () => {
    wrapper.remove();
    target.style.opacity = '';
  };
  animation.onfinish = done;
  animation.oncancel = done;
}

function handSlots(root: HTMLElement, anchor: string, count: number): HTMLElement[] {
  const backs = root.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`);
  if (!backs) return [];
  const cards = [...backs.children] as HTMLElement[];
  return cards.slice(Math.max(0, cards.length - count));
}

function launchFlights(root: HTMLElement, before: Snapshot, flights: readonly Flight[]): void {
  for (const flight of flights) {
    const from = before.anchors.get(flight.from);
    if (!from) continue;
    const origin = root.querySelector<HTMLElement>(`[data-anchor="${flight.from}"] .card`)?.getBoundingClientRect() ?? from;
    const slots = handSlots(root, flight.to, flight.count);
    slots.forEach((slot, i) => toHand(origin, slot, null, i * 70));
  }
}

export function stopAnimations(): void {
  for (const entry of [...flying.values()]) entry.animation.cancel();
  flying.clear();
}

export function play(root: HTMLElement, before: Snapshot, plan: MotionPlan, vanished: Map<string, HTMLElement>): void {
  stopAnimations();
  if (reducedMotion()) return;
  launchFlights(root, before, plan.flights);
  const elements = [...root.querySelectorAll<HTMLElement>('.card[data-id]')];
  const present = new Set<string>();
  let fresh = 0;
  for (const element of elements) {
    const id = element.dataset.id as string;
    present.add(id);
    const to = element.getBoundingClientRect();
    const previous = plan.forceFresh(element) ? undefined : before.cards.get(id);
    if (previous) {
      flyFrom(element, previous, to, 0, false);
      continue;
    }
    const anchor = plan.sourceFor(element);
    const from = anchor ? before.anchors.get(anchor) : undefined;
    if (!from || !anchor) continue;
    const faceDown = FACE_DOWN_SOURCES.includes(anchor) || anchor.startsWith('hand-');
    flyFrom(element, from, to, plan.stagger ? fresh * 40 : fresh * 60, faceDown);
    fresh++;
  }
  if (!plan.vanishTarget) return;
  const gone = [...before.cards.entries()].filter(([id]) => !present.has(id));
  if (gone.length === 0) return;
  const shown = gone.slice(-MAX_VANISH);
  const slots = handSlots(root, plan.vanishTarget, shown.length);
  shown.forEach(([id, rect], i) => {
    const slot = slots[Math.min(i, slots.length - 1)];
    const source = vanished.get(id);
    if (slot) toHand(rect, slot, source ? faceClone(source) : null, i * 45);
  });
}
