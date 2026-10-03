import { randomBytes } from 'node:crypto';
import {
  applyAction,
  botAction,
  createGame,
  fallbackAction,
  nextHand,
  nextRandom,
  randomSeed,
  viewFor,
  type ClientMessage,
  type GameState,
  type RuleSet,
  type SeatInfo,
  type ServerMessage,
} from '@canastra/shared';

export interface Socket {
  readonly open: boolean;
  send(data: string): void;
  close(): void;
}

interface Occupant {
  token: string;
  name: string;
  socket: Socket | null;
  ready: boolean;
  voted: boolean;
  offlineSince: number | null;
}

export const TURN_MS = Number(process.env.TURN_MS ?? 30_000);
export const MORTO_TURN_MS = Number(process.env.MORTO_TURN_MS ?? 60_000);
const OFFLINE_GRACE_MS = 15_000;
const LOBBY_SEAT_HOLD_MS = 60_000;
const EMPTY_ROOM_MS = 10 * 60_000;
const PING_EVERY_MS = 25_000;
const BOT_PACE = Number(process.env.BOT_PACE ?? 1);
const DELAYS = { comprar: 900, jogar: 700, descartar: 800 };
const BOT_NAMES = ['Ana', 'Beto', 'Duda', 'Caio'];

function now(): number {
  return performance.now();
}

export class Room {
  private seats: (Occupant | null)[];
  private host = 0;
  private status: 'lobby' | 'playing' = 'lobby';
  private state: GameState | null = null;
  private readonly rng = { rngState: randomSeed() };
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private turnKey = '';
  private deadline: number | null = null;
  private turnTotal = TURN_MS;
  private mortoKey = '';
  private autoSeat: number | null = null;
  private lastHumanAt = now();
  private lastPing = now();

  constructor(
    readonly code: string,
    seatsCount: number,
    private rules: RuleSet,
    private readonly onEmpty: (room: Room) => void,
  ) {
    this.seats = Array.from({ length: seatsCount }, () => null);
  }

  join(socket: Socket, name: string, token?: string): { seat: number; token: string } | { error: string; code: string } {
    const existing = token ? this.seats.findIndex((occupant) => occupant?.token === token) : -1;
    if (existing >= 0) {
      const occupant = this.seats[existing] as Occupant;
      occupant.socket?.close();
      occupant.socket = socket;
      occupant.offlineSince = null;
      if (name) occupant.name = name;
      this.afterPresenceChange();
      return { seat: existing, token: occupant.token };
    }
    if (this.status === 'playing') return { error: 'Essa partida já começou. Peça para quem criou a sala te chamar na próxima.', code: 'in-game' };
    const free = this.seats.findIndex((occupant) => occupant === null);
    if (free < 0) return { error: 'A sala está cheia.', code: 'room-full' };
    const occupant: Occupant = { token: randomBytes(18).toString('base64url'), name: name || `Jogador ${free + 1}`, socket, ready: false, voted: false, offlineSince: null };
    this.seats[free] = occupant;
    if (!this.seats[this.host]) this.host = free;
    this.afterPresenceChange();
    return { seat: free, token: occupant.token };
  }

  detach(socket: Socket): void {
    const seat = this.seatOf(socket);
    if (seat < 0) return;
    const occupant = this.seats[seat] as Occupant;
    occupant.socket = null;
    occupant.offlineSince = now();
    this.afterPresenceChange();
  }

  handle(socket: Socket, message: ClientMessage): void {
    const seat = this.seatOf(socket);
    if (seat < 0) return;
    const occupant = this.seats[seat] as Occupant;
    this.lastHumanAt = now();
    switch (message.type) {
      case 'pong':
        return;
      case 'name':
        if (message.name) occupant.name = message.name;
        this.broadcastRoom();
        if (this.state) this.broadcastState();
        return;
      case 'ready':
        if (this.status !== 'lobby') return;
        occupant.ready = message.ready;
        this.broadcastRoom();
        return;
      case 'seat':
        if (this.status !== 'lobby' || message.seat < 0 || message.seat >= this.seats.length || this.seats[message.seat]) return;
        this.seats[message.seat] = occupant;
        this.seats[seat] = null;
        if (this.host === seat) this.host = message.seat;
        this.broadcastRoom();
        return;
      case 'config':
        if (seat !== this.host || this.status !== 'lobby') return;
        this.configure(message.seats, message.rules, socket);
        return;
      case 'start':
        if (seat !== this.host || this.status !== 'lobby') return;
        this.start(socket);
        return;
      case 'action':
        this.act(seat, message.action, socket);
        return;
      case 'nextHand':
        if (!this.state || this.state.phase !== 'fimDeMao') return;
        occupant.voted = true;
        this.checkVotes();
        return;
      case 'restart':
        if (seat !== this.host || !this.state || this.state.phase !== 'fimDePartida') return;
        this.toLobby();
        return;
      default:
        return;
    }
  }

