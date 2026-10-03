import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, applyAction, createGame, nextHand, scoreTeam, viewFor, type Card, type GameState, type RuleSet, type Suit } from '../src';

let nextId = 5000;
function card(rank: number, suit: Suit = 'copas'): Card {
  return { id: nextId++, rank, suit };
}
function run(from: number, to: number, suit: Suit = 'copas'): Card[] {
  return Array.from({ length: to - from + 1 }, (_, i) => card(from + i, suit));
}
function table(rules: Partial<RuleSet> = {}, seats = 2): GameState {
  const state = createGame(seats, { ...DEFAULT_RULES, ...rules }, 7);
  state.monte = run(3, 13, 'ouros');
  state.lixo = [];
  return state;
}

describe('lixo de uma carta', () => {
  it('com uma carta só na mão, não troca pela única carta do lixo', () => {
    const state = table();
    state.hands[0] = [card(9, 'paus')];
    state.lixo = [card(13, 'espadas')];
    expect(applyAction(state, 0, { type: 'pegarLixo' }).ok).toBe(false);
    state.lixo = [card(4, 'ouros'), card(13, 'espadas')];
    expect(applyAction(state, 0, { type: 'pegarLixo' }).ok).toBe(true);
  });

  it('pegando um lixo de uma carta só, não descarta essa mesma carta', () => {
    const state = table();
    const only = card(13, 'espadas');
    state.lixo = [only];
    applyAction(state, 0, { type: 'pegarLixo' });
    expect(applyAction(state, 0, { type: 'descartar', card: only.id }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'descartar', card: state.hands[0][0].id }).ok).toBe(true);
    expect(state.lixoTop).toBeNull();
  });

  it('pegando duas ou mais cartas do lixo, pode descartar qualquer uma', () => {
    for (const count of [2, 3]) {
      const state = table();
      state.lixo = Array.from({ length: count }, (_, i) => card(9 + i, 'espadas'));
      const top = state.lixo[state.lixo.length - 1];
      applyAction(state, 0, { type: 'pegarLixo' });
      expect(applyAction(state, 0, { type: 'descartar', card: top.id }).ok).toBe(true);
    }
  });

  it('não baixa deixando só a carta que pegou do lixo na mão', () => {
    const state = table();
    const top = card(13, 'espadas');
    const meld = run(3, 5, 'paus');
    const six = card(6, 'paus');
    state.hands[0] = [...meld, six];
    state.lixo = [top];
    applyAction(state, 0, { type: 'pegarLixo' });
    expect(applyAction(state, 0, { type: 'baixar', cards: [...meld, six].map((item) => item.id) }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'baixar', cards: meld.map((item) => item.id) }).ok).toBe(true);
    expect(applyAction(state, 0, { type: 'descartar', card: six.id }).ok).toBe(true);
  });
});

