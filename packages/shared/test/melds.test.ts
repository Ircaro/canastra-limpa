import { describe, expect, it } from 'vitest';
import { arrangeSequence, canastraKind, explainSequence, type Card, type Suit } from '../src';

let nextId = 1000;
function card(rank: number, suit: Suit | null = 'copas'): Card {
  return { id: nextId++, rank, suit };
}
const joker = () => card(0, null);
const ranks = (cards: Card[] | undefined) => cards?.map((item) => (item.rank === 0 ? 'J*' : `${item.rank}${item.suit?.[0]}`));

describe('sequências', () => {
  it('aceita sequência limpa do mesmo naipe', () => {
    const result = arrangeSequence([card(6), card(4), card(5)]);
    expect(ranks(result?.order)).toEqual(['4c', '5c', '6c']);
    expect(result?.wild).toBeNull();
  });

  it('recusa naipes misturados, menos de 3 cartas e cartas repetidas', () => {
    expect(arrangeSequence([card(4), card(5, 'paus'), card(6)])).toBeNull();
    expect(arrangeSequence([card(4), card(5)])).toBeNull();
    expect(arrangeSequence([card(4), card(4), card(5)])).toBeNull();
  });

  it('usa o Ás embaixo ou em cima, sem dar a volta', () => {
    expect(ranks(arrangeSequence([card(1), card(2), card(3)])?.order)).toEqual(['1c', '2c', '3c']);
    expect(ranks(arrangeSequence([card(12), card(13), card(1)])?.order)).toEqual(['12c', '13c', '1c']);
    expect(arrangeSequence([card(13), card(1), card(2, 'copas')])?.wild).not.toBeNull();
    expect(arrangeSequence([card(13), card(1), card(3)])).toBeNull();
  });

  it('coloca o coringa no buraco da sequência ou na ponta', () => {
    const gap = card(2, 'espadas');
    const filled = arrangeSequence([card(5), gap, card(7)]);
    expect(filled?.order.map((item) => item.id)[1]).toBe(gap.id);
    expect(filled?.wild).toBe(gap.id);
    const top = joker();
    const end = arrangeSequence([card(5), card(6), top]);
    expect(end?.order[2].id).toBe(top.id);
  });

  it('aceita no máximo um coringa', () => {
    expect(arrangeSequence([card(5), card(2, 'paus'), card(2, 'espadas')])).toBeNull();
    expect(arrangeSequence([card(5), card(6), joker(), joker()])).toBeNull();
    expect(arrangeSequence([card(5), card(2, 'paus'), joker(), card(6)])).toBeNull();
  });

  it('conta o 2 do mesmo naipe no lugar natural como carta normal', () => {
    const result = arrangeSequence([card(1), card(2), card(3), card(4)]);
    expect(result?.wild).toBeNull();
    const withWild = arrangeSequence([card(2), card(3), card(5), card(2, 'paus')]);
    expect(ranks(withWild?.order)).toEqual(['2c', '3c', '2p', '5c']);
  });

  it('manda o coringa para a ponta quando chega a carta que ele substituía', () => {
    const wild = card(2, 'paus');
    const before = arrangeSequence([card(5), wild, card(7)]);
    expect(before?.order[1].id).toBe(wild.id);
    const after = arrangeSequence([...(before?.order ?? []), card(6)]);
    expect(after?.order.map((item) => item.id).indexOf(wild.id)).toBe(3);
  });
});

describe('motivo quando o jogo não fecha', () => {
  it('explica naipe diferente, coringa demais, carta repetida, volta e cartas faltando', () => {
    const wild = card(2, 'copas');
    const meld = [wild, card(12, 'espadas'), card(13, 'espadas'), card(1, 'espadas')];
    expect(explainSequence([...meld, card(9, 'paus')], 'espadas')).toBe('Naipe diferente: esse jogo é de espadas.');
    expect(explainSequence([...meld, card(9, 'espadas')], 'espadas')).toBe('Mesmo com o coringa, faltam o 10 e o J de espadas para fechar a sequência.');
    expect(explainSequence([card(7), card(8), card(10), card(11), card(12)])).toBe('Falta o 9 de copas para fechar a sequência.');
    expect(explainSequence([card(12), card(13), card(10)])).toBe('Falta o J de copas para fechar a sequência.');
    expect(explainSequence([card(5), card(2, 'paus'), card(2, 'espadas')])).toBe('Cada jogo aceita só um coringa.');
    expect(explainSequence([card(5), card(5), card(6)])).toBe('Carta repetida: a sequência não pode ter duas cartas iguais.');
    expect(explainSequence([card(13), card(1), card(2)])).toBe('A sequência não dá a volta: K-A-2 não vale.');
    expect(explainSequence([card(1), card(3), card(4), card(12)])).toBe('Faltam cartas demais para fechar a sequência.');
    expect(explainSequence([card(4), card(5)])).toBe('Um jogo precisa de pelo menos 3 cartas.');
  });

  it('aceita o valete verdadeiro no lugar do coringa, que vai para a ponta de baixo', () => {
    const wild = card(2, 'copas');
    const jack = card(11, 'espadas');
    const result = arrangeSequence([wild, card(12, 'espadas'), card(13, 'espadas'), card(1, 'espadas'), jack]);
    expect(result?.order[0].id).toBe(wild.id);
    expect(result?.order[1].id).toBe(jack.id);
  });
});

describe('canastrão', () => {
  const seq = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => card(from + i));

  it('aceita a sequência de Ás a Ás com um Ás em cada ponta', () => {
    const result = arrangeSequence([...seq(1, 13), card(1)]);
    expect(result?.order).toHaveLength(14);
    expect(result?.wild).toBeNull();
    expect(result?.low).toBe(1);
    expect(result?.high).toBe(14);
  });

  it('explica que dois Ases só valem no Canastrão Real completo', () => {
    expect(arrangeSequence([card(1), card(2), card(3), card(1)])).toBeNull();
    expect(explainSequence([card(1), card(2), card(3), card(1)])).toBe('Dois Ases no mesmo jogo só valem no Canastrão Real, de Ás a Ás completo.');
  });

  it('continua recusando dar a volta e três Ases', () => {
    expect(arrangeSequence([card(13), card(1), card(3)])).toBeNull();
    expect(arrangeSequence([card(1), card(1), card(1), card(2)])).toBeNull();
  });

  it('classifica canastrão, canastrão real, limpa e suja', () => {
    const asRei = arrangeSequence(seq(1, 13));
    expect(asRei && canastraKind(asRei.order, asRei.wild)).toBe('canastrao');
    const doisAoAs = arrangeSequence([...seq(2, 13), card(1)]);
    expect(doisAoAs && canastraKind(doisAoAs.order, doisAoAs.wild)).toBe('canastrao');
    const sete = arrangeSequence(seq(5, 11));
    expect(sete && canastraKind(sete.order, sete.wild)).toBe('limpa');
    const asAs = arrangeSequence([...seq(1, 13), card(1)]);
    expect(asAs && canastraKind(asAs.order, asAs.wild)).toBe('canastraoReal');
    const sujo = arrangeSequence([...seq(1, 6), card(2, 'paus'), ...seq(8, 13)]);
    expect(sujo?.order).toHaveLength(13);
    expect(sujo && canastraKind(sujo.order, sujo.wild)).toBe('suja');
  });
});
