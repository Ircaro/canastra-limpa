import type { Card } from './cards';
import type { Action, GameState } from './game';
import { DEFAULT_RULES, sanitizeRules, type RuleSet } from './rules';
import type { PlayerView } from './view';

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const NAME_MAX_LENGTH = 16;
export const MESSAGE_MAX_BYTES = 4096;
const MAX_CARDS_PER_ACTION = 30;

export type RoomStatus = 'lobby' | 'playing';

export interface SeatInfo {
  name: string;
  human: boolean;
  connected: boolean;
  ready: boolean;
}

export type ClientMessage =
  | { type: 'create'; name: string; seats: number; rules: RuleSet }
  | { type: 'join'; room: string; name: string; token?: string }
  | { type: 'seat'; seat: number }
  | { type: 'name'; name: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'config'; seats: number; rules: RuleSet }
  | { type: 'start' }
  | { type: 'action'; action: Action }
  | { type: 'nextHand' }
  | { type: 'restart' }
  | { type: 'pong' };

export type ServerMessage =
  | { type: 'joined'; room: string; seat: number; token: string }
  | { type: 'room'; room: string; status: RoomStatus; host: number; you: number; seats: SeatInfo[]; seatsCount: number; rules: RuleSet }
  | { type: 'state'; view: PlayerView; names: string[]; bots: boolean[]; votes: number; needed: number; voted: boolean; turnMs: number | null; turnTotalMs: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'ping' };

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && value.length === ROOM_CODE_LENGTH && [...value].every((char) => ROOM_CODE_ALPHABET.includes(char));
}

const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x206f],
  ]
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g',
);

export function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

function cardIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARDS_PER_ACTION) return null;
  return value.every((item) => Number.isInteger(item)) ? (value as number[]) : null;
}

export function parseAction(value: unknown): Action | null {
  if (typeof value !== 'object' || value === null) return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'comprar':
      return { type: 'comprar' };
    case 'pegarLixo': {
      const cards = action.cards === undefined ? undefined : cardIds(action.cards);
      if (cards === null) return null;
      if (action.meld !== undefined && !Number.isInteger(action.meld)) return null;
      return { type: 'pegarLixo', ...(cards ? { cards } : {}), ...(action.meld !== undefined ? { meld: action.meld as number } : {}) };
    }
    case 'baixar': {
      const cards = cardIds(action.cards);
      return cards ? { type: 'baixar', cards } : null;
    }
    case 'adicionar': {
      const cards = cardIds(action.cards);
      return cards && Number.isInteger(action.meld) ? { type: 'adicionar', meld: action.meld as number, cards } : null;
    }
    case 'descartar':
      return Number.isInteger(action.card) ? { type: 'descartar', card: action.card as number } : null;
    default:
      return null;
  }
}

function seatsCount(value: unknown): number | null {
  return value === 2 || value === 4 ? value : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MESSAGE_MAX_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'create': {
      const seats = seatsCount(message.seats);
      return seats ? { type: 'create', name: sanitizeName(message.name), seats, rules: sanitizeRules(message.rules) } : null;
    }
    case 'join': {
      if (!isRoomCode(message.room)) return null;
      const token = typeof message.token === 'string' && message.token.length <= 64 ? message.token : undefined;
      return { type: 'join', room: message.room, name: sanitizeName(message.name), ...(token ? { token } : {}) };
    }
    case 'seat':
      return Number.isInteger(message.seat) ? { type: 'seat', seat: message.seat as number } : null;
    case 'name':
      return { type: 'name', name: sanitizeName(message.name) };
    case 'ready':
      return typeof message.ready === 'boolean' ? { type: 'ready', ready: message.ready } : null;
    case 'config': {
      const seats = seatsCount(message.seats);
      return seats ? { type: 'config', seats, rules: sanitizeRules(message.rules ?? DEFAULT_RULES) } : null;
    }
    case 'action': {
      const action = parseAction(message.action);
      return action ? { type: 'action', action } : null;
    }
    case 'start':
    case 'nextHand':
    case 'restart':
    case 'pong':
      return { type: message.type };
    default:
      return null;
  }
}

function placeholders(count: number, offset: number): Card[] {
  return Array.from({ length: count }, (_, i) => ({ id: -(offset + i + 1), rank: 3, suit: 'espadas' }));
}

export function stateFromView(view: PlayerView): GameState {
  let offset = 0;
  const take = (count: number) => {
    const cards = placeholders(count, offset);
    offset += count;
    return cards;
  };
  const hands = view.handCounts.map((count, seat) => (seat === view.seat ? view.hand.map((card) => ({ ...card })) : take(count)));
  return {
    rules: view.rules,
    seats: view.seats,
    hands,
    known: view.known.map((cards) => cards.map((card) => ({ ...card }))),
    melds: view.melds.map((meld) => ({ ...meld, cards: meld.cards.map((card) => ({ ...card })) })),
    nextMeldId: view.melds.reduce((max, meld) => Math.max(max, meld.id), 0) + 1,
    monte: take(view.monteCount),
    lixo: view.lixo.map((card) => ({ ...card })),
    lixoTop: view.lixoTop,
    mortos: Array.from({ length: view.mortosLeft }, () => take(11)),
    mortoTaken: [...view.mortoTaken],
    mortoCount: [...view.mortoCount],
    minimo: [...view.minimo],
    aberto: [...view.aberto],
    turn: view.turn,
    phase: view.phase,
    starter: view.starter,
    hand: view.handNumber,
    scores: [...view.scores],
    history: [],
    winner: view.winner,
    rngState: 1,
    log: [],
    actions: view.actions,
  };
}
