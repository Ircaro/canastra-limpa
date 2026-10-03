import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, applyAction, botAction, createGame, nextHand, nextRandom, scoreTeam, viewFor, type GameState, type RuleSet } from '../src';

function seeded(seed: number): () => number {
  const holder = { rngState: seed };
  return () => nextRandom(holder);
}

function totalCards(state: GameState): number {
  return state.hands.flat().length + state.melds.flatMap((meld) => meld.cards).length + state.monte.length + state.lixo.length + state.mortos.flat().length;
}

function playMatch(seats: number, rules: RuleSet, seed: number): { state: GameState; hands: number; actions: number } {
  const state = createGame(seats, rules, seed);
  const random = seeded(seed * 31);
  const deck = totalCards(state);
  let actions = 0;
  while (state.phase !== 'fimDePartida' && actions < 200_000) {
    if (state.phase === 'fimDeMao') {
      const last = state.history[state.history.length - 1];
      expect(last.teams.map((team) => team.total)).toEqual([0, 1].map((team) => scoreTeam(state, team, last.batida).total));
      nextHand(state);
      expect(totalCards(state)).toBe(deck);
      continue;
    }
    const seat = state.turn;
    const action = botAction(viewFor(state, seat), random);
    if (!action) throw new Error('Bot sem ação');
    const result = applyAction(state, seat, action);
    if (!result.ok) throw new Error(`Bot tentou ação inválida: ${result.error} (${JSON.stringify(action)})`);
    if (state.phase === 'comprar' || state.phase === 'jogar') expect(totalCards(state)).toBe(deck);
    actions++;
  }
  return { state, hands: state.history.length, actions };
}

describe('partidas entre bots', () => {
  it('terminam em todas as combinações de regras, com 2 e 4 jogadores', () => {
    for (const seats of [2, 4]) {
      for (const lixo of ['aberto', 'fechado'] as const) {
        for (const coringas of ['dois', 'doisEJokers'] as const) {
          for (const [seed, duque, mortos] of [[1, 'ate8', 'dois'], [2, 'sempre', 'um']] as const) {
            const { state } = playMatch(seats, { lixo, coringas, duque, mortos, meta: 2000, vulneravel: true }, seed);
            expect(state.phase).toBe('fimDePartida');
            expect(state.winner).not.toBeNull();
            expect(state.scores[state.winner ?? 0]).toBeGreaterThanOrEqual(2000);
          }
        }
      }
    }
  });

  it('na partida de uma mão, termina na primeira mão sem empate', () => {
    const { state } = playMatch(4, { ...DEFAULT_RULES, meta: 0 }, 7);
    expect(state.phase).toBe('fimDePartida');
    const decisive = state.history.findIndex((item) => item.teams[0].total !== item.teams[1].total);
    expect(state.history.length).toBe(decisive + 1);
  });

  it('vulneráveis, abrem com os pontos mínimos sem ter os jogos devolvidos', () => {
    let penalties = 0;
    let vulnerableHands = 0;
    for (const seed of [3, 8, 21, 34, 55]) {
      for (const seats of [2, 4]) {
        const { state } = playMatch(seats, { ...DEFAULT_RULES, meta: 3000 }, seed);
        penalties += state.minimo.filter((value) => value > 75).length;
        let running = [0, 0];
        for (const hand of state.history) {
          if (running.some((score) => score >= 1000)) vulnerableHands++;
          running = running.map((score, team) => score + hand.teams[team].total);
        }
      }
    }
    expect(vulnerableHands).toBeGreaterThan(0);
    expect(penalties).toBe(0);
  });

  it('não travam trocando a mesma carta pelo lixo quando ninguém pode esvaziar a mão', () => {
    const { state } = playMatch(2, DEFAULT_RULES, 30);
    expect(state.phase).toBe('fimDePartida');
  });
});

