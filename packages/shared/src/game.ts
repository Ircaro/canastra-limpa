import { CANASTRA_SIZE, HAND_SIZE, MORTO_SIZE, cardPoints, createDeck, shuffle, type Card } from './cards';
import { CANASTRA_BONUS, LIMPA_ATE, arrangeSequence, canastraKind, explainSequence, naturalHigh, type Arrangement } from './melds';
import { nextRandom } from './rng';
import { ABERTURA_MINIMA, ABERTURA_PASSO, VULNERAVEL_PONTOS, type RuleSet } from './rules';

export type Phase = 'comprar' | 'jogar' | 'fimDeMao' | 'fimDePartida';

export interface Meld {
  id: number;
  team: number;
  cards: Card[];
  wild: number | null;
  limpavel: boolean;
}

export function startsLimpavel(arrangement: Arrangement): boolean {
  return naturalHigh(arrangement) <= LIMPA_ATE;
}

export function extendMeld(meld: Pick<Meld, 'cards' | 'wild' | 'limpavel'>, cards: readonly Card[], rules: Pick<RuleSet, 'duque'>): Arrangement | null {
  const all = [...meld.cards, ...cards];
  const free = arrangeSequence(all);
  if (rules.duque !== 'ate8' || meld.wild === null) return free;
  if (meld.limpavel && free && naturalHigh(free) <= LIMPA_ATE) return free;
  return arrangeSequence(all, meld.wild);
}

export interface TeamScore {
  cartas: number;
  canastrasLimpas: number;
  canastrasSujas: number;
  canastroes: number;
  canastroesReais: number;
  bonusCanastras: number;
  batida: number;
  mao: number;
  morto: number;
  total: number;
}

export interface HandResult {
  hand: number;
  batida: number | null;
  teams: TeamScore[];
}

export type LastAction =
  | { seat: number; type: 'comprar' }
  | { seat: number; type: 'pegarLixo'; count: number }
  | { seat: number; type: 'baixar'; meld: number }
  | { seat: number; type: 'adicionar'; meld: number }
  | { seat: number; type: 'descartar'; card: Card }
  | { seat: number; type: 'morto' }
  | { seat: number; type: 'bater' }
  | { seat: number; type: 'vulneravel'; minimo: number }
  | { seat: number | null; type: 'monteVazio' };

export interface GameState {
  rules: RuleSet;
  seats: number;
  hands: Card[][];
  known: Card[][];
  melds: Meld[];
  nextMeldId: number;
  monte: Card[];
  lixo: Card[];
  lixoTop: number | null;
  mortos: Card[][];
  mortoTaken: boolean[];
  mortoCount: number[];
  minimo: number[];
  aberto: boolean[];
  turn: number;
  phase: Phase;
  starter: number;
  hand: number;
  scores: number[];
  history: HandResult[];
  winner: number | null;
  rngState: number;
  log: LastAction[];
  actions: number;
}

export type Action =
  | { type: 'comprar' }
  | { type: 'pegarLixo'; cards?: number[]; meld?: number }
  | { type: 'baixar'; cards: number[] }
  | { type: 'adicionar'; meld: number; cards: number[] }
  | { type: 'descartar'; card: number };

export type ActionResult = { ok: true } | { ok: false; error: string };

const LOG_SIZE = 12;

export function teamOf(seat: number): number {
  return seat % 2;
}

export function teamSeats(state: Pick<GameState, 'seats'>, team: number): number[] {
  return Array.from({ length: state.seats }, (_, seat) => seat).filter((seat) => teamOf(seat) === team);
}

export function createGame(seats: number, rules: RuleSet, seed: number, starter = 0): GameState {
  if (seats !== 2 && seats !== 4) throw new Error('O jogo aceita 2 ou 4 jogadores');
  const state: GameState = {
    rules,
    seats,
    hands: [],
    known: [],
    melds: [],
    nextMeldId: 1,
    monte: [],
    lixo: [],
    lixoTop: null,
    mortos: [],
    mortoTaken: [false, false],
    mortoCount: [0, 0],
    minimo: [ABERTURA_MINIMA, ABERTURA_MINIMA],
    aberto: [false, false],
    turn: 0,
    phase: 'comprar',
    starter: starter % seats,
    hand: 0,
    scores: [0, 0],
    history: [],
    winner: null,
    rngState: seed >>> 0,
    log: [],
    actions: 0,
  };
  deal(state);
  return state;
}

