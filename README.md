# Canastra Limpa

Buraco (canastra) no navegador. Dá para jogar contra bots, sozinho ou em dupla com um bot parceiro, ou online com até 4 pessoas, cada uma no seu computador. As regras da mesa são configuráveis.

**Jogar agora:** https://ircaro.github.io/canastra-limpa/

As regras completas estão em [REGRAS.md](REGRAS.md) e também no botão **Regras** dentro do jogo.

## Destaques

- **Regras configuráveis:** lixo aberto ou fechado, só os 2 ou 2 e jokers como coringa, duque que limpa até o 8 ou sempre, um ou dois mortos por dupla, partida de 1 mão, 2000 ou 3000 pontos e vulnerável ligado ou desligado.
- **Canastras:** limpa (+200), suja (+100), Canastrão de Ás a Rei (+500) e Canastrão Real de Ás a Ás (+1000), cada uma com cor e comemoração próprias.
- **Bots:** pegam o lixo com equilíbrio, guardam cartas que o parceiro pegou do lixo, não sujam canastra limpa a não ser para bater e respeitam a abertura do vulnerável.
- **Mesa animada:** cartas voando entre mão, monte, lixo e jogos, pontos subindo em cada carta baixada, revelação das mãos no fim com os descontos, voo do morto até quem pegou e aviso de quem bateu.
- **Modo teste:** coloca qualquer carta na mão, simula descarte do oponente, monta jogos para as duas duplas, tira jogos da mesa, volta jogadas e mostra a revelação do fim da mão.
- **Online:** servidor autoritativo em Node com WebSocket. Salas por código de 6 caracteres, lugares vazios viram bots, reconexão automática, tempo por fase com jogada automática, voto para a próxima mão e ping na tela.
- **Som sintetizado:** efeitos gerados na hora pela Web Audio API, sem arquivos de áudio.

## Estrutura

Monorepo com npm workspaces, todo em TypeScript.

| Pacote | O que faz |
|---|---|
| `packages/shared` | Motor do jogo (baralho, sequências, jogos, morto, batida, pontuação, vulnerável), bot e protocolo online. Roda igual no navegador e no servidor. |
| `packages/client` | Vite + DOM: mesa, animações, som, telas, modo teste e cliente online. |
| `packages/server` | Servidor Node que entrega a página e roda as salas online. |

## Comandos

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm test           # testes automatizados (Vitest)
npm run typecheck  # checagem de tipos dos três pacotes
npm run build      # gera packages/client/dist
npm run host       # build + servidor em http://localhost:8090
```

Para testar o modo online durante o desenvolvimento, deixe `npm run host` rodando: o `npm run dev` repassa as conexões para ele.

No desenvolvimento, `?rapido` no endereço acelera os bots.

## Jogar online

1. Clique em **Jogar online**, escolha as regras e crie a sala.
2. Copie o link de convite e mande para quem vai jogar. Cada pessoa escolhe o lugar e o nome.
3. Quem criou a sala começa a partida. Os lugares livres viram bots.

Durante a partida:

- **Tempo:** cada fase tem 30 segundos (1 minuto depois de pegar o morto). Quando o tempo acaba, o jogo faz a melhor jogada pelo jogador.
- **Queda de conexão:** quem cair volta para o mesmo lugar ao reabrir o link. Se ficar fora por mais de 15 segundos, um bot joga no lugar até a pessoa voltar.
- **Próxima mão:** começa quando todos que estão na sala votam.

## Hospedagem

O jogo fica em dois lugares:

| Onde | O que roda | Endereço |
|---|---|---|
| GitHub Pages | A página do jogo. Contra bots e modo teste funcionam só com ela. | https://ircaro.github.io/canastra-limpa/ |
| Render | O servidor das salas online, e também uma cópia da página. | https://canastra-limpa.onrender.com |

A cada push na `main`, os dois publicam sozinhos.

### Render

O `render.yaml` já está pronto. No [Render](https://render.com), crie um **Blueprint** apontando para este repositório e confirme.

No plano gratuito, o serviço dorme depois de 15 minutos sem acesso. A primeira conexão online depois disso leva cerca de um minuto. O servidor roda nos EUA, então o ping a partir do Brasil fica em torno de 120 a 150 ms.

### GitHub Pages

O workflow `.github/workflows/pages.yml` gera a página e publica. Para ligar, em **Settings → Pages → Source**, escolha **GitHub Actions**.

O build usa duas variáveis:

- `BASE_PATH=/canastra-limpa/`: caminho da página no GitHub Pages.
- `VITE_SERVER_URL=wss://canastra-limpa.onrender.com/ws`: servidor das salas online.

Se uma publicação falhar, rode uma execução nova em **Actions → GitHub Pages → Run workflow**. O **Re-run** de uma execução que falhou dá erro de pacote duplicado.

## Variáveis do servidor

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `8090` | Porta do servidor. |
| `HOST` | `127.0.0.1` | Endereço de escuta. No Render, `0.0.0.0`. |
| `TRUST_PROXY` | desligado | Com `1`, usa o IP informado pelo proxy (`X-Forwarded-For`) para limitar tentativas por jogador. Use só atrás de um proxy. |
| `TURN_MS` | `30000` | Tempo de cada fase, em milissegundos. |
| `MORTO_TURN_MS` | `60000` | Tempo da vez depois de pegar o morto. |
| `BOT_PACE` | `1` | Multiplicador do ritmo dos bots (menor é mais rápido). |
| `DIST_DIR` | `packages/client/dist` | Pasta da página que o servidor entrega. |
