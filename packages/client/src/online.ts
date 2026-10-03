import {
  applyAction,
  stateFromView,
  type Action,
  type ActionResult,
  type ClientMessage,
  type PlayerView,
  type RuleSet,
  type SeatInfo,
  type ServerMessage,
} from '@canastra/shared';
import type { TableController } from './local';

const NAME_KEY = 'canastra-limpa:nome';
const RETRY_MS = 1500;
const MAX_RETRIES = 8;
const ECHO_MS = 4000;

export interface RoomInfo {
  room: string;
  status: 'lobby' | 'playing';
  host: number;
  you: number;
  seats: SeatInfo[];
  seatsCount: number;
  rules: RuleSet;
}

export interface SessionEvents {
  room(info: RoomInfo): void;
  state(): void;
  error(message: string): void;
  failure(message: string): void;
  reconnecting(active: boolean): void;
}

function tokenKey(room: string): string {
  return `canastra-limpa:sala:${room}`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function savedName(): string {
  return read(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

function socketUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured) return configured;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

export class OnlineSession {
  info: RoomInfo | null = null;
  view: PlayerView | null = null;
  names: string[] = [];
  bots: boolean[] = [];
  votes = { votes: 0, needed: 0, voted: false };
  turnEndsAt: number | null = null;
  turnTotalMs = 30_000;
  private socket: WebSocket | null = null;
  private first: ClientMessage;
  private room: string | null = null;
  private retries = 0;
  private closed = false;
  private joinedOnce = false;
  private echoTimer: ReturnType<typeof setInterval> | null = null;
  latency: number | null = null;

  constructor(
    first: ClientMessage,
    private readonly events: SessionEvents,
  ) {
    this.first = first;
    this.connect();
  }

  get isHost(): boolean {
    return this.info !== null && this.info.host === this.info.you;
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    if (this.echoTimer) clearInterval(this.echoTimer);
    this.echoTimer = null;
    this.socket?.close();
  }

  private connect(): void {
    const socket = new WebSocket(socketUrl());
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.startEcho();
      if (this.room) {
        const token = read(tokenKey(this.room)) ?? undefined;
        this.send({ type: 'join', room: this.room, name: savedName(), ...(token ? { token } : {}) });
      } else this.send(this.first);
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') this.receive(event.data);
    });
    socket.addEventListener('close', () => {
      if (this.closed) return;
      if (this.joinedOnce && this.retries < MAX_RETRIES) {
        this.retries++;
        this.events.reconnecting(true);
        setTimeout(() => {
          if (!this.closed) this.connect();
        }, RETRY_MS);
        return;
      }
      if (!this.joinedOnce) this.events.failure('Não consegui entrar na sala.');
      else this.events.failure('A conexão com a sala caiu.');
    });
  }

  private startEcho(): void {
    if (this.echoTimer) clearInterval(this.echoTimer);
    const echo = () => this.send({ type: 'eco', t: performance.now() });
    echo();
    this.echoTimer = setInterval(echo, ECHO_MS);
  }

  private receive(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'eco': {
        const rtt = performance.now() - message.t;
        if (rtt >= 0 && rtt < 30_000) this.latency = this.latency === null ? rtt : this.latency * 0.6 + rtt * 0.4;
        break;
      }
      case 'joined':
        this.room = message.room;
        this.joinedOnce = true;
        if (this.retries > 0) this.events.reconnecting(false);
        this.retries = 0;
        write(tokenKey(message.room), message.token);
        break;
      case 'room':
        this.info = { room: message.room, status: message.status, host: message.host, you: message.you, seats: message.seats, seatsCount: message.seatsCount, rules: message.rules };
        if (message.status === 'lobby') this.view = null;
        this.events.room(this.info);
        break;
      case 'state':
        this.view = message.view;
        this.names = message.names;
        this.bots = message.bots;
        this.votes = { votes: message.votes, needed: message.needed, voted: message.voted };
        this.turnEndsAt = message.turnMs === null ? null : performance.now() + message.turnMs;
        this.turnTotalMs = message.turnTotalMs;
        this.events.state();
        break;
      case 'error':
        if (!this.joinedOnce && ['room-not-found', 'room-full', 'in-game', 'server-full', 'too-many-attempts'].includes(message.code)) {
          this.closed = true;
          this.events.failure(message.message);
        } else this.events.error(message.message);
        break;
      default:
        break;
    }
  }
}

export class OnlineMatch implements TableController {
  private readonly listeners: (() => void)[] = [];
  private readonly errorListeners: ((message: string) => void)[] = [];

  constructor(private readonly session: OnlineSession) {}

  get seat(): number {
    return this.session.view?.seat ?? 0;
  }

  get names(): string[] {
    return this.session.names.map((name, seat) => (seat === this.seat ? 'Você' : name));
  }

  get bots(): boolean[] {
    return this.session.bots;
  }

  get waitingNext(): { votes: number; needed: number; voted: boolean } {
    return this.session.votes;
  }

  get turnTimer(): { endsAt: number; total: number } | null {
    return this.session.turnEndsAt === null ? null : { endsAt: this.session.turnEndsAt, total: this.session.turnTotalMs };
  }

  get isHost(): boolean {
    return this.session.isHost;
  }

  get latency(): number | null {
    return this.session.latency;
  }

  view(): PlayerView {
    return this.session.view as PlayerView;
  }

  act(action: Action): ActionResult {
    const current = this.session.view;
    if (!current) return { ok: false, error: 'Ainda conectando à sala.' };
    const probe = stateFromView(current);
    const result = applyAction(probe, current.seat, action);
    if (!result.ok) return result;
    this.session.send({ type: 'action', action });
    return { ok: true };
  }

  nextHand(): void {
    this.session.send({ type: 'nextHand' });
  }

  restart(): void {
    this.session.send({ type: 'restart' });
  }

  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  onError(listener: (message: string) => void): void {
    this.errorListeners.push(listener);
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }

  failed(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }

  dispose(): void {
    return;
  }
}