describe('decisões do bot', () => {
  let nextId = 20_000;
  const card = (rank: number, suit: 'copas' | 'espadas' | 'paus' | 'ouros' = 'copas') => ({ id: nextId++, rank, suit });

  function tableFor(seats: number) {
    const state = createGame(seats, DEFAULT_RULES, 11);
    state.lixo = [];
    state.phase = 'jogar';
    state.turn = 0;
    return state;
  }

  it('lembra as cartas que cada um pegou do lixo e esquece quando saem da mão', () => {
    const state = createGame(2, DEFAULT_RULES, 3);
    const seen = card(9, 'paus');
    state.lixo = [seen, card(4, 'ouros')];
    applyAction(state, 0, { type: 'pegarLixo' });
    expect(viewFor(state, 1).known[0].map((item) => item.id)).toContain(seen.id);
    applyAction(state, 0, { type: 'descartar', card: seen.id });
    expect(viewFor(state, 1).known[0].map((item) => item.id)).not.toContain(seen.id);
  });

  it('nunca coloca coringa numa canastra limpa', () => {
    const state = tableFor(2);
    state.mortoTaken = [true, false];
    state.mortos.pop();
    state.melds = [{ id: 1, team: 0, cards: [card(3), card(4), card(5), card(6), card(7), card(8), card(9)], wild: null, limpavel: true }];
    const wild = card(2, 'espadas');
    state.hands[0] = [wild, card(13, 'paus')];
    const action = botAction(viewFor(state, 0), seeded(1));
    expect(action).not.toEqual({ type: 'adicionar', meld: 1, cards: [wild.id] });
  });

  it('suja uma canastra limpa quando isso deixa bater na mesma vez', () => {
    const state = tableFor(2);
    state.rules = { ...DEFAULT_RULES, mortos: 'um' };
    state.mortoTaken = [true, false];
    state.mortos.pop();
    state.melds = [
      { id: 1, team: 0, cards: [card(3), card(4), card(5), card(6), card(7), card(8), card(9)], wild: null, limpavel: true },
      { id: 2, team: 0, cards: [card(3, 'paus'), card(4, 'paus'), card(5, 'paus'), card(6, 'paus'), card(7, 'paus'), card(8, 'paus'), card(9, 'paus')], wild: null, limpavel: true },
    ];
    const wild = card(2, 'espadas');
    state.hands[0] = [wild, card(13, 'ouros')];
    const action = botAction(viewFor(state, 0), seeded(1));
    expect(action?.type).toBe('adicionar');
    applyAction(state, 0, action as NonNullable<typeof action>);
    applyAction(state, 0, botAction(viewFor(state, 0), seeded(1)) as NonNullable<typeof action>);
    expect(state.phase).toBe('fimDeMao');
    expect(state.history[0].batida).toBe(0);
  });

  it('vulnerável, não abre se não alcança o mínimo e abre quando alcança', () => {
    const state = tableFor(2);
    state.scores = [1200, 0];
    const short = [card(3, 'paus'), card(4, 'paus'), card(5, 'paus')];
    state.hands[0] = [...short, card(13, 'ouros'), card(9, 'espadas')];
    expect(botAction(viewFor(state, 0), seeded(1))?.type).toBe('descartar');
    const high = [card(11), card(12), card(13), card(1), card(9, 'paus'), card(10, 'paus'), card(11, 'paus'), card(12, 'paus')];
    state.hands[0] = [...high, card(4, 'ouros')];
    for (let step = 0; step < 6 && state.phase === 'jogar' && state.turn === 0; step++) {
      applyAction(state, 0, botAction(viewFor(state, 0), seeded(1)) as NonNullable<ReturnType<typeof botAction>>);
    }
    expect(state.aberto[0]).toBe(true);
    expect(state.minimo[0]).toBe(75);
  });

  it('deixa para o parceiro a carta que ele pegou do lixo', () => {
    const state = tableFor(4);
    state.melds = [{ id: 1, team: 0, cards: [card(1), card(2), card(3), card(4), card(5)], wild: null, limpavel: true }];
    const six = card(6);
    const seven = card(7);
    state.hands[0] = [six, seven, card(13, 'paus'), card(12, 'espadas'), card(9, 'ouros')];
    state.known[2] = [card(7)];
    const first = botAction(viewFor(state, 0), seeded(2));
    expect(first).toEqual({ type: 'adicionar', meld: 1, cards: [six.id] });
    applyAction(state, 0, first as NonNullable<typeof first>);
    const second = botAction(viewFor(state, 0), seeded(2));
    expect(second).not.toEqual({ type: 'adicionar', meld: 1, cards: [seven.id] });
  });
});
