import { CANASTRA_SIZE, isJoker, rankLabel, type Card, type Suit } from './cards';

export interface Arrangement {
  suit: Suit;
  order: Card[];
  wild: number | null;
  low: number;
  high: number;
}

interface Option {
  naturals: Card[];
  wild: Card | null;
}

function options(cards: readonly Card[], lockedWild: number | null): Option[] {
  const jokers = cards.filter(isJoker);
  if (jokers.length > 1) return [];
  const twos = cards.filter((card) => card.rank === 2);
  const others = cards.filter((card) => card.rank !== 2 && !isJoker(card));
  const locked = twos.find((card) => card.id === lockedWild);
  if (locked) return jokers.length === 0 ? [{ naturals: [...others, ...twos.filter((card) => card !== locked)], wild: locked }] : [];
  const result: Option[] = [];
  if (jokers.length === 1) result.push({ naturals: [...others, ...twos], wild: jokers[0] });
  else {
    result.push({ naturals: [...others, ...twos], wild: null });
    for (const two of twos) result.push({ naturals: [...others, ...twos.filter((card) => card !== two)], wild: two });
  }
  return result;
}

function fit(option: Option): Arrangement | null {
  const { naturals, wild } = option;
  if (naturals.length === 0) return null;
  const suit = naturals[0].suit;
  if (!suit || naturals.some((card) => card.suit !== suit)) return null;
  const aces = naturals.filter((card) => card.rank === 1);
  if (aces.length > 2) return null;
  const assignments = aces.length === 0 ? [[]] : aces.length === 1 ? [[1], [14]] : [[1, 14]];
  for (const assignment of assignments) {
    const valued = naturals.map((card) => ({ card, value: card.rank === 1 ? assignment[aces.indexOf(card)] : card.rank }));
    valued.sort((a, b) => a.value - b.value);
    if (valued.some((item, i) => i > 0 && item.value === valued[i - 1].value)) continue;
    let low = valued[0].value;
    let high = valued[valued.length - 1].value;
    const gaps = high - low + 1 - valued.length;
    if (gaps > (wild ? 1 : 0)) continue;
    if (wild && gaps === 0) {
      if (high < 14) high++;
      else if (low > 1) low--;
      else continue;
    }
    if (high - low + 1 > 14) continue;
    const order: Card[] = [];
    let next = 0;
    for (let value = low; value <= high; value++) {
      if (next < valued.length && valued[next].value === value) order.push(valued[next++].card);
      else if (wild) order.push(wild);
    }
    return { suit, order, wild: wild ? wild.id : null, low, high };
  }
  return null;
}

export function arrangeSequence(cards: readonly Card[], lockedWild: number | null = null): Arrangement | null {
  if (cards.length < 3) return null;
  let best: Arrangement | null = null;
  for (const option of options(cards, lockedWild)) {
    const arranged = fit(option);
    if (!arranged) continue;
    if (arranged.wild === null) return arranged;
    best ??= arranged;
  }
  return best;
}

export function naturalHigh(arrangement: Arrangement): number {
  return arrangement.order.reduce((high, card, index) => (card.id === arrangement.wild ? high : Math.max(high, arrangement.low + index)), 0);
}

export const LIMPA_ATE = 8;
export const CANASTRAO_SIZE = 13;
export const CANASTRAO_REAL_SIZE = 14;

export type CanastraKind = 'limpa' | 'suja' | 'canastrao' | 'canastraoReal';

export function canastraKind(cards: readonly Card[], wild: number | null): CanastraKind | null {
  if (cards.length < CANASTRA_SIZE) return null;
  if (wild !== null) return 'suja';
  if (cards.length === CANASTRAO_REAL_SIZE) return 'canastraoReal';
  if (cards.length === CANASTRAO_SIZE) return 'canastrao';
  return 'limpa';
}

export const CANASTRA_BONUS: Record<CanastraKind, number> = { limpa: 200, suja: 100, canastrao: 500, canastraoReal: 1000 };

export function isCanastra(cards: readonly Card[]): boolean {
  return cards.length >= CANASTRA_SIZE;
}

export function explainSequence(cards: readonly Card[], expectedSuit: Suit | null = null): string {
  if (cards.length < 3) return 'Um jogo precisa de pelo menos 3 cartas.';
  const naturals = cards.filter((card) => !isJoker(card) && card.rank !== 2);
  const suits = new Set(naturals.map((card) => card.suit));
  if (suits.size > 1) return expectedSuit ? `Naipe diferente: esse jogo é de ${expectedSuit}.` : 'Naipe diferente: o jogo precisa ser todo do mesmo naipe.';
  const suit = naturals[0]?.suit ?? expectedSuit;
  const twos = cards.filter((card) => card.rank === 2);
  const sameSuitTwos = twos.filter((card) => card.suit === suit).length;
  const wilds = cards.filter(isJoker).length + twos.length - Math.min(1, sameSuitTwos);
  if (naturals.length === 0 && sameSuitTwos === 0) return 'Um jogo precisa de cartas além dos coringas.';
  if (wilds > 1) return 'Cada jogo aceita só um coringa.';
  const ranks = naturals.map((card) => card.rank);
  const repeated = ranks.filter((rank, i) => ranks.indexOf(rank) !== i);
  if (repeated.length === 1 && repeated[0] === 1) return 'Dois Ases no mesmo jogo só valem no Canastrão Real, de Ás a Ás completo.';
  if (repeated.length > 0) return 'Carta repetida: a sequência não pode ter duas cartas iguais.';
  const values = [...new Set(sameSuitTwos > 0 ? [...ranks, 2] : ranks)].sort((a, b) => a - b);
  const linear = [values, values.map((value) => (value === 1 ? 14 : value))].map(missingBetween).sort((a, b) => a.length - b.length)[0];
  const gaps = values.map((value, i) => (i === values.length - 1 ? values[0] + 13 : values[i + 1]) - value - 1);
  const circular = 13 - values.length - Math.max(...gaps);
  if (circular <= wilds && linear.length > wilds) return 'A sequência não dá a volta: K-A-2 não vale.';
  if (linear.length === 0 || linear.length > 3) return 'Faltam cartas demais para fechar a sequência.';
  const names = linear.map((rank) => `o ${rank === 1 || rank === 14 ? 'Ás' : rankLabel(rank)}`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  const suitName = suit ? ` de ${suit}` : '';
  const verb = names.length === 1 ? 'Falta' : 'Faltam';
  return wilds > 0 ? `Mesmo com o coringa, ${verb.toLowerCase()} ${list}${suitName} para fechar a sequência.` : `${verb} ${list}${suitName} para fechar a sequência.`;
}

function missingBetween(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const present = new Set(sorted);
  const missing: number[] = [];
  for (let value = sorted[0]; value <= sorted[sorted.length - 1]; value++) if (!present.has(value)) missing.push(value);
  return missing;
}
