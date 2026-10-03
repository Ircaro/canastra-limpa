# Regras do Canastra Limpa

Canastra Limpa é um jogo de buraco online. Este documento é a referência das regras que o jogo implementa. As marcadas como **configurável** são escolhidas na tela de regras antes da partida; as demais são fixas.

## Jogadores e duplas

- 2 jogadores (um contra o outro) ou 4 jogadores em duas duplas.
- Com 4 jogadores, os parceiros sentam frente a frente e a vez passa no sentido horário.
- Os jogos baixados pertencem à dupla: qualquer um dos parceiros pode completar os jogos da dupla. Com 2 jogadores, cada jogador é a sua própria dupla.
- Qualquer lugar pode ser ocupado por uma pessoa ou por um bot.

## Baralho

- **Coringas (configurável):**
  - **Só os 2 (padrão):** dois baralhos sem jokers (104 cartas), e os 2 de qualquer naipe são coringas.
  - **2 e jokers:** dois baralhos com os 4 jokers (108 cartas), e tanto os jokers quanto os 2 são coringas.

## Distribuição

- Cada jogador recebe 11 cartas.
- Separam-se dois mortos de 11 cartas cada, um para cada dupla.
- O restante forma o monte, virado para baixo.
- O lixo começa vazio.
- Quem começa a mão muda a cada mão, no sentido horário.

## A vez do jogador

1. **Comprar:** pega 1 carta do monte ou pega o lixo.
2. **Jogar (opcional):** baixa jogos novos e/ou acrescenta cartas aos jogos da dupla, quantas vezes quiser.
3. **Descartar:** coloca 1 carta da mão no lixo, o que encerra a vez. A única exceção é bater baixando a última carta.

- **Uma carta só:** com uma carta só na mão, não dá para pegar o lixo quando ele tem uma carta só (seria só trocar uma pela outra).
- **Lixo de uma carta:** se você pegou o lixo quando ele tinha uma carta só, não pode descartar essa mesma carta, nem baixar deixando só ela na mão. Pegando duas ou mais, pode descartar qualquer uma.

### Lixo (configurável)

- **Aberto (padrão):** pode pegar o lixo inteiro a qualquer momento da compra, sem obrigação de usar as cartas.
- **Fechado:** só pode pegar o lixo usando a carta de cima no mesmo momento, num jogo novo (com cartas da mão) ou acrescentando-a a um jogo da dupla. As demais cartas do lixo vão para a mão.

## Jogos

- Só valem **sequências**: 3 ou mais cartas do mesmo naipe em ordem.
- O Ás pode ficar embaixo (A-2-3) ou em cima (Q-K-A), e a sequência não dá a volta (K-A-2 não vale). O Ás só fica nos dois lados na sequência completa de Ás a Ás (14 cartas).
- No máximo **um coringa** fazendo papel de outra carta em cada jogo.
- Um 2 do mesmo naipe do jogo, no seu lugar natural (como em A-2-3 ou 2-3-4 de copas), conta como carta normal e não como coringa.
- Ao acrescentar a carta que o coringa estava substituindo, o coringa vai para uma das pontas do jogo, automaticamente.

### Duque que limpa (configurável)

Vale para o jogo que usa o 2 do mesmo naipe como coringa e, depois, é completado até o 2 cair no lugar dele (por exemplo, 6♥ 2♥ 8♥ completado com 7♥, 5♥, 4♥ e 3♥).

- **Até o 8 (padrão):** o jogo fica limpo só se **começou** (na primeira vez que foi baixado) com cartas até o 8. Se começou com alguma carta acima do 8, como 7♥ 2♥ 9♥, fica sujo para sempre, mesmo completando. Se o jogo começou até o 8, mas ganhou uma carta acima do 8 (como o 9) antes de o 2 chegar ao lugar dele, também fica sujo para sempre. O Ás em cima (Q-K-A) conta como acima do 8.
- **Sempre:** o jogo fica limpo sempre que o 2 cai no lugar dele.

### Canastras