  tick(): void {
    const time = now();
    if (time - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = time;
      for (const occupant of this.seats) if (occupant?.socket?.open) occupant.socket.send('{"type":"ping"}');
    }
    if (this.status === 'lobby') {
      let changed = false;
      this.seats.forEach((occupant, seat) => {
        if (occupant && !occupant.socket && occupant.offlineSince !== null && time - occupant.offlineSince > LOBBY_SEAT_HOLD_MS) {
          this.seats[seat] = null;
          changed = true;
        }
      });
      if (changed) {
        this.migrateHost();
        this.broadcastRoom();
      }
    }
    const anyone = this.seats.some((occupant) => occupant?.socket);
    if (anyone) this.lastHumanAt = time;
    else if (time - this.lastHumanAt > EMPTY_ROOM_MS || this.seats.every((occupant) => occupant === null)) {
      this.stop();
      this.onEmpty(this);
    }
  }

  stop(): void {
    this.clearTimers();
  }

  humans(): number {
    return this.seats.filter((occupant) => occupant?.socket).length;
  }

  private seatOf(socket: Socket): number {
    return this.seats.findIndex((occupant) => occupant?.socket === socket);
  }

  private error(socket: Socket, code: string, message: string): void {
    this.send(socket, { type: 'error', code, message });
  }

  private send(socket: Socket, message: ServerMessage): void {
    if (socket.open) socket.send(JSON.stringify(message));
  }

  private offlineTooLong(occupant: Occupant): boolean {
    return !occupant.socket && occupant.offlineSince !== null && now() - occupant.offlineSince >= OFFLINE_GRACE_MS;
  }

  private isBot(seat: number): boolean {
    const occupant = this.seats[seat];
    return !occupant || this.offlineTooLong(occupant) || this.autoSeat === seat;
  }

  private names(): string[] {
    return this.seats.map((occupant, seat) => occupant?.name ?? BOT_NAMES[seat]);
  }

  private migrateHost(): void {
    const current = this.seats[this.host];
    if (current?.socket) return;
    const next = this.seats.findIndex((occupant) => occupant?.socket);
    if (next >= 0) this.host = next;
    else if (!current) {
      const any = this.seats.findIndex((occupant) => occupant !== null);
      if (any >= 0) this.host = any;
    }
  }

  private afterPresenceChange(): void {
    this.migrateHost();
    this.broadcastRoom();
    if (this.state) {
      this.checkVotes();
      this.broadcastState();
      this.schedule();
    }
  }

  private configure(seatsCount: number, rules: RuleSet, socket: Socket): void {
    const occupants = this.seats.filter((occupant): occupant is Occupant => occupant !== null);
    if (occupants.length > seatsCount) {
      this.error(socket, 'too-many', 'Tem mais jogadores na sala do que lugares nesse formato.');
      return;
    }
    const hostOccupant = this.seats[this.host];
    if (seatsCount !== this.seats.length) {
      const next: (Occupant | null)[] = Array.from({ length: seatsCount }, () => null);
      const leftovers: Occupant[] = [];
      this.seats.forEach((occupant, seat) => {
        if (!occupant) return;
        if (seat < seatsCount) next[seat] = occupant;
        else leftovers.push(occupant);
      });
      for (const occupant of leftovers) next[next.indexOf(null)] = occupant;
      this.seats = next;
    }
    this.rules = rules;
    for (const occupant of this.seats) if (occupant) occupant.ready = false;
    this.host = Math.max(0, this.seats.findIndex((occupant) => occupant === hostOccupant));
    this.broadcastRoom();
  }

  private start(socket: Socket): void {
    const waiting = this.seats.some((occupant, seat) => occupant?.socket && seat !== this.host && !occupant.ready);
    if (waiting) {
      this.error(socket, 'not-ready', 'Espere todos marcarem que estão prontos.');
      return;
    }
    this.state = createGame(this.seats.length, this.rules, randomSeed(), Math.floor(Math.random() * this.seats.length));
    this.status = 'playing';
    this.autoSeat = null;
    this.turnKey = '';
    for (const occupant of this.seats) if (occupant) occupant.voted = false;
    this.broadcastRoom();
    this.changed();
  }

