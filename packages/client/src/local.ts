import {
  eventPause,
  applyAction,
  arrangeSequence,
  botAction,
  explainSequence,
  extendMeld,
  fallbackAction,
  naturalHigh,
  startsLimpavel,
  LIMPA_ATE,
  finishHand,
  createGame,
  nextHand,
  nextRandom,
  randomSeed,
  viewFor,
  VULNERAVEL_PONTOS,
  type Action,
  type ActionResult,
  type Card,
  type GameState,
  type LastAction,
  type PlayerView,
  type RuleSet,
  type Suit,
} from '@canastra/shared';

export interface SandboxCard {
  rank: number;
  suit: Suit | null;
}

export interface Sandbox {
  addCard(rank: number, suit: Suit | null): void;
  discardAs(rank: number, suit: Suit | null): void;
  meldAs(team: number, cards: readonly SandboxCard[], meldId?: number): string | null;
  removeMeld(id: number): void;
  removeFromHand(ids: readonly number[]): void;
  clearLixo(): void;
  undo(): void;
  canUndo(): boolean;
  revealDemo(): void;
  toggleVulnerable(): void;
  mortoDemo(kind: 'eu' | 'oponente' | 'monte'): void;
}

const UNDO_LIMIT = 80;
const MORTO_CARDS = 11;

export interface TableController {
  readonly seat: number;
  readonly names: string[];
  readonly bots: boolean[];
  readonly sandbox?: Sandbox;
  readonly waitingNext?: { votes: number; needed: number; voted: boolean };
  readonly turnTimer?: { endsAt: number; total: number } | null;
  readonly isHost?: boolean;
  readonly latency?: number | null;
  onError?(listener: (message: string) => void): void;
  view(): PlayerView;
  act(action: Action): ActionResult;
  nextHand(): void;
  subscribe(listener: () => void): void;
  dispose(): void;
}

const DELAYS = { comprar: 750, jogar: 600, descartar: 700 };

export class LocalMatch implements TableController {
  readonly seat = 0;
  readonly names: string[];
  readonly bots: boolean[];
  private readonly state: GameState;
  private readonly rng = { rngState: randomSeed() };
  private readonly listeners: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  readonly sandbox?: Sandbox;
  private nextCardId = 10_000;
  private readonly history: GameState[] = [];
  private seenActions = 0;
  private pauseUntil = 0;

  constructor(seats: number, rules: RuleSet, private readonly pace = 1, practice = false) {
    this.state = createGame(practice ? 2 : seats, rules, randomSeed(), practice ? 0 : Math.floor(Math.random() * seats));
    this.names = practice ? ['Você', 'Mesa'] : seats === 2 ? ['Você', 'Beto'] : ['Você', 'Beto', 'Duda', 'Caio'];
    this.bots = this.names.map((_, seat) => seat !== this.seat && !practice);
    if (practice) {
      this.state.hands[1] = [];
      this.sandbox = {
        addCard: (rank, suit) => {
          this.save();
          this.state.hands[this.seat].push(this.makeCard(rank, suit));
          this.changed();
        },
        discardAs: (rank, suit) => {
          this.save();
          const card = this.makeCard(rank, suit);
          this.state.lixo.push(card);
          this.note({ seat: 1, type: 'descartar', card });
          this.changed();
        },
        meldAs: (team, picked, meldId) => this.meldAs(team, picked, meldId),
        removeMeld: (id) => {
          this.save();
          this.state.melds = this.state.melds.filter((meld) => meld.id !== id);
          this.changed();
        },
        removeFromHand: (ids) => {
          const wanted = new Set(ids);
          this.save();
          this.state.hands[this.seat] = this.state.hands[this.seat].filter((card) => !wanted.has(card.id));
          this.changed();
        },
        clearLixo: () => {
          this.save();
          this.state.lixo = [];
          this.changed();
        },
        undo: () => {
          const previous = this.history.pop();
          if (!previous) return;
          Object.assign(this.state, previous);
          this.changed();
        },
        canUndo: () => this.history.length > 0,
        revealDemo: () => {
          const suits = ['espadas', 'copas', 'paus', 'ouros'] as const;
          const count = 5 + Math.floor(nextRandom(this.rng) * 4);
          this.state.hands[1] = Array.from({ length: count }, () => ({
            id: this.nextCardId++,
            rank: 1 + Math.floor(nextRandom(this.rng) * 13),
            suit: suits[Math.floor(nextRandom(this.rng) * 4)],
          }));
          finishHand(this.state, null);
          this.changed();
        },
        mortoDemo: (kind) => {
          this.save();
          const state = this.state;
          const morto = state.mortos.pop() ?? this.randomCards(MORTO_CARDS);
          if (kind === 'monte') {
            state.monte = [...morto, ...state.monte];
            this.note({ seat: null, type: 'monteVazio' });
          } else {
            const seat = kind === 'eu' ? this.seat : 1;
            state.hands[seat] = morto;
            state.mortoTaken[seat] = true;
            state.mortoCount[seat]++;
            this.note({ seat, type: 'morto' });
          }
          this.changed();
        },
        toggleVulnerable: () => {
          this.save();
          const state = this.state;
          if (state.scores[0] >= VULNERAVEL_PONTOS) state.scores[0] = 0;
          else {
            state.scores[0] = VULNERAVEL_PONTOS;
            state.rules = { ...state.rules, vulneravel: true, meta: state.rules.meta || 3000 };
          }
          this.changed();
        },
      };
    }
    this.schedule();
  }

