import { CANASTRA_SIZE, cardPoints, isJoker, isWild, type Card } from './cards';
import { applyAction, emptyHandOutcome, extendMeld, needsOpening, openingPoints, teamOf, type Action, type Meld } from './game';
import { LIMPA_ATE, arrangeSequence, naturalHigh } from './melds';
import { stateFromView } from './protocol';
import { viewFor, type PlayerView } from './view';

function ownMelds(view: PlayerView): Meld[] {
  return view.melds.filter((meld) => meld.team === teamOf(view.seat));
}

function rivalMelds(view: PlayerView): Meld[] {
  return view.melds.filter((meld) => meld.team !== teamOf(view.seat));
}

function meldPriority(meld: Meld): number {
  const size = meld.cards.length;
  if (size >= CANASTRA_SIZE) return -size;
  return size === CANASTRA_SIZE - 1 ? 100 : size;
}

function meldsByPriority(view: PlayerView): Meld[] {
  return ownMelds(view).sort((a, b) => meldPriority(b) - meldPriority(a));
}

function partnerKnown(view: PlayerView): Card[] {
  if (view.seats !== 4) return [];
  return view.known[(view.seat + 2) % 4] ?? [];
}

function partnerFills(view: PlayerView, meld: Meld, card: Card): boolean {
  return partnerKnown(view).some((known) => known.suit === card.suit && known.rank === card.rank && extended(meld, [known]) !== null);
}

function partnerCanUse(view: PlayerView, meld: Meld): boolean {
  return partnerKnown(view).some((known) => !isWild(known) && keepsClean(meld, extended(meld, [known])));
}

function rivalsThreaten(view: PlayerView): boolean {
  const team = teamOf(view.seat);
  const rivals = Array.from({ length: view.seats }, (_, seat) => seat).filter((seat) => teamOf(seat) !== team);
  const rivalMorto = view.mortoTaken[1 - team];
  return rivalMorto || rivals.some((seat) => view.handCounts[seat] <= 4);
}

function canEmpty(view: PlayerView, melds: readonly Meld[] = view.melds): boolean {
  return emptyHandOutcome(melds, view.mortoTaken, view.mortosLeft, teamOf(view.seat), view.rules) !== null;
}

function remainingOk(view: PlayerView, remaining: number, melds: readonly Meld[] = view.melds): boolean {
  return remaining > 1 || canEmpty(view, melds);
}

function withMeld(melds: readonly Meld[], meld: Meld): Meld[] {
  return melds.some((item) => item.id === meld.id) ? melds.map((item) => (item.id === meld.id ? meld : item)) : [...melds, meld];
}

let activeRules: PlayerView['rules'] | null = null;

function extended(meld: Meld, cards: readonly Card[]): Meld | null {
  const arranged = activeRules ? extendMeld(meld, cards, activeRules) : arrangeSequence([...meld.cards, ...cards]);
  return arranged ? { ...meld, cards: arranged.order, wild: arranged.wild, limpavel: meld.limpavel && naturalHigh(arranged) <= LIMPA_ATE } : null;
}

function keepsClean(meld: Meld, next: Meld | null): next is Meld {
  return next !== null && (meld.wild !== null || next.wild === null);
}

function value(card: Card, aceHigh: boolean): number {
  return card.rank === 1 && aceHigh ? 14 : card.rank;
}

function naturalRuns(cards: readonly Card[]): Card[][] {
  const runs: Card[][] = [];
  const suits = new Set(cards.map((card) => card.suit).filter((suit) => suit !== null));
  for (const suit of suits) {
    const ofSuit = cards.filter((card) => card.suit === suit);
    for (const aceHigh of [false, true]) {
      const byValue = new Map<number, Card>();
      for (const card of ofSuit) if (!byValue.has(value(card, aceHigh))) byValue.set(value(card, aceHigh), card);
      const values = [...byValue.keys()].sort((a, b) => a - b);
      let run: Card[] = [];
      let previous = -10;
      for (const current of values) {
        if (current !== previous + 1) {
          if (run.length >= 3) runs.push(run);
          run = [];
        }
        run.push(byValue.get(current) as Card);
        previous = current;
      }
      if (run.length >= 3) runs.push(run);
    }
  }
  return runs.filter((run) => arrangeSequence(run)?.wild === null).sort((a, b) => b.length - a.length);
}

function topUseful(view: PlayerView, top: Card): boolean {
  const after = view.hand.length + view.lixo.length;
  for (const meld of meldsByPriority(view)) {
    const next = extended(meld, [top]);
    if (keepsClean(meld, next) && remainingOk(view, after - 1, withMeld(view.melds, next))) return true;
  }
  return naturalRuns([...view.hand, top]).some((run) => {
    if (!run.some((card) => card.id === top.id)) return false;
    const meld: Meld = { id: -1, team: teamOf(view.seat), cards: run, wild: null, limpavel: true };
    return remainingOk(view, after - run.length, withMeld(view.melds, meld));
  });
}