  private toLobby(): void {
    this.clearTimers();
    this.state = null;
    this.status = 'lobby';
    this.autoSeat = null;
    this.deadline = null;
    for (const occupant of this.seats) {
      if (!occupant) continue;
      occupant.ready = false;
      occupant.voted = false;
    }
    this.broadcastRoom();
  }

  private act(seat: number, action: Parameters<typeof applyAction>[2], socket: Socket): void {
    const state = this.state;
    if (!state || state.turn !== seat || this.autoSeat === seat) return;
    const result = applyAction(state, seat, action);
    if (!result.ok) {
      this.error(socket, 'invalid', result.error);
      this.broadcastState();
      return;
    }
    this.changed();
  }

  private checkVotes(): void {
    const state = this.state;
    if (!state || state.phase !== 'fimDeMao') return;
    const pending = this.seats.some((occupant) => occupant?.socket && !occupant.voted);
    if (pending) {
      this.broadcastState();
      return;
    }
    nextHand(state);
    for (const occupant of this.seats) if (occupant) occupant.voted = false;
    this.changed();
  }

  private changed(): void {
    const state = this.state;
    if (!state) return;
    const key = `${state.hand}:${state.turn}:${state.phase}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.autoSeat = null;
      this.deadline = state.phase === 'comprar' || state.phase === 'jogar' ? now() + TURN_MS : null;
      this.turnTotal = TURN_MS;
    } else if (state.mortoCount.join() !== this.mortoKey && state.phase === 'jogar') {
      this.deadline = now() + MORTO_TURN_MS;
      this.turnTotal = MORTO_TURN_MS;
    }
    this.mortoKey = state.mortoCount.join();
    this.broadcastState();
    this.schedule();
  }

  private clearTimers(): void {
    for (const timer of [this.botTimer, this.turnTimer, this.graceTimer]) if (timer) clearTimeout(timer);
    this.botTimer = null;
    this.turnTimer = null;
    this.graceTimer = null;
  }

  private schedule(): void {
    this.clearTimers();
    const state = this.state;
    if (!state || (state.phase !== 'comprar' && state.phase !== 'jogar')) return;
    const seat = state.turn;
    if (this.isBot(seat)) {
      const view = viewFor(state, seat);
      const action = botAction(view, () => nextRandom(this.rng));
      if (!action) return;
      const delay = BOT_PACE * (action.type === 'descartar' ? DELAYS.descartar : state.phase === 'comprar' ? DELAYS.comprar : DELAYS.jogar);
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.state !== state || state.turn !== seat) return;
        const result = applyAction(state, seat, action);
        if (!result.ok) applyAction(state, seat, fallbackAction(state, seat));
        this.changed();
      }, delay);
      return;
    }
    if (this.deadline !== null) {
      this.turnTimer = setTimeout(() => {
        this.turnTimer = null;
        if (this.state !== state || state.turn !== seat) return;
        this.autoSeat = seat;
        this.broadcastState();
        this.schedule();
      }, Math.max(0, this.deadline - now()));
    }
    const occupant = this.seats[seat];
    if (occupant && !occupant.socket && occupant.offlineSince !== null) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.broadcastState();
        this.schedule();
      }, Math.max(0, occupant.offlineSince + OFFLINE_GRACE_MS - now()));
    }
  }

  private seatInfos(): SeatInfo[] {
    return this.seats.map((occupant) => ({
      name: occupant?.name ?? '',
      human: occupant !== null,
      connected: Boolean(occupant?.socket),
      ready: occupant?.ready ?? false,
    }));
  }

  private broadcastRoom(): void {
    const seats = this.seatInfos();
    this.seats.forEach((occupant, seat) => {
      if (!occupant?.socket) return;
      this.send(occupant.socket, { type: 'room', room: this.code, status: this.status, host: this.host, you: seat, seats, seatsCount: this.seats.length, rules: this.rules });
    });
  }

  private broadcastState(): void {
    const state = this.state;
    if (!state) return;
    const names = this.names();
    const bots = this.seats.map((_, seat) => this.isBot(seat));
    const humans = this.seats.filter((occupant) => occupant?.socket);
    const votes = humans.filter((occupant) => occupant?.voted).length;
    const turnMs = this.deadline === null || this.isBot(state.turn) ? null : Math.max(0, Math.round(this.deadline - now()));
    this.seats.forEach((occupant, seat) => {
      if (!occupant?.socket) return;
      this.send(occupant.socket, {
        type: 'state',
        view: viewFor(state, seat),
        names,
        bots,
        votes,
        needed: humans.length,
        voted: occupant.voted,
        turnMs,
        turnTotalMs: this.turnTotal,
      });
    });
  }
}
