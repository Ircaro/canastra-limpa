import { isJoker, rankLabel, type Card, type Suit } from '@canastra/shared';
import { el } from './dom';

const SYMBOLS: Record<Suit, string> = { espadas: '♠', copas: '♥', paus: '♣', ouros: '♦' };
const SUIT_NAMES: Record<Suit, string> = { espadas: 'espadas', copas: 'copas', paus: 'paus', ouros: 'ouros' };
const SUIT_ORDER: Suit[] = ['espadas', 'copas', 'paus', 'ouros'];

export function suitSymbol(suit: Suit | null): string {
  return suit ? SYMBOLS[suit] : '★';
}

export function cardName(card: Card): string {
  if (isJoker(card)) return 'coringa';
  return `${rankLabel(card.rank)} de ${SUIT_NAMES[card.suit as Suit]}`;
}

export function shortName(card: Card): string {
  if (isJoker(card)) return '★';
  return `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
}

export function cardElement(card: Card, options: { wild?: boolean; selected?: boolean } = {}): HTMLElement {
  const red = card.suit === 'copas' || card.suit === 'ouros';
  const joker = isJoker(card);
  const classes = ['card', joker ? 'joker' : red ? 'red' : 'black'];
  if (options.wild) classes.push('wild');
  if (options.selected) classes.push('selected');
  const label = joker ? 'JK' : rankLabel(card.rank);
  const symbol = joker ? '★' : suitSymbol(card.suit);
  const element = el('div', classes.join(' '), el('span', 'corner', el('b', label === '10' ? 'ten' : '', label), el('i', '', symbol)));
  element.dataset.id = String(card.id);
  element.setAttribute('aria-label', cardName(card));
  return element;
}

export function cardBack(className = ''): HTMLElement {
  return el('div', `card back ${className}`.trim());
}

export type SortMode = 'naipe' | 'valor';

function sortValue(card: Card): number {
  if (isJoker(card)) return 100;
  return card.rank === 1 ? 14 : card.rank;
}

export function sortHand(cards: readonly Card[], mode: SortMode): Card[] {
  return [...cards].sort((a, b) => {
    const jokerA = isJoker(a);
    const jokerB = isJoker(b);
    if (jokerA !== jokerB) return jokerA ? 1 : -1;
    const suitA = a.suit ? SUIT_ORDER.indexOf(a.suit) : 9;
    const suitB = b.suit ? SUIT_ORDER.indexOf(b.suit) : 9;
    if (mode === 'naipe') return suitA - suitB || sortValue(a) - sortValue(b) || a.id - b.id;
    return sortValue(a) - sortValue(b) || suitA - suitB || a.id - b.id;
  });
}