- **Canastra:** jogo com 7 cartas ou mais.
- **Limpa:** sem coringa fazendo papel de outra carta. Vale +200.
- **Suja:** com coringa. Vale +100.
- **Canastrão:** canastra limpa de Ás a Rei (A-2-3-...-K, 13 cartas). Vale +500 no lugar dos 200.
- **Canastrão Real:** canastra limpa de Ás a Ás (A-2-...-K-A, 14 cartas). Vale +1000 no lugar dos 200.
- Com coringa, essas sequências contam como canastra suja comum (+100).

## Vulnerável (configurável, ligado por padrão)

- A dupla que chega a **1000 pontos** fica vulnerável até o fim da partida. Não vale na partida de uma mão.
- Vulnerável, a **primeira baixada da dupla em cada mão** precisa somar pelo menos **75 pontos em cartas** antes do descarte. Vale somar todos os jogos baixados naquela vez; bônus de canastra não conta.
- Se descartar sem chegar ao mínimo, os jogos **voltam para a mão** e a abertura da dupla **sobe 15 pontos** (75, 90, 105...) pelo resto da partida.
- Não dá para ficar sem cartas com a abertura abaixo do mínimo.
- Depois que a dupla abriu na mão, os dois parceiros baixam livre até a mão acabar.

## Morto

- Quando um jogador fica sem cartas pela primeira vez na dupla, ele pega um morto.
- **Mortos por dupla (configurável):**
  - **Os dois (padrão):** se, depois de pegar o primeiro morto, a dupla tiver canastra limpa e ficar sem cartas de novo, pega o segundo morto, se ele ainda estiver na mesa. Na vez seguinte em que ficar sem cartas, bate. A outra dupla pode acabar sem morto nenhum: ela perde os 100 pontos e não consegue bater.
  - **Só um:** cada dupla pega só um morto; depois dele, a próxima vez sem cartas é a batida.
- **Sem cartas ao baixar ou acrescentar:** pega o morto e **continua jogando** na mesma vez (depois precisa descartar).
- **Sem cartas ao descartar:** pega o morto e a vez passa normalmente.

## Bater

- Para bater, a dupla precisa ter pego o morto e ter pelo menos uma **canastra limpa**. Na opção "Os dois", também não pode haver morto na mesa para ela pegar.
- Bate quem fica sem cartas nessas condições, seja descartando a última carta, seja baixando todas.
- **A mão termina na batida**, e a dupla que bateu ganha +100.
- Não é permitido ficar sem cartas quando não se pode pegar o morto nem bater. Também não é permitido baixar deixando uma carta só na mão se, depois, não for possível descartá-la.

## Fim do monte

- Sempre que a vez passa e o monte está vazio, um morto que ainda está na mesa vira o novo monte. Se esse monte acabar de novo e ainda houver outro morto, ele também vira monte.
- Morto que virou monte não pode mais ser pego.
- **Só pode bater quem pegou o morto.** Se a dupla não pegou e não sobrou morto na mesa, ela não bate mais nesta mão: guarda pelo menos 1 carta até o monte acabar.
- Se não sobrar morto nenhum, a mão termina sem batida.

## Pontuação da mão (por dupla)

- **Cartas nos jogos da dupla:**

  | Carta | Pontos |
  |---|---|
  | 3 a 7 | 5 |
  | 8 a K | 10 |
  | Ás | 15 |
  | 2 | 10 |
  | Joker | 20 |

- **Bônus:**
  - canastra limpa: +200
  - canastra suja: +100
  - batida: +100
- **Descontos:**
  - cartas que sobraram na mão de cada jogador da dupla, com os mesmos valores
  - −100 se a dupla não pegou o morto

## Fim da partida

- **Até quando (configurável):** 1 partida (uma mão só), 2000 ou 3000 pontos (padrão 3000).
- **1 partida:** vence quem fizer mais pontos nessa mão; se empatar, joga-se mais uma mão.
- **Vitória:** ao fim de uma mão, se alguma dupla atingiu a meta, vence a de maior pontuação.
- **Empate:** se as duas duplas atingirem a meta com a mesma pontuação, joga-se mais uma mão.