describe('vulnerável', () => {
  function vulnerable(rules: Partial<RuleSet> = {}): GameState {
    const state = table(rules);
    state.scores = [1000, 400];
    state.phase = 'jogar';
    return state;
  }

  it('devolve os jogos para a mão e sobe o mínimo em 15 se a abertura não chega a 75', () => {
    const state = vulnerable();
    const meld = run(3, 6, 'paus');
    const discard = card(13, 'espadas');
    state.hands[0] = [...meld, discard, card(9, 'ouros')];
    expect(applyAction(state, 0, { type: 'baixar', cards: meld.map((item) => item.id) }).ok).toBe(true);
    expect(applyAction(state, 0, { type: 'descartar', card: discard.id }).ok).toBe(true);
    expect(state.melds).toHaveLength(0);
    expect(state.hands[0]).toHaveLength(5);
    expect(state.minimo).toEqual([90, 75]);
    expect(state.aberto[0]).toBe(false);
    expect(state.log.some((entry) => entry.type === 'vulneravel')).toBe(true);
    expect(viewFor(state, 1).known[0].map((item) => item.id).sort()).toEqual(meld.map((item) => item.id).sort());
  });

  it('abre com 75 pontos somando mais de um jogo na mesma vez e depois baixa livre', () => {
    const state = vulnerable();
    const first = run(9, 13, 'paus');
    const second = [card(11), card(12), card(13)];
    const discard = card(4, 'espadas');
    state.hands[0] = [...first, ...second, discard, card(5, 'ouros'), card(6, 'ouros')];
    applyAction(state, 0, { type: 'baixar', cards: first.map((item) => item.id) });
    expect(state.aberto[0]).toBe(false);
    applyAction(state, 0, { type: 'baixar', cards: second.map((item) => item.id) });
    expect(state.aberto[0]).toBe(true);
    expect(applyAction(state, 0, { type: 'descartar', card: discard.id }).ok).toBe(true);
    expect(state.melds).toHaveLength(2);
    expect(state.minimo[0]).toBe(75);
  });

  it('o mínimo maior continua nas mãos seguintes, e a abertura volta a ser exigida a cada mão', () => {
    const state = vulnerable();
    state.minimo = [90, 75];
    state.aberto = [true, false];
    state.phase = 'fimDeMao';
    expect(nextHand(state).ok).toBe(true);
    expect(state.minimo).toEqual([90, 75]);
    expect(state.aberto).toEqual([false, false]);
  });

  it('não deixa ficar sem cartas com a abertura abaixo do mínimo', () => {
    const state = vulnerable();
    const meld = run(3, 5, 'paus');
    state.hands[0] = [...meld, card(9, 'ouros')];
    const result = applyAction(state, 0, { type: 'baixar', cards: meld.map((item) => item.id) });
    expect(result.ok).toBe(false);
  });

  it('abaixo de 1000 pontos ou com a regra desligada, baixa livre', () => {
    for (const state of [Object.assign(vulnerable(), { scores: [999, 0] }), vulnerable({ vulneravel: false })]) {
      const meld = run(3, 5, 'paus');
      const discard = card(13, 'espadas');
      state.hands[0] = [...meld, discard, card(9, 'ouros')];
      applyAction(state, 0, { type: 'baixar', cards: meld.map((item) => item.id) });
      applyAction(state, 0, { type: 'descartar', card: discard.id });
      expect(state.melds).toHaveLength(1);
      expect(state.minimo).toEqual([75, 75]);
    }
  });
});

describe('distribuição', () => {
  it('dá 11 cartas a cada um, separa dois mortos e forma o monte', () => {
    for (const seats of [2, 4]) {
      for (const coringas of ['dois', 'doisEJokers'] as const) {
        const state = createGame(seats, { ...DEFAULT_RULES, coringas }, 3);
        const total = coringas === 'dois' ? 104 : 108;
        expect(state.hands.every((hand) => hand.length === 11)).toBe(true);
        expect(state.mortos.map((morto) => morto.length)).toEqual([11, 11]);
        const all = [...state.hands.flat(), ...state.mortos.flat(), ...state.monte];
        expect(all).toHaveLength(total);
        expect(new Set(all.map((item) => item.id)).size).toBe(total);
      }
    }
  });
});

describe('vez do jogador', () => {
  it('exige comprar antes de jogar e respeita a vez', () => {
    const state = table();
    expect(applyAction(state, 1, { type: 'comprar' }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'descartar', card: state.hands[0][0].id }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'comprar' }).ok).toBe(true);
    expect(applyAction(state, 0, { type: 'comprar' }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'descartar', card: state.hands[0][0].id }).ok).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('comprar');
  });

  it('no lixo aberto leva o lixo inteiro para a mão', () => {
    const state = table();
    state.lixo = [card(9), card(4, 'paus')];
    expect(applyAction(state, 0, { type: 'pegarLixo' }).ok).toBe(true);
    expect(state.hands[0]).toHaveLength(13);
    expect(state.lixo).toHaveLength(0);
  });

  it('no lixo fechado exige usar a carta de cima num jogo', () => {
    const state = table({ lixo: 'fechado' });
    const [five, six] = [card(5, 'paus'), card(6, 'paus')];
    state.hands[0] = [five, six, ...run(9, 13, 'espadas')];
    state.lixo = [card(10), card(7, 'paus')];
    expect(applyAction(state, 0, { type: 'pegarLixo' }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'pegarLixo', cards: [five.id, six.id] }).ok).toBe(true);
    expect(state.melds).toHaveLength(1);
    expect(state.hands[0]).toHaveLength(6);
  });
});

