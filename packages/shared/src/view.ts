import type { Card } from './cards';
import type { GameState, HandResult, LastAction, Meld, Phase } from './game';
import type { RuleSet } from './rules';

export interface PlayerView {
  seat: number;
  seats: number;
  rules: RuleSet;
  hand: Card[];
  handCounts: number[];
  revealed: Card[][] | null;
  known: Card[][];
  melds: Meld[];
  lixo: Card[];
  lixoTop: number | null;
  monteCount: number;
  mortosLeft: number;
  mortoTaken: boolean[];
  mortoCount: number[];
  minimo: number[];
  aberto: boolean[];
  turn: number;
  phase: Phase;
  starter: number;
  handNumber: number;
  scores: number[];
  history: HandResult[];
  winner: number | null;
  log: LastAction[];
  actions: number;
}

export function viewFor(state: GameState, seat: number): PlayerView {
  return {
    seat,
    seats: state.seats,
    rules: state.rules,
    hand: state.hands[seat].map((card) => ({ ...card })),
    handCounts: state.hands.map((hand) => hand.length),
    known: state.known.map((cards) => cards.map((card) => ({ ...card }))),
    revealed: state.phase === 'fimDeMao' || state.phase === 'fimDePartida' ? state.hands.map((hand) => hand.map((card) => ({ ...card }))) : null,
    melds: state.melds.map((meld) => ({ ...meld, cards: meld.cards.map((card) => ({ ...card })) })),
    lixo: state.lixo.map((card) => ({ ...card })),
    lixoTop: state.lixoTop,
    monteCount: state.monte.length,
    mortosLeft: state.mortos.length,
    mortoTaken: [...state.mortoTaken],
    mortoCount: [...state.mortoCount],
    minimo: [...state.minimo],
    aberto: [...state.aberto],
    turn: state.turn,
    phase: state.phase,
    starter: state.starter,
    handNumber: state.hand,
    scores: [...state.scores],
    history: state.history.map((item) => ({ ...item, teams: item.teams.map((team) => ({ ...team })) })),
    winner: state.winner,
    log: state.log.map((entry) => ({ ...entry })),
    actions: state.actions,
  };
}