function deal(state: GameState): void {
  const deck = shuffle(createDeck(state.rules), () => nextRandom(state));
  state.hands = Array.from({ length: state.seats }, () => deck.splice(0, HAND_SIZE));
  state.known = Array.from({ length: state.seats }, () => []);
  state.mortos = [deck.splice(0, MORTO_SIZE), deck.splice(0, MORTO_SIZE)];
  state.monte = deck;
  state.lixo = [];
  state.lixoTop = null;
  state.melds = [];
  state.mortoTaken = [false, false];
  state.mortoCount = [0, 0];
  state.aberto = [false, false];
  state.minimo = [ABERTURA_MINIMA, ABERTURA_MINIMA];
  state.turn = state.starter;
  state.phase = 'comprar';
  state.hand++;
  state.log = [];
}

export function nextHand(state: GameState): ActionResult {
  if (state.phase !== 'fimDeMao') return { ok: false, error: 'A mão ainda não terminou' };
  state.starter = (state.starter + 1) % state.seats;
  deal(state);
  return { ok: true };
}

function record(state: GameState, entry: LastAction): void {
  state.actions = (state.actions ?? 0) + 1;
  state.log.push(entry);
  if (state.log.length > LOG_SIZE) state.log.shift();
}

type OpeningState = Pick<GameState, 'rules' | 'scores' | 'aberto'>;

export function isVulnerable(state: Pick<GameState, 'rules' | 'scores'>, team: number): boolean {
  return state.rules.vulneravel && state.rules.meta !== 0 && state.scores[team] >= VULNERAVEL_PONTOS;
}

export function needsOpening(state: OpeningState, team: number): boolean {
  return isVulnerable(state, team) && !state.aberto[team];
}

export function openingPoints(melds: readonly Meld[], team: number): number {
  return melds.filter((meld) => meld.team === team).reduce((sum, meld) => sum + meld.cards.reduce((acc, card) => acc + cardPoints(card), 0), 0);
}

function markOpened(state: GameState, seat: number): void {
  const team = teamOf(seat);
  if (needsOpening(state, team) && openingPoints(state.melds, team) >= state.minimo[team]) state.aberto[team] = true;
}

function revertOpening(state: GameState, seat: number): void {
  const team = teamOf(seat);
  if (!needsOpening(state, team)) return;
  const returned = state.melds.filter((meld) => meld.team === team).flatMap((meld) => meld.cards);
  if (returned.length === 0) return;
  state.melds = state.melds.filter((meld) => meld.team !== team);
  state.hands[seat] = [...state.hands[seat], ...returned];
  remember(state, seat, returned);
  state.minimo[team] += ABERTURA_PASSO;
  record(state, { seat, type: 'vulneravel', minimo: state.minimo[team] });
}

export type EmptyHandOutcome = 'morto' | 'bater' | null;

export function hasCleanCanastra(melds: readonly Meld[], team: number): boolean {
  return melds.some((meld) => meld.team === team && meld.cards.length >= CANASTRA_SIZE && meld.wild === null);
}

export function emptyHandOutcome(
  melds: readonly Meld[],
  mortoTaken: readonly boolean[],
  mortosLeft: number,
  team: number,
  rules: Pick<RuleSet, 'mortos'>,
): EmptyHandOutcome {
  if (!mortoTaken[team]) return mortosLeft > 0 ? 'morto' : null;
  if (!hasCleanCanastra(melds, team)) return null;
  return rules.mortos === 'dois' && mortosLeft > 0 ? 'morto' : 'bater';
}

function outcomeFor(state: GameState, seat: number, melds: readonly Meld[] = state.melds): EmptyHandOutcome {
  return emptyHandOutcome(melds, state.mortoTaken, state.mortos.length, teamOf(seat), state.rules);
}

function takeCards(hand: Card[], ids: readonly number[]): Card[] | null {
  if (new Set(ids).size !== ids.length) return null;
  const taken: Card[] = [];
  for (const id of ids) {
    const card = hand.find((item) => item.id === id);
    if (!card) return null;
    taken.push(card);
  }
  return taken;
}