describe('morto e batida', () => {
  it('quem fica sem cartas baixando pega o morto e continua jogando', () => {
    const state = table();
    const cards = run(4, 6);
    state.hands[0] = cards.slice(0, 2);
    state.monte.push(cards[2]);
    applyAction(state, 0, { type: 'comprar' });
    expect(applyAction(state, 0, { type: 'baixar', cards: cards.map((item) => item.id) }).ok).toBe(true);
    expect(state.mortoTaken[0]).toBe(true);
    expect(state.hands[0]).toHaveLength(11);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe('jogar');
  });

  it('quem fica sem cartas descartando pega o morto e passa a vez', () => {
    const state = table();
    state.hands[0] = [card(9)];
    applyAction(state, 0, { type: 'comprar' });
    const [first, second] = state.hands[0];
    applyAction(state, 0, { type: 'descartar', card: first.id });
    state.turn = 0;
    state.phase = 'jogar';
    expect(applyAction(state, 0, { type: 'descartar', card: second.id }).ok).toBe(true);
    expect(state.mortoTaken[0]).toBe(true);
    expect(state.hands[0]).toHaveLength(11);
    expect(state.turn).toBe(1);
  });

  it('não deixa ficar sem cartas sem canastra limpa depois do morto', () => {
    const state = table();
    state.mortoTaken[0] = true;
    state.mortos.pop();
    const cards = run(4, 6);
    state.hands[0] = cards.slice(0, 2);
    state.monte.push(cards[2]);
    applyAction(state, 0, { type: 'comprar' });
    expect(applyAction(state, 0, { type: 'baixar', cards: cards.map((item) => item.id) }).ok).toBe(false);
    expect(applyAction(state, 0, { type: 'baixar', cards: cards.slice(0, 1).map((item) => item.id) }).ok).toBe(false);
  });

  it('com a opção dos dois mortos, a dupla com canastra limpa pega o segundo morto em vez de bater', () => {
    const state = table({ mortos: 'dois' });
    state.mortoTaken[0] = true;
    state.mortoCount[0] = 1;
    state.mortos.pop();
    state.melds = [{ id: 1, team: 0, cards: run(3, 9, 'espadas'), wild: null, limpavel: true }];
    const discard = card(11, 'paus');
    state.hands[0] = [discard];
    state.phase = 'jogar';
    expect(applyAction(state, 0, { type: 'descartar', card: discard.id }).ok).toBe(true);
    expect(state.phase).toBe('comprar');
    expect(state.mortoCount[0]).toBe(2);
    expect(state.mortos).toHaveLength(0);
    expect(state.hands[0]).toHaveLength(11);
    expect(state.turn).toBe(1);
  });

  it('com a opção dos dois mortos, a outra dupla fica sem morto e sem poder bater', () => {
    const state = table({ mortos: 'dois' });
    state.mortoTaken[0] = true;
    state.mortos = [];
    state.hands[1] = [card(9, 'paus')];
    state.turn = 1;
    state.phase = 'jogar';
    expect(applyAction(state, 1, { type: 'descartar', card: state.hands[1][0].id }).ok).toBe(false);
  });

  it('bate com canastra limpa e morto pego, encerrando a mão com +100', () => {
    const state = table({ mortos: 'um' });
    state.mortoTaken[0] = true;
    state.mortos.pop();
    state.melds = [{ id: 1, team: 0, cards: run(3, 9, 'espadas'), wild: null, limpavel: true }];
    const discard = card(11, 'paus');
    state.hands[0] = [discard];
    state.phase = 'jogar';
    expect(applyAction(state, 0, { type: 'descartar', card: discard.id }).ok).toBe(true);
    expect(state.phase).toBe('fimDeMao');
    const result = state.history[0];
    expect(result.batida).toBe(0);
    expect(result.teams[0].batida).toBe(100);
    expect(result.teams[0].bonusCanastras).toBe(200);
    expect(result.teams[1].morto).toBe(-100);
  });
});