function fechadoUse(view: PlayerView, top: Card): Action | null {
  const remainingAfter = (used: number) => view.hand.length - used + view.lixo.length - 1;
  for (const meld of meldsByPriority(view)) {
    const next = extended(meld, [top]);
    if (!keepsClean(meld, next)) continue;
    if (remainingOk(view, remainingAfter(0), withMeld(view.melds, next))) return { type: 'pegarLixo', meld: meld.id, cards: [] };
  }
  const runs = naturalRuns([...view.hand, top]).filter((run) => run.some((card) => card.id === top.id));
  for (const run of runs) {
    const used = run.filter((card) => card.id !== top.id);
    if (remainingOk(view, remainingAfter(used.length))) return { type: 'pegarLixo', cards: used.map((card) => card.id) };
  }
  return null;
}

function drawDecision(view: PlayerView): Action {
  const top = view.lixo[view.lixo.length - 1];
  if (!top) return { type: 'comprar' };
  if (view.hand.length === 1 && view.lixo.length === 1) return { type: 'comprar' };
  if (view.rules.lixo === 'fechado') {
    const use = fechadoUse(view, top);
    if (use && needsOpening(view, teamOf(view.seat)) && !opensWith(view, use)) return { type: 'comprar' };
    return use ?? { type: 'comprar' };
  }
  const worth = topUseful(view, top) || (view.lixo.length >= 5 && view.hand.length <= 8) || lixoWorth(view);
  return worth ? { type: 'pegarLixo' } : { type: 'comprar' };
}

function cardValue(view: PlayerView, card: Card): number {
  if (isWild(card)) return 1;
  if (ownMelds(view).some((meld) => keepsClean(meld, extended(meld, [card])))) return 1;
  let best = 0;
  for (const other of view.hand) {
    if (isWild(other) || other.suit !== card.suit) continue;
    const distance = Math.min(Math.abs(other.rank - card.rank), Math.abs(value(other, true) - value(card, true)));
    if (distance === 1) best = Math.max(best, 1);
    else if (distance === 2) best = Math.max(best, 0.5);
  }
  return best;
}

function lixoWorth(view: PlayerView): boolean {
  const score = view.lixo.reduce((sum, card) => sum + cardValue(view, card), 0);
  const after = view.hand.length + view.lixo.length;
  if (view.lixo.length <= 2) return score >= 1;
  if (after > 22) return score >= 4;
  if (after > 16) return score >= 3;
  return score >= 2 || (score >= 1.5 && view.lixo.length >= 4);
}

function addNatural(view: PlayerView, eager = false): Action | null {
  for (const meld of meldsByPriority(view)) {
    for (const card of view.hand) {
      if (isJoker(card)) continue;
      const next = extended(meld, [card]);
      if (!keepsClean(meld, next)) continue;
      if (card.rank === 2 && next.wild !== meld.wild) continue;
      if (!eager && partnerFills(view, meld, card)) continue;
      if (remainingOk(view, view.hand.length - 1, withMeld(view.melds, next))) return { type: 'adicionar', meld: meld.id, cards: [card.id] };
    }
  }
  return null;
}

function worthLayingDown(view: PlayerView, run: readonly Card[]): boolean {
  if (run.length >= 4 || view.hand.length <= 8) return true;
  if (canEmpty(view) && view.hand.length <= 10) return true;
  return rivalsThreaten(view) || view.monteCount < 12;
}

function newNaturalMeld(view: PlayerView, eager = false): Action | null {
  for (const run of naturalRuns(view.hand)) {
    if (!eager && !worthLayingDown(view, run)) continue;
    const meld: Meld = { id: -1, team: teamOf(view.seat), cards: run, wild: null, limpavel: true };
    if (remainingOk(view, view.hand.length - run.length, withMeld(view.melds, meld))) return { type: 'baixar', cards: run.map((card) => card.id) };
  }
  return null;
}