function removeCards(hand: Card[], cards: readonly Card[]): Card[] {
  const ids = new Set(cards.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

function forget(state: GameState, seat: number, cards: readonly Card[]): void {
  if (!state.known[seat]) state.known[seat] = [];
  state.known[seat] = removeCards(state.known[seat], cards);
}

function remember(state: GameState, seat: number, cards: readonly Card[]): void {
  if (!state.known[seat]) state.known[seat] = [];
  state.known[seat].push(...cards.map((card) => ({ ...card })));
}

interface MeldPlan {
  melds: Meld[];
  meldId: number;
  nextMeldId: number;
}

function planMeld(state: GameState, seat: number, cards: Card[], target: number | undefined): MeldPlan | string {
  const team = teamOf(seat);
  if (target === undefined) {
    const arranged = arrangeSequence(cards);
    if (!arranged) return explainSequence(cards);
    const meld: Meld = { id: state.nextMeldId, team, cards: arranged.order, wild: arranged.wild, limpavel: startsLimpavel(arranged) };
    return { melds: [...state.melds, meld], meldId: meld.id, nextMeldId: state.nextMeldId + 1 };
  }
  const existing = state.melds.find((meld) => meld.id === target);
  if (!existing || existing.team !== team) return 'Esse jogo não é da sua dupla';
  const arranged = extendMeld(existing, cards, state.rules);
  if (!arranged) return explainSequence([...existing.cards, ...cards], existing.cards.find((card) => card.id !== existing.wild)?.suit ?? null);
  const updated: Meld = { ...existing, cards: arranged.order, wild: arranged.wild, limpavel: existing.limpavel && naturalHigh(arranged) <= LIMPA_ATE };
  return { melds: state.melds.map((meld) => (meld.id === target ? updated : meld)), meldId: target, nextMeldId: state.nextMeldId };
}

function emptyHandProblem(state: GameState, team: number): string {
  if (!state.mortoTaken[team] && state.mortos.length === 0) {
    return 'Só pode bater quem pegou o morto. Sua dupla não pegou e não sobrou morto na mesa, então guarde pelo menos 1 carta até o monte acabar.';
  }
  if (!hasCleanCanastra(state.melds, team)) return 'Para bater, a dupla precisa de uma canastra limpa. Sem ela, guarde pelo menos 1 carta.';
  return 'Você não pode ficar sem cartas agora.';
}

function checkRemaining(state: GameState, seat: number, remaining: number, melds: readonly Meld[]): string | null {
  if (remaining > 1) return null;
  const team = teamOf(seat);
  if (needsOpening(state, team) && openingPoints(melds, team) < state.minimo[team]) return `Vulnerável: sua dupla precisa abrir com ${state.minimo[team]} pontos antes de ficar sem cartas`;
  if (outcomeFor(state, seat, melds)) return null;
  return emptyHandProblem(state, team);
}

function handEmptied(state: GameState, seat: number, byDiscard: boolean): void {
  const outcome = outcomeFor(state, seat);
  if (outcome === 'bater') {
    record(state, { seat, type: 'bater' });
    endHand(state, teamOf(seat));
    return;
  }
  const morto = state.mortos.pop();
  if (!morto) return;
  state.hands[seat] = morto;
  state.mortoTaken[teamOf(seat)] = true;
  state.mortoCount[teamOf(seat)]++;
  record(state, { seat, type: 'morto' });
  if (byDiscard) passTurn(state);
}

function passTurn(state: GameState): void {
  state.lixoTop = null;
  state.turn = (state.turn + 1) % state.seats;
  state.phase = 'comprar';
  if (state.monte.length > 0) return;
  const morto = state.mortos.pop();
  if (morto) {
    state.monte = morto;
    record(state, { seat: null, type: 'monteVazio' });
    return;
  }
  record(state, { seat: null, type: 'monteVazio' });
  endHand(state, null);
}

export function applyAction(state: GameState, seat: number, action: Action): ActionResult {
  if (state.phase === 'fimDeMao' || state.phase === 'fimDePartida') return { ok: false, error: 'A mão já terminou' };
  if (seat !== state.turn) return { ok: false, error: 'Não é a sua vez' };
  const hand = state.hands[seat];

  if (action.type === 'comprar') {
    if (state.phase !== 'comprar') return { ok: false, error: 'Você já comprou nesta vez' };
    const card = state.monte.pop();
    if (!card) return { ok: false, error: 'O monte está vazio' };
    hand.push(card);
    state.phase = 'jogar';
    record(state, { seat, type: 'comprar' });
    return { ok: true };
  }

  if (action.type === 'pegarLixo') {
    if (state.phase !== 'comprar') return { ok: false, error: 'Você já comprou nesta vez' };
    const top = state.lixo[state.lixo.length - 1];
    if (!top) return { ok: false, error: 'O lixo está vazio' };
    if (hand.length === 1 && state.lixo.length === 1) return { ok: false, error: 'Com uma carta só na mão, não dá para trocar pela única carta do lixo' };
    state.lixoTop = state.lixo.length === 1 ? top.id : null;
    if (state.rules.lixo === 'aberto') {
      const count = state.lixo.length;
      remember(state, seat, state.lixo);
      hand.push(...state.lixo);
      state.lixo = [];
      state.phase = 'jogar';
      record(state, { seat, type: 'pegarLixo', count });
      return { ok: true };
    }
    const used = takeCards(hand, action.cards ?? []);
    const invalid = !used ? 'Cartas inválidas' : action.meld === undefined && used.length < 2 ? 'No lixo fechado, use a carta de cima num jogo' : null;
    const plan = used && !invalid ? planMeld(state, seat, [top, ...used], action.meld) : invalid;
    if (!used || typeof plan === 'string' || plan === null) {
      state.lixoTop = null;
      return { ok: false, error: typeof plan === 'string' ? plan : 'Cartas inválidas' };
    }
    const rest = state.lixo.slice(0, -1);
    const remaining = hand.length - used.length + rest.length;
    const problem = checkRemaining(state, seat, remaining, plan.melds);
    if (problem) {
      state.lixoTop = null;
      return { ok: false, error: problem };
    }
    state.melds = plan.melds;
    state.nextMeldId = plan.nextMeldId;
    state.hands[seat] = [...removeCards(hand, used), ...rest];
    remember(state, seat, rest);
    markOpened(state, seat);
    state.lixo = [];
    state.phase = 'jogar';
    record(state, { seat, type: 'pegarLixo', count: rest.length + 1 });
    if (state.hands[seat].length === 0) handEmptied(state, seat, false);
    return { ok: true };
  }

  if (action.type === 'baixar' || action.type === 'adicionar') {
    if (state.phase !== 'jogar') return { ok: false, error: 'Compre uma carta antes de jogar' };
    const cards = takeCards(hand, action.cards);
    if (!cards || cards.length === 0) return { ok: false, error: 'Cartas inválidas' };
    const plan = planMeld(state, seat, cards, action.type === 'adicionar' ? action.meld : undefined);
    if (typeof plan === 'string') return { ok: false, error: plan };
    const problem = checkRemaining(state, seat, hand.length - cards.length, plan.melds);
    if (problem) return { ok: false, error: problem };
    const left = removeCards(hand, cards);
    if (left.length === 1 && left[0].id === state.lixoTop) return { ok: false, error: 'Não dá para ficar só com a carta que você pegou do lixo: ela era a única do lixo e não pode ser descartada de volta.' };
    state.melds = plan.melds;
    state.nextMeldId = plan.nextMeldId;
    state.hands[seat] = removeCards(hand, cards);
    forget(state, seat, cards);
    markOpened(state, seat);
    record(state, { seat, type: action.type, meld: plan.meldId });
    if (state.hands[seat].length === 0) handEmptied(state, seat, false);
    return { ok: true };
  }

  if (state.phase !== 'jogar') return { ok: false, error: 'Compre uma carta antes de descartar' };
  const card = hand.find((item) => item.id === action.card);
  if (!card) return { ok: false, error: 'Carta inválida' };
  if (card.id === state.lixoTop) return { ok: false, error: 'Você pegou só essa carta do lixo, então não pode descartar ela mesma. Descarte outra.' };
  if (hand.length === 1 && !outcomeFor(state, seat)) return { ok: false, error: emptyHandProblem(state, teamOf(seat)) };
  revertOpening(state, seat);
  state.hands[seat] = removeCards(state.hands[seat], [card]);
  forget(state, seat, [card]);
  state.lixo.push(card);
  record(state, { seat, type: 'descartar', card });
  if (state.hands[seat].length === 0) handEmptied(state, seat, true);
  else passTurn(state);
  return { ok: true };
}

export const EVENT_PAUSE_MS = 2300;

export const LIXO_PAUSE_MS = 450;
export const LIXO_CARD_PAUSE_MS = 55;
export const LIXO_ANIMATED_CARDS = 14;

export function lixoPause(count: number): number {
  return LIXO_PAUSE_MS + LIXO_CARD_PAUSE_MS * Math.min(count, LIXO_ANIMATED_CARDS);
}

export function eventPause(state: Pick<GameState, 'log' | 'monte'>, fresh: number): number {
  if (fresh <= 0) return 0;
  return state.log.slice(-Math.min(fresh, state.log.length)).reduce((sum, entry) => {
    if (entry.type === 'morto' || (entry.type === 'monteVazio' && state.monte.length > 0)) return sum + EVENT_PAUSE_MS;
    if (entry.type === 'pegarLixo') return sum + lixoPause(entry.count);
    return sum;
  }, 0);
}

export function fallbackAction(state: GameState, seat: number): Action {
  if (state.phase === 'comprar') return { type: 'comprar' };
  const hand = state.hands[seat];
  const card = hand.find((item) => item.id !== state.lixoTop) ?? hand[0];
  return { type: 'descartar', card: card.id };
}

export function tablePoints(melds: readonly Meld[], team: number): number {
  return melds
    .filter((meld) => meld.team === team)
    .reduce((sum, meld) => {
      const cards = meld.cards.reduce((acc, card) => acc + cardPoints(card), 0);
      const kind = canastraKind(meld.cards, meld.wild);
      return sum + cards + (kind ? CANASTRA_BONUS[kind] : 0);
    }, 0);
}

export function scoreTeam(state: GameState, team: number, batida: number | null): TeamScore {
  const melds = state.melds.filter((meld) => meld.team === team);
  const cartas = melds.reduce((sum, meld) => sum + meld.cards.reduce((acc, card) => acc + cardPoints(card), 0), 0);
  const kinds = melds.map((meld) => canastraKind(meld.cards, meld.wild));
  const count = (kind: string) => kinds.filter((item) => item === kind).length;
  const canastrasLimpas = count('limpa');
  const canastrasSujas = count('suja');
  const canastroes = count('canastrao');
  const canastroesReais = count('canastraoReal');
  const bonusCanastras = kinds.reduce((sum, kind) => sum + (kind ? CANASTRA_BONUS[kind] : 0), 0);
  const mao = -teamSeats(state, team).reduce((sum, seat) => sum + state.hands[seat].reduce((acc, card) => acc + cardPoints(card), 0), 0);
  const morto = state.mortoTaken[team] ? 0 : -100;
  const bonus = batida === team ? 100 : 0;
  return {
    cartas,
    canastrasLimpas,
    canastrasSujas,
    canastroes,
    canastroesReais,
    bonusCanastras,
    batida: bonus,
    mao,
    morto,
    total: cartas + bonusCanastras + bonus + mao + morto,
  };
}

export function finishHand(state: GameState, batida: number | null): void {
  if (state.phase === 'comprar' || state.phase === 'jogar') endHand(state, batida);
}

function endHand(state: GameState, batida: number | null): void {
  const teams = [0, 1].map((team) => scoreTeam(state, team, batida));
  teams.forEach((score, team) => (state.scores[team] += score.total));
  state.history.push({ hand: state.hand, batida, teams });
  const [a, b] = state.scores;
  const reached = state.rules.meta === 0 || a >= state.rules.meta || b >= state.rules.meta;
  if (reached && a !== b) {
    state.winner = a > b ? 0 : 1;
    state.phase = 'fimDePartida';
  } else {
    state.phase = 'fimDeMao';
  }
}