describe('fim do monte e pontuação', () => {
  it('o morto que sobrou vira monte e, sem morto, a mão termina', () => {
    const state = table();
    state.monte = [card(9)];
    applyAction(state, 0, { type: 'comprar' });
    applyAction(state, 0, { type: 'descartar', card: state.hands[0][0].id });
    expect(state.monte).toHaveLength(11);
    expect(state.mortos).toHaveLength(1);
    state.mortos = [];
    state.monte = [card(10)];
    applyAction(state, 1, { type: 'comprar' });
    applyAction(state, 1, { type: 'descartar', card: state.hands[1][0].id });
    expect(state.phase).toBe('fimDeMao');
    expect(state.history[0].batida).toBeNull();
  });

  it('soma cartas, canastras e descontos conforme as regras', () => {
    const state = table();
    state.mortoTaken = [true, false];
    state.melds = [
      { id: 1, team: 0, cards: run(1, 7, 'paus'), wild: null, limpavel: true },
      { id: 2, team: 0, cards: [card(8), card(9), card(2, 'espadas'), card(11), card(12), card(13), card(1)], wild: 0, limpavel: false },
    ];
    state.hands[0] = [card(13), card(4)];
    const score = scoreTeam(state, 0, 0);
    expect(score.cartas).toBe(15 + 10 + 5 * 5 + 10 + 10 + 10 + 10 + 10 + 10 + 15);
    expect(score.canastrasLimpas).toBe(1);
    expect(score.canastrasSujas).toBe(1);
    expect(score.bonusCanastras).toBe(300);
    expect(score.mao).toBe(-15);
    expect(score.batida).toBe(100);
    expect(scoreTeam(state, 1, 0).morto).toBe(-100);
  });
});

describe('pontuação do canastrão', () => {
  it('Ás a Rei limpo vale 500, Ás a Ás limpo vale 1000 e sujo vale 100, no lugar dos 200', () => {
    const state = table();
    state.mortoTaken = [true, true];
    state.melds = [
      { id: 1, team: 0, cards: run(1, 13, 'paus'), wild: null, limpavel: true },
      { id: 2, team: 0, cards: [...run(1, 13, 'copas'), card(1, 'copas')], wild: null, limpavel: true },
      { id: 3, team: 1, cards: run(1, 13, 'ouros'), wild: 0, limpavel: false },
    ];
    state.hands[0] = [];
    state.hands[1] = [];
    const us = scoreTeam(state, 0, null);
    expect(us.canastroes).toBe(1);
    expect(us.canastroesReais).toBe(1);
    expect(us.bonusCanastras).toBe(1500);
    const them = scoreTeam(state, 1, null);
    expect(them.canastrasSujas).toBe(1);
    expect(them.bonusCanastras).toBe(100);
  });
});

describe('duque que limpa', () => {
  function playMeld(duque: 'ate8' | 'sempre', start: Card[], later: Card[]) {
    const state = table({ duque });
    state.hands[0] = [...start, ...later, card(13, 'paus'), card(12, 'paus')];
    state.phase = 'jogar';
    expect(applyAction(state, 0, { type: 'baixar', cards: start.map((item) => item.id) }).ok).toBe(true);
    const id = state.melds[0].id;
    for (const next of later) expect(applyAction(state, 0, { type: 'adicionar', meld: id, cards: [next.id] }).ok).toBe(true);
    return state.melds[0];
  }

  it('limpa o jogo que começou até o 8 quando o duque chega ao lugar dele', () => {
    const meld = playMeld('ate8', [card(6), card(2), card(8)], [card(7), card(5), card(4), card(3)]);
    expect(meld.cards).toHaveLength(7);
    expect(meld.wild).toBeNull();
  });

  it('mantém suja a canastra que começou acima do 8, mesmo completando até o duque', () => {
    const meld = playMeld('ate8', [card(7), card(2), card(9)], [card(8), card(6), card(5), card(4), card(3)]);
    expect(meld.cards).toHaveLength(8);
    expect(meld.wild).not.toBeNull();
  });

  it('na opção sempre, limpa mesmo tendo começado acima do 8', () => {
    const meld = playMeld('sempre', [card(7), card(2), card(9)], [card(8), card(6), card(5), card(4), card(3)]);
    expect(meld.wild).toBeNull();
  });

  it('suja de vez o jogo que ganhou uma carta acima do 8 antes de o duque chegar ao lugar dele', () => {
    const meld = playMeld('ate8', [card(6), card(2), card(8)], [card(9), card(7), card(5), card(4), card(3)]);
    expect(meld.cards).toHaveLength(8);
    expect(meld.wild).not.toBeNull();
    expect(meld.limpavel).toBe(false);
  });

  it('conta o Ás em cima como acima do 8', () => {
    const meld = playMeld('ate8', [card(12), card(2), card(1)], []);
    expect(meld.limpavel).toBe(false);
  });
});
