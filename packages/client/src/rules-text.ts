import type { RuleSet } from '@canastra/shared';
import { el } from './dom';

interface Section {
  title: string;
  items: string[];
}

function sections(rules: RuleSet): Section[] {
  const lixo =
    rules.lixo === 'aberto'
      ? 'Lixo aberto: você pode pegar o lixo inteiro em vez de comprar do monte, sem obrigação de usar as cartas.'
      : 'Lixo fechado: só pode pegar o lixo se usar a carta de cima na hora, num jogo novo com cartas da mão ou num jogo da sua dupla. O resto do lixo vai para a mão.';
  const duque =
    rules.duque === 'ate8'
      ? 'Duque que limpa (até o 8): se o jogo usa o 2 do mesmo naipe como coringa e depois é completado até o 2 cair no lugar dele, ele fica limpo, mas só se o jogo nunca teve carta acima do 8 enquanto estava sujo. Se começou ou ganhou alguma carta acima do 8 (o Ás em cima conta), fica sujo para sempre.'
      : 'Duque que limpa (sempre): se o jogo usa o 2 do mesmo naipe como coringa e depois é completado até o 2 cair no lugar dele, o jogo fica limpo.';
  const coringas =
    rules.coringas === 'dois'
      ? 'Os 2 de qualquer naipe são coringas (dois baralhos, 104 cartas).'
      : 'Os 2 e os jokers são coringas (dois baralhos com 4 jokers, 108 cartas).';
  return [
    {
      title: 'Objetivo',
      items: [
        rules.meta === 0 ? 'Partida de uma mão só: vence quem fizer mais pontos nela. Se empatar, joga-se mais uma mão.' : `Somar ${rules.meta} pontos antes da outra dupla, mão a mão.`,
        'Com 4 jogadores, os parceiros ficam frente a frente e os jogos baixados são da dupla.',
      ],
    },
    {
      title: 'Começo da mão',
      items: ['Cada jogador recebe 11 cartas.', 'Ficam separados dois mortos de 11 cartas, um para cada dupla.', 'O resto é o monte; o lixo começa vazio.'],
    },
    {
      title: 'Sua vez',
      items: ['Compre 1 carta do monte ou pegue o lixo.', lixo, 'Com uma carta só na mão, não dá para pegar o lixo quando ele tem uma carta só (seria só trocar uma pela outra).', 'Baixe jogos novos ou acrescente cartas aos jogos da dupla, quantas vezes quiser.', 'Termine descartando 1 carta no lixo. Se você pegou um lixo de uma carta só, não pode descartar essa mesma carta; com duas ou mais, pode descartar qualquer uma.'],
    },
    {
      title: 'Jogos',
      items: [
        'Só valem sequências de 3 ou mais cartas do mesmo naipe, como 4-5-6 de copas.',
        'O Ás pode ficar embaixo (A-2-3) ou em cima (Q-K-A), mas a sequência não dá a volta. Só na sequência completa de Ás a Ás (14 cartas) o Ás fica nas duas pontas.',
        coringas,
        'Cada jogo aceita no máximo um coringa. Um 2 do mesmo naipe no lugar dele (como em A-2-3) conta como carta normal.',
        duque,
        'Canastra é um jogo com 7 cartas ou mais: limpa (sem coringa) vale +200 e suja (com coringa) vale +100.',
        'Canastrão: canastra limpa de Ás a Rei (13 cartas) vale +500. Canastrão Real: canastra limpa de Ás a Ás (14 cartas) vale +1000. Os valores entram no lugar dos 200; com coringa, contam como canastra suja comum.',
      ],
    },
    ...(rules.vulneravel && rules.meta !== 0
      ? [
          {
            title: 'Vulnerável',
            items: [
              'A dupla que chega a 1000 pontos fica vulnerável até o fim da partida.',
              'Vulnerável, a primeira baixada da dupla em cada mão precisa somar pelo menos 75 pontos em cartas antes do descarte. Vale somar todos os jogos baixados naquela vez; bônus de canastra não conta.',
              'Se descartar sem chegar ao mínimo, os jogos voltam para a mão e a abertura da dupla sobe 15 pontos (75, 90, 105...) até o fim da mão. Na mão seguinte volta para 75.',
              'Depois que a dupla abriu na mão, os dois baixam livre até a mão acabar.',
            ],
          },
        ]
      : []),
    {
      title: 'Morto',
      items: [
        'Quem fica sem cartas pela primeira vez na dupla pega o morto.',
        'Se ficou sem cartas baixando jogos, pega o morto e continua jogando. Se foi descartando, pega o morto e a vez passa.',
        rules.mortos === 'dois'
          ? 'Os dois mortos: depois de pegar o primeiro, se a dupla tiver canastra limpa e ficar sem cartas de novo, pega o segundo morto (se ainda estiver na mesa). Na vez seguinte em que ficar sem cartas, bate.'
          : 'Só um morto por dupla: depois de pegar o morto, a próxima vez que a dupla ficar sem cartas é a batida.',
        'Sempre que o monte acabar e ainda houver morto na mesa, esse morto vira o novo monte.',
      ],
    },
    {
      title: 'Bater',
      items: [
        rules.mortos === 'dois'
          ? 'Para bater, a dupla precisa ter pego o morto, ter pelo menos uma canastra limpa e não haver mais morto na mesa para pegar.'
          : 'Para bater, a dupla precisa ter pego o morto e ter pelo menos uma canastra limpa.',
        'Bate quem fica sem cartas nessas condições, descartando a última carta ou baixando todas. A batida vale +100 e encerra a mão.',
        'Não dá para ficar sem cartas antes disso, nem baixar deixando uma carta só se não puder descartá-la depois.',
        'Só pode bater quem pegou o morto. Se a dupla não pegou e os mortos viraram monte, ela não bate mais nesta mão: guarda pelo menos 1 carta até o monte acabar.',
      ],
    },
    {
      title: 'Pontos',
      items: [
        'Cartas nos jogos: 3 a 7 valem 5, 8 a K valem 10, Ás vale 15, 2 vale 10 e joker vale 20.',
        'Somam-se os bônus de canastras e batida.',
        'Descontam-se as cartas que sobraram na mão e 100 pontos de quem não pegou o morto.',
      ],
    },
  ];
}

export function rulesContent(rules: RuleSet): HTMLElement {
  return el(
    'div',
    'rules',
    ...sections(rules).map((section) => el('section', '', el('h3', '', section.title), el('ul', '', ...section.items.map((item) => el('li', '', item))))),
  );
}
