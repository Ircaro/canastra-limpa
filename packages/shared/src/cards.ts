import type { RuleSet } from './rules';

export type Suit = 'copas' | 'ouros' | 'paus' | 'espadas';

export const SUITS: readonly Suit[] = ['espadas', 'copas', 'paus', 'ouros'];

export interface Card {
  id: number;
  rank: number;
  suit: Suit | null;
}

export const JOKER_RANK = 0;
export const HAND_SIZE = 11;
export const MORTO_SIZE = 11;
export const CANASTRA_SIZE = 7;

export function isJoker(card: Card): boolean {
  return card.rank === JOKER_RANK;
}

export function isWild(card: Card): boolean {
  return card.rank === JOKER_RANK || card.rank === 2;
}

export function cardPoints(card: Card): number {
  if (card.rank === JOKER_RANK) return 20;
  if (card.rank === 1) return 15;
  if (card.rank === 2) return 10;
  if (card.rank <= 7) return 5;
  return 10;
}

export function rankLabel(rank: number): string {
  if (rank === JOKER_RANK) return 'Coringa';
  if (rank === 1 || rank === 14) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

export function createDeck(rules: RuleSet): Card[] {
  const cards: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) cards.push({ id: cards.length, rank, suit });
    }
  }
  if (rules.coringas === 'doisEJokers') {
    for (let i = 0; i < 4; i++) cards.push({ id: cards.length, rank: JOKER_RANK, suit: null });
  }
  return cards;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