function useWild(view: PlayerView, random: () => number): Action | null {
  const wild = view.hand.find(isWild);
  if (!wild) return null;
  const clean = ownMelds(view).filter((meld) => meld.wild === null).sort((a, b) => b.cards.length - a.cards.length);
  const cleanCanastra = clean.some((meld) => meld.cards.length >= CANASTRA_SIZE);
  const readyToGoOut = view.mortoTaken[teamOf(view.seat)] && cleanCanastra;
  const urgent = readyToGoOut || (view.hand.length <= 4 && canEmpty(view));
  for (const meld of clean) {
    if (meld.cards.length >= CANASTRA_SIZE) continue;
    if (partnerCanUse(view, meld)) continue;
    if (!cleanCanastra && meld === clean[0]) continue;
    const completes = meld.cards.length === CANASTRA_SIZE - 1 && cleanCanastra;
    if (!urgent && !completes) continue;
    const next = extended(meld, [wild]);
    if (next && remainingOk(view, view.hand.length - 1, withMeld(view.melds, next))) return { type: 'adicionar', meld: meld.id, cards: [wild.id] };
  }
  if (view.hand.length === 2) {
    for (const meld of clean) {
      if (meld.cards.length < CANASTRA_SIZE) continue;
      const next = extended(meld, [wild]);
      if (next && emptyHandOutcome(withMeld(view.melds, next), view.mortoTaken, view.mortosLeft, teamOf(view.seat), view.rules) === 'bater') {
        return { type: 'adicionar', meld: meld.id, cards: [wild.id] };
      }
    }
  }
  if (!(view.hand.length >= 9 || urgent || random() < 0.2)) return null;
  const others = view.hand.filter((card) => !isWild(card));
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const attempt = arrangeSequence([others[i], others[j], wild]);
      if (!attempt) continue;
      const meld: Meld = { id: -1, team: teamOf(view.seat), cards: attempt.order, wild: attempt.wild, limpavel: true };
      if (remainingOk(view, view.hand.length - 3, withMeld(view.melds, meld))) return { type: 'baixar', cards: [others[i].id, others[j].id, wild.id] };
    }
  }
  return null;
}

function keepScore(view: PlayerView, card: Card): number {
  if (isWild(card)) return 1000;
  let score = 0;
  for (const other of view.hand) {
    if (other.id === card.id || other.suit !== card.suit || isWild(other)) continue;
    if (other.rank === card.rank) {
      score -= 10;
      continue;
    }
    const distance = Math.min(Math.abs(other.rank - card.rank), Math.abs(value(other, true) - value(card, true)));
    if (distance === 1) score += 30;
    else if (distance === 2) score += 15;
  }
  if (rivalMelds(view).some((meld) => extended(meld, [card]) !== null)) score += 45;
  if (ownMelds(view).some((meld) => keepsClean(meld, extended(meld, [card])))) score += 60;
  return score - cardPoints(card) * 0.5;
}

function discardDecision(view: PlayerView, random: () => number): Action {
  const options = view.hand.filter((card) => card.id !== view.lixoTop);
  const ranked = (options.length > 0 ? options : view.hand).map((card) => ({ card, score: keepScore(view, card) + random() * 4 })).sort((a, b) => a.score - b.score);
  return { type: 'descartar', card: ranked[0].card.id };
}

const OPENING_RANDOM = () => 0;

function openingMeld(view: PlayerView): Action | null {
  return addNatural(view, true) ?? newNaturalMeld(view, true) ?? useWild(view, OPENING_RANDOM);
}

function opensWith(view: PlayerView, first: Action): boolean {
  const state = stateFromView(view);
  const team = teamOf(view.seat);
  let action: Action | null = first;
  for (let step = 0; action && step < 40; step++) {
    if (!applyAction(state, view.seat, action).ok) break;
    if (state.aberto[team]) return true;
    if (state.turn !== view.seat || state.phase !== 'jogar') break;
    action = openingMeld(viewFor(state, view.seat));
  }
  return state.aberto[team] || openingPoints(state.melds, team) >= state.minimo[team];
}

function openingTurn(view: PlayerView, random: () => number): Action {
  const started = view.melds.some((meld) => meld.team === teamOf(view.seat));
  const next = openingMeld(view);
  if (next && (started || opensWith(view, next))) return next;
  return discardDecision(view, random);
}

function legal(view: PlayerView, action: Action): boolean {
  return applyAction(stateFromView(view), view.seat, action).ok;
}

function decide(view: PlayerView, random: () => number): Action | null {
  if (view.phase === 'comprar') return drawDecision(view);
  if (view.phase !== 'jogar') return null;
  if (needsOpening(view, teamOf(view.seat))) return openingTurn(view, random);
  return addNatural(view) ?? newNaturalMeld(view) ?? useWild(view, random) ?? discardDecision(view, random);
}

export function botAction(view: PlayerView, random: () => number): Action | null {
  if (view.turn !== view.seat) return null;
  activeRules = view.rules;
  const action = decide(view, random);
  if (!action || legal(view, action)) return action;
  if (view.phase === 'comprar') return { type: 'comprar' };
  return discardDecision(view, random);
}