  private randomCards(count: number): Card[] {
    const suits = ['espadas', 'copas', 'paus', 'ouros'] as const;
    return Array.from({ length: count }, () => this.makeCard(1 + Math.floor(nextRandom(this.rng) * 13), suits[Math.floor(nextRandom(this.rng) * 4)]));
  }

  private makeCard(rank: number, suit: Suit | null): Card {
    return { id: this.nextCardId++, rank, suit };
  }

  private save(): void {
    this.history.push(structuredClone(this.state));
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  private note(entry: LastAction): void {
    this.state.actions++;
    this.state.log.push(entry);
    if (this.state.log.length > 12) this.state.log.shift();
  }

  private meldAs(team: number, picked: readonly SandboxCard[], meldId?: number): string | null {
    const state = this.state;
    const cards = picked.map((item) => this.makeCard(item.rank, item.suit));
    const seat = team === 0 ? 0 : 1;
    if (meldId !== undefined) {
      const existing = state.melds.find((meld) => meld.id === meldId && meld.team === team);
      if (!existing) return 'Esse jogo não existe mais.';
      const arranged = extendMeld(existing, cards, state.rules);
      if (!arranged) return explainSequence([...existing.cards, ...cards], existing.cards.find((card) => card.id !== existing.wild)?.suit ?? null);
      this.save();
      state.melds = state.melds.map((meld) =>
        meld.id === meldId ? { ...existing, cards: arranged.order, wild: arranged.wild, limpavel: existing.limpavel && naturalHigh(arranged) <= LIMPA_ATE } : meld,
      );
      this.note({ seat, type: 'adicionar', meld: meldId });
      this.changed();
      return null;
    }
    if (cards.length < 3) return 'Um jogo precisa de pelo menos 3 cartas.';
    const arranged = arrangeSequence(cards);
    if (!arranged) return explainSequence(cards);
    this.save();
    const id = state.nextMeldId++;
    state.melds = [...state.melds, { id, team, cards: arranged.order, wild: arranged.wild, limpavel: startsLimpavel(arranged) }];
    this.note({ seat, type: 'baixar', meld: id });
    this.changed();
    return null;
  }

  private practiceTick(): void {
    if (!this.sandbox) return;
    const state = this.state;
    if (state.phase === 'comprar' || state.phase === 'jogar') state.hands[1] = [];
    if ((state.phase === 'comprar' || state.phase === 'jogar') && state.turn !== this.seat) {
      state.turn = this.seat;
      state.phase = 'comprar';
    }
    while (state.monte.length < 12) {
      const rank = 1 + Math.floor(nextRandom(this.rng) * 13);
      const suit = (['espadas', 'copas', 'paus', 'ouros'] as const)[Math.floor(nextRandom(this.rng) * 4)];
      state.monte.unshift({ id: this.nextCardId++, rank, suit });
    }
  }

  view(): PlayerView {
    return viewFor(this.state, this.seat);
  }

  act(action: Action): ActionResult {
    const before = this.sandbox ? structuredClone(this.state) : null;
    const result = applyAction(this.state, this.seat, action);
    if (result.ok && before) {
      this.history.push(before);
      if (this.history.length > UNDO_LIMIT) this.history.shift();
    }
    if (result.ok) {
      this.practiceTick();
      this.changed();
    }
    return result;
  }

  nextHand(): void {
    if (nextHand(this.state).ok) {
      if (this.sandbox) {
        this.state.turn = this.seat;
        this.practiceTick();
      }
      this.changed();
    }
  }

  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private changed(): void {
    const pause = eventPause(this.state, this.state.actions - this.seenActions);
    if (pause > 0 && !this.sandbox) this.pauseUntil = Math.max(performance.now(), this.pauseUntil) + pause;
    this.seenActions = this.state.actions;
    for (const listener of this.listeners) listener();
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed || this.timer) return;
    const { phase, turn } = this.state;
    if ((phase !== 'comprar' && phase !== 'jogar') || !this.bots[turn]) return;
    const next = botAction(viewFor(this.state, turn), () => nextRandom(this.rng));
    if (!next) return;
    const delay = Math.max(0, this.pauseUntil - performance.now()) + this.pace * (next.type === 'descartar' ? DELAYS.descartar : phase === 'comprar' ? DELAYS.comprar : DELAYS.jogar);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.state.turn !== turn) return;
      const result = applyAction(this.state, turn, next);
      if (!result.ok) applyAction(this.state, turn, fallbackAction(this.state, turn));
      this.changed();
    }, delay);
  }
}
