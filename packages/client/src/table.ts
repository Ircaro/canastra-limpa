import { isVulnerable, needsOpening, openingPoints, metaLabel, CANASTRA_BONUS, CANASTRA_SIZE, arrangeSequence, canastraKind, cardPoints, extendMeld, isWild, type CanastraKind, tablePoints, teamOf, type Action, type Card, type HandResult, type LastAction, type Meld, type PlayerView, type Suit } from '@canastra/shared';
import { play, snapshot, stopAnimations } from './animate';
import { SUIT_ORDER, cardBack, cardElement, sortHand, type SortMode } from './cards';
import { button, el } from './dom';
import type { SandboxCard, TableController } from './local';
import { pingBadge } from './ping';
import { sound, type SoundName } from './sfx';

export interface TableOptions {
  onMenu: () => void;
  onRules: () => void;
  onRestart: () => void;
}

export interface TableUi {
  root: HTMLElement;
  mounted(fresh?: boolean): void;
  dispose(): void;
}

const HURRY_MS = 10_000;
const REVEAL_MS = 5_000;

function timerBar(timer: { endsAt: number; total: number }): HTMLElement {
  const remaining = Math.max(0, timer.endsAt - performance.now());
  const bar = el('div', 'turn-bar', el('span', 'turn-fill'));
  bar.style.setProperty('--from', String(Math.min(1, remaining / timer.total)));
  bar.style.setProperty('--left', `${remaining}ms`);
  if (remaining <= HURRY_MS) bar.classList.add('hurry');
  else setTimeout(() => bar.classList.add('hurry'), remaining - HURRY_MS);
  return bar;
}

const TEAM_LABELS = ['Nós', 'Eles'];
const CANASTRA_NAMES: Record<CanastraKind, string> = {
  limpa: 'Canastra limpa',
  suja: 'Canastra suja',
  canastrao: 'Canastrão',
  canastraoReal: 'Canastrão Real',
};
const CELEBRATION_MS = 1300;
const SORT_KEY = 'canastra-limpa:ordem';

function loadSort(): SortMode {
  try {
    return localStorage.getItem(SORT_KEY) === 'valor' ? 'valor' : 'naipe';
  } catch {
    return 'naipe';
  }
}


function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const ACTION_SOUNDS: Partial<Record<LastAction['type'], SoundName>> = {
  comprar: 'draw',
  pegarLixo: 'lixo',
  baixar: 'meld',
  adicionar: 'add',
  descartar: 'discard',
  bater: 'bater',
};

const EVENT_MS = 2100;
const NARROW_PX = 760;
const MIN_VISIBLE = 0.5;
const MIN_ZONE_PX = 90;
const LONG_MELD = 4;
const NUDGE_MS = 900;
const SHORT_PX = 520;
const SCROLL_KEEP = ['.felt', '.melds.theirs', '.melds.ours'];
const CENTER_PHASE_MS = 1150;
const SPREAD_CARD_MS = 480;
const SPREAD_STAGGER_MS = 42;
const MORTO_CARDS = 11;
const BANNER_MS = 2200;

export function createTable(controller: TableController, options: TableOptions): TableUi {
  const root = el('div', 'table');
  const selection = new Set<number>();
  const sortMode = loadSort();
  let choosingMeld = false;
  let lixoOpen = false;
  let toast: { text: string; until: number } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const me = controller.seat;
  const myTeam = teamOf(me);

  function notify(text: string, error = true): void {
    if (error) sound.play('error');
    toast = { text, until: performance.now() + 3200 };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      render();
    }, 3200);
    render();
  }

  function perform(action: Action): boolean {
    if (performance.now() < mortoBlockUntil) {
      notify(blockReason);
      return false;
    }
    const previous = [...selection];
    const wasChoosing = choosingMeld;
    selection.clear();
    choosingMeld = false;
    const wasOpen = lixoOpen;
    lixoOpen = false;
    const result = controller.act(action);
    if (!result.ok) {
      for (const id of previous) selection.add(id);
      choosingMeld = wasChoosing;
      lixoOpen = wasOpen;
      notify(result.error);
      return false;
    }
    return true;
  }

  function myTurn(view: PlayerView): boolean {
    return view.turn === me && (view.phase === 'comprar' || view.phase === 'jogar');
  }

  function playing(view: PlayerView): boolean {
    return myTurn(view) && view.phase === 'jogar';
  }

  function cardsOf(view: PlayerView, ids: Iterable<number>): Card[] {
    const wanted = new Set(ids);
    return view.hand.filter((card) => wanted.has(card.id));
  }

  function fitsMeld(meld: Meld, cards: readonly Card[]): boolean {
    return cards.length > 0 && extendMeld(meld, cards, controller.view().rules) !== null;
  }

  function formsMeld(cards: readonly Card[]): boolean {
    return cards.length >= 3 && arrangeSequence(cards) !== null;
  }

  function toggle(card: Card): void {
    if (selection.has(card.id)) {
      selection.delete(card.id);
      sound.play('deselect');
    } else {
      const suit = cardsOf(controller.view(), selection).find((item) => !isWild(item))?.suit;
      if (!isWild(card) && suit && card.suit !== suit) selection.clear();
      selection.add(card.id);
      sound.play('select');
    }
    render(false);
  }

  function baixar(ids: number[]): void {
    const view = controller.view();
    if (!playing(view)) return;
    if (ids.length < 3) {
      notify('Um jogo precisa de pelo menos 3 cartas.');
      return;
    }
    const spare = missingWild(view, cardsOf(view, ids));
    if (spare) {
      nudge({ card: spare.id });
      return;
    }
    perform({ type: 'baixar', cards: ids });
  }

  function missingWild(view: PlayerView, cards: readonly Card[]): Card | null {
    if (cards.length < 2 || arrangeSequence(cards)) return null;
    const spare = view.hand.find((card) => isWild(card) && !cards.some((item) => item.id === card.id));
    return spare && arrangeSequence([...cards, spare]) ? spare : null;
  }

  function nudge(hint: { pile?: string; card?: number }): void {
    sound.play('error');
    nudgeUntil = performance.now() + NUDGE_MS;
    nudgePile = hint.pile ?? null;
    nudgeCard = hint.card ?? null;
    setTimeout(() => {
      if (performance.now() >= nudgeUntil) render(false);
    }, NUDGE_MS + 20);
    render(false);
  }

  function nudging(): boolean {
    return performance.now() < nudgeUntil;
  }

  function closedTopUsable(view: PlayerView): boolean {
    const top = view.lixo[view.lixo.length - 1];
    if (!top) return false;
    const chosen = cardsOf(view, selection);
    if (chosen.length >= 2 && arrangeSequence([top, ...chosen])) return true;
    if (view.melds.some((meld) => meld.team === myTeam && extendMeld(meld, [top, ...chosen], view.rules) !== null)) return true;
    if (chosen.length > 0) return false;
    const hand = view.hand;
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) if (arrangeSequence([top, hand[i], hand[j]])) return true;
    }
    return false;
  }

  function descartar(ids: number[]): void {
    if (!playing(controller.view())) return;
    if (ids.length !== 1) {
      notify('Para descartar, use uma carta só.');
      return;
    }
    perform({ type: 'descartar', card: ids[0] });
  }

  function vulnerableTag(view: PlayerView, team: number): HTMLElement | null {
    if (!isVulnerable(view, team) || (view.phase !== 'comprar' && view.phase !== 'jogar')) return null;
    if (!needsOpening(view, team)) return el('span', 'tag vulneravel open', 'Vulnerável · aberta');
    const points = openingPoints(view.melds, team);
    const text = points > 0 ? `Abertura ${points}/${view.minimo[team]}` : `Vulnerável · abre com ${view.minimo[team]}`;
    const tag = el('span', `tag vulneravel${points > 0 ? ' opening' : ''}`, text);
    tag.title = 'A primeira baixada da dupla nesta mão precisa somar o mínimo em cartas antes do descarte.';
    return tag;
  }

  let lastMinimo: number[] | null = null;

  function watchPenalty(view: PlayerView): void {
    const previous = lastMinimo;
    lastMinimo = [...view.minimo];
    if (!previous || !mounted) return;
    for (const team of [0, 1]) {
      if (view.minimo[team] <= previous[team]) continue;
      const entry = [...view.log].reverse().find((item) => item.type === 'vulneravel');
      const seat = entry && entry.seat !== null ? entry.seat : null;
      const who = seat === me ? 'Você' : seat !== null ? controller.names[seat] : team === myTeam ? 'Sua dupla' : 'A outra dupla';
      notify(`${who} não abriu com ${previous[team]}: os jogos voltaram para a mão. Agora a abertura é ${view.minimo[team]}.`);
    }
  }

  function clickMonte(view: PlayerView): void {
    if (!myTurn(view)) {
      notify('Aguarde a sua vez.');
      return;
    }
    if (view.phase !== 'comprar') {
      notify('Você já comprou nesta vez.');
      return;
    }
    perform({ type: 'comprar' });
  }

  function canTakeLixo(view: PlayerView): boolean {
    return lixoOpen && myTurn(view) && view.phase === 'comprar' && view.lixo.length > 0;
  }

  function clickLixo(view: PlayerView): void {
    if (playing(view) && selection.size > 0) {
      descartar([...selection]);
      return;
    }
    if (view.lixo.length === 0) {
      lixoOpen = false;
      notify('O lixo está vazio.');
      return;
    }
    if (view.rules.lixo === 'fechado' && myTurn(view) && view.phase === 'comprar') {
      takeLixo(view);
      return;
    }
    lixoOpen = !lixoOpen;
    sound.play(lixoOpen ? 'select' : 'deselect');
    render();
  }

  function takeLixo(view: PlayerView): void {
    if (view.rules.lixo === 'aberto') {
      perform({ type: 'pegarLixo' });
      return;
    }
    const cards = [...selection];
    const top = view.lixo[view.lixo.length - 1];
    const chosen = cardsOf(view, cards);
    const fits = top ? view.melds.filter((meld) => meld.team === myTeam && extendMeld(meld, [top, ...chosen], view.rules) !== null) : [];
    if (cards.length >= 2 && top && arrangeSequence([top, ...chosen])) {
      perform({ type: 'pegarLixo', cards });
      return;
    }
    if (fits.length === 1) {
      perform({ type: 'pegarLixo', meld: fits[0].id, cards });
      return;
    }
    if (fits.length > 1) {
      choosingMeld = true;
      lixoOpen = false;
      sound.play('select');
      render(false);
      return;
    }
    const spare = top ? missingWild(view, [top, ...chosen]) : null;
    nudge(spare ? { card: spare.id } : { pile: 'lixo' });
  }

  function clickMeld(view: PlayerView, meld: Meld): void {
    const sandbox = controller.sandbox;
    if (sandbox && draft.length > 0 && (paletteTarget === 'nos' || paletteTarget === 'eles')) {
      const team = paletteTarget === 'nos' ? myTeam : 1 - myTeam;
      if (meld.team === team) {
        const error = sandbox.meldAs(team, draft, meld.id);
        if (error) notify(error);
        else draft = [];
        return;
      }
    }
    if (!myTurn(view) || meld.team !== myTeam) return;
    if (view.phase === 'comprar' && (choosingMeld || (view.rules.lixo === 'fechado' && view.lixo.length > 0))) {
      perform({ type: 'pegarLixo', meld: meld.id, cards: [...selection] });
      return;
    }
    if (view.phase !== 'jogar') return;
    if (selection.size === 0) {
      notify('Selecione as cartas da mão que vão entrar nesse jogo.');
      return;
    }
    perform({ type: 'adicionar', meld: meld.id, cards: [...selection] });
  }

  function revealedCards(cards: readonly Card[]): HTMLElement {
    return el(
      'div',
      'revealed',
      ...cards.map((card, index) => {
        const face = cardElement(card);
        face.classList.add('rv-face');
        const item = el('div', 'revealed-card', el('div', 'rv-inner', cardBack('rv-back'), face), el('span', 'deduct', `-${cardPoints(card)}`));
        item.style.setProperty('--i', String(index));
        return item;
      }),
    );
  }

  function seatElement(view: PlayerView, seat: number, position: string): HTMLElement {
    const team = teamOf(seat);
    const count = seatHold.get(seat) ?? view.handCounts[seat];
    const shown = revealing(view) ? view.revealed?.[seat] ?? null : null;
    const backs = shown
      ? revealedCards(shown)
      : el('div', 'backs', ...Array.from({ length: count }, () => cardBack('mini')));
    if (!shown) backs.style.setProperty('--count', String(Math.max(1, count)));
    if (!shown) backs.dataset.anchor = `hand-${seat}`;
    const lost = shown ? shown.reduce((sum, card) => sum + cardPoints(card), 0) : 0;
    const name = el('span', 'seat-name', controller.names[seat]);
    const tags = el('span', 'seat-tags', controller.bots[seat] ? el('span', 'tag', 'bot') : null, team === myTeam ? el('span', 'tag team-us', 'parceiro') : null);
    const countLabel = shown ? el('span', 'seat-count lost', lost > 0 ? `-${lost} pontos` : 'sem cartas') : el('span', 'seat-count', plural(count, 'carta', 'cartas'));
    const element = el('div', `seat seat-${position} team-${team === myTeam ? 'us' : 'them'}${shown ? ' revealing' : ''}`, el('div', 'seat-head', name, tags), backs, countLabel);
    const active = view.turn === seat && (view.phase === 'comprar' || view.phase === 'jogar');
    if (active) element.classList.add('active');
    if (controller.turnTimer !== undefined) element.append(active && controller.turnTimer ? timerBar(controller.turnTimer) : el('div', 'turn-bar idle'));
    element.dataset.anchor = `seat-${seat}`;
    return element;
  }

  function meldElement(view: PlayerView, meld: Meld): HTMLElement {
    const ours = meld.team === myTeam;
    const cards = el(
      'div',
      'meld-cards',
      ...meld.cards.map((card, index, all) => {
        const element = cardElement(card);
        if (index >= 2 && index < all.length - 1 && all[index - 1].id !== meld.wild) element.classList.add('squeeze');
        return element;
      }),
    );
    const canastra = meld.cards.length >= CANASTRA_SIZE;
    const special = canastraKind(meld.cards, meld.wild);
    const kind = canastra ? (meld.wild === null ? 'limpa' : 'suja') : '';
    const badge = el('span', `meld-badge ${kind}`.trim(), String(meld.cards.length));
    badge.title = special ? `${CANASTRA_NAMES[special]}, ${plural(meld.cards.length, 'carta', 'cartas')}` : plural(meld.cards.length, 'carta', 'cartas');
    const royal = special === 'canastrao' || special === 'canastraoReal' ? ` ${special}` : '';
    const remove = controller.sandbox ? button('×', 'meld-remove', () => controller.sandbox?.removeMeld(meld.id)) : null;
    if (remove) {
      remove.setAttribute('aria-label', 'Tirar este jogo da mesa');
      remove.addEventListener('click', (event) => event.stopPropagation());
    }
    const line = canastra ? el('span', 'meld-line') : null;
    const element = el('div', `${canastra ? `meld canastra ${kind}${royal}` : 'meld'}${meld.cards.length >= LONG_MELD ? ' long' : ''}`, cards, line, badge, remove);
    const party = celebrating.get(meld.id);
    if (party && canastra) {
      const elapsed = performance.now() - party;
      if (elapsed < CELEBRATION_MS) {
        element.classList.add('celebrate');
        if (cleanedMelds.has(meld.id)) element.classList.add('cleaned');
        element.style.setProperty('--party-delay', `${-Math.max(0, elapsed)}ms`);
      } else {
        celebrating.delete(meld.id);
        cleanedMelds.delete(meld.id);
      }
    }
    element.dataset.meld = String(meld.id);
    if (ours) element.dataset.drop = `meld:${meld.id}`;
    const top = view.lixo[view.lixo.length - 1];
    const selected = cardsOf(view, selection);
    const clickable =
      ours &&
      ((playing(view) && fitsMeld(meld, selected)) || ((choosingMeld || view.rules.lixo === 'fechado') && myTurn(view) && view.phase === 'comprar' && top !== undefined && fitsMeld(meld, [top, ...selected])));
    if (clickable) {
      element.classList.add('target');
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', 'Acrescentar as cartas selecionadas a este jogo');
    }
    element.addEventListener('click', () => clickMeld(controller.view(), meld));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') clickMeld(controller.view(), meld);
    });
    return element;
  }

  function meldZone(view: PlayerView, team: number): HTMLElement {
    const melds = view.melds.filter((meld) => meld.team === team);
    const label = team === myTeam ? (view.seats === 4 ? 'Jogos da nossa dupla' : 'Seus jogos') : view.seats === 4 ? 'Jogos da outra dupla' : 'Jogos do adversário';
    const morto = view.mortoCount[team] > 0 ? el('span', 'tag morto-ok', view.mortoCount[team] > 1 ? 'pegou os 2 mortos' : 'pegou o morto') : null;
    const ours = team === myTeam;
    const items = melds.map((meld) => meldElement(view, meld));
    if (ours && playing(view) && selection.size >= 3) {
      const valid = formsMeld(cardsOf(view, selection));
      const slot = el('div', `meld new-slot${valid ? ' target' : ' invalid'}`, el('span', 'new-plus', '+'), el('span', 'new-label', valid ? 'Baixar novo jogo' : 'Não forma sequência'));
      slot.dataset.drop = 'new';
      slot.tabIndex = 0;
      slot.setAttribute('role', 'button');
      slot.addEventListener('click', () => baixar([...selection]));
      slot.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') baixar([...selection]);
      });
      items.push(slot);
    }
    const zone = el(
      'section',
      `melds ${ours ? 'ours' : 'theirs'}`,
      el('div', 'zone-head', el('span', 'zone-label', label), morto, vulnerableTag(view, team)),
      items.length === 0 ? el('p', 'zone-empty', 'Nenhum jogo baixado') : el('div', 'meld-list', ...items),
    );
    if (ours) {
      zone.dataset.drop = 'new';
      zone.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.meld') || selection.size === 0) return;
        if (!myTurn(controller.view())) notify('Aguarde a sua vez.');
        else if (controller.view().phase === 'comprar') notify('Compre uma carta antes de baixar um jogo.');
        else baixar([...selection]);
      });
    }
    return zone;
  }

  function pile(label: string, content: HTMLElement, count: string, onClick: (() => void) | null, active: boolean): HTMLElement {
    const element = el('div', `pile${active ? ' target' : ''}`, content, el('span', 'pile-label', label), el('span', 'pile-count', count));
    element.dataset.anchor = label.toLowerCase();
    if (label === 'Lixo') element.dataset.drop = 'lixo';
    if (onClick) {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.addEventListener('click', onClick);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      });
    }
    return element;
  }

  function centerElement(view: PlayerView): HTMLElement {
    const drawing = myTurn(view) && view.phase === 'comprar';
    const discarding = playing(view) && selection.size === 1;
    const monte = pile('Monte', view.monteCount === 0 ? el('div', 'card empty', 'vazio') : el('div', 'stack', cardBack(), cardBack()), plural(view.monteCount, 'carta', 'cartas'), () => clickMonte(controller.view()), drawing);
    const closed = view.rules.lixo === 'fechado';
    const visible = closed ? view.lixo.slice(-2) : view.lixo;
    const lixoCards = visible.map((card) => cardElement(card));
    const expanded = lixoOpen && !closed;
    const lixoContent =
      view.lixo.length === 0
        ? el('div', 'card empty', 'vazio')
        : el('div', `lixo-wrap${!expanded && view.lixo.length > 1 ? ' piled' : ''}`, el('div', `lixo-cards${expanded ? ' open' : ''}`, ...lixoCards));
    const lixoReady = drawing && view.lixo.length > 0 && (!closed || closedTopUsable(view));
    const lixo = pile('Lixo', lixoContent, plural(view.lixo.length, 'carta', 'cartas'), () => clickLixo(controller.view()), lixoReady || discarding || lixoOpen);
    if (nudging() && nudgePile === 'lixo') lixo.classList.add('nudge');
    const mortos = pile('Mortos', el('div', 'stack mortos', ...Array.from({ length: view.mortosLeft }, () => cardBack())), view.mortosLeft === 0 ? 'nenhum' : `${view.mortosLeft} na mesa`, null, false);
    return el('section', 'center', monte, lixo, mortos);
  }

  let picked = new Set<number>();
  let pickedSeen = -1;
  let handBefore = new Set<number>();

  function trackPicked(view: PlayerView): void {
    if (pickedSeen >= 0 && view.actions !== pickedSeen) {
      const latest = view.log[view.log.length - 1];
      if (latest && latest.seat === me && (latest.type === 'comprar' || latest.type === 'pegarLixo')) {
        picked = new Set(view.hand.filter((card) => !handBefore.has(card.id)).map((card) => card.id));
      }
    }
    pickedSeen = view.actions;
    if (!playing(view)) picked = new Set();
    handBefore = new Set(view.hand.map((card) => card.id));
  }

  function handElement(view: PlayerView): HTMLElement {
    const showing = revealing(view);
    const cards = sortHand(view.hand, sortMode).map((card, index) => {
      const element = cardElement(card, { selected: selection.has(card.id) });
      element.style.setProperty('--i', String(index));
      if (!showing && picked.has(card.id)) element.classList.add('picked', ...(card.id === view.lixoTop ? ['locked'] : []));
      if (nudging() && nudgeCard === card.id) element.classList.add('nudge');
      if (showing) element.append(el('span', 'deduct', `-${cardPoints(card)}`));
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-pressed', String(selection.has(card.id)));
      element.addEventListener('click', () => {
        if (suppressClick) return;
        const current = controller.view();
        if (canTakeLixo(current) && current.rules.lixo === 'aberto') return;
        toggle(card);
      });
      element.addEventListener('pointerdown', (event) => startPress(event, card));
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(card);
        }
      });
      return element;
    });
    const hand = el('div', `hand${popHand ? ' deal-in' : ''}`, ...cards);
    popHand = false;
    hand.dataset.anchor = 'hand';
    return hand;
  }

  function resultRows(result: HandResult): HTMLElement {
    const kinds: { label: string; count: (score: HandResult['teams'][number]) => number; bonus: number }[] = [
      { label: 'Canastras limpas', count: (score) => score.canastrasLimpas, bonus: CANASTRA_BONUS.limpa },
      { label: 'Canastras sujas', count: (score) => score.canastrasSujas, bonus: CANASTRA_BONUS.suja },
      { label: 'Canastrão', count: (score) => score.canastroes, bonus: CANASTRA_BONUS.canastrao },
      { label: 'Canastrão Real', count: (score) => score.canastroesReais, bonus: CANASTRA_BONUS.canastraoReal },
    ];
    const canastraRows: [string, (team: number) => string][] = kinds
      .filter((kind, index) => index < 2 || result.teams.some((score) => kind.count(score) > 0))
      .map((kind) => [
        kind.label,
        (team) => {
          const count = kind.count(result.teams[team]);
          return count ? `${count} × ${kind.bonus} = +${count * kind.bonus}` : '0';
        },
      ]);
    const rows: [string, (index: number) => string][] = [
      ['Cartas nos jogos', (team) => String(result.teams[team].cartas)],
      ...canastraRows,
      ['Batida', (team) => (result.teams[team].batida ? '+100' : '0')],
      ['Cartas na mão', (team) => String(result.teams[team].mao)],
      ['Morto', (team) => (result.teams[team].morto ? '-100' : '0')],
      ['Total da mão', (team) => String(result.teams[team].total)],
    ];
    const order = [myTeam, 1 - myTeam];
    const head = el('tr', '', el('th', ''), ...order.map((team) => el('th', team === myTeam ? 'us' : 'them', TEAM_LABELS[team === myTeam ? 0 : 1])));
    return el(
      'table',
      'score-table',
      el('thead', '', head),
      el('tbody', '', ...rows.map(([label, value]) => el('tr', label === 'Total da mão' ? 'total' : '', el('th', '', label), ...order.map((team) => el('td', '', value(team)))))),
    );
  }

  function endModal(view: PlayerView): HTMLElement | null {
    if (view.phase !== 'fimDeMao' && view.phase !== 'fimDePartida') return null;
    if (revealing(view)) return null;
    const result = view.history[view.history.length - 1];
    if (!result) return null;
    const finished = view.phase === 'fimDePartida';
    const title = finished
      ? view.winner === myTeam
        ? view.seats === 4
          ? 'Sua dupla venceu a partida!'
          : 'Você venceu a partida!'
        : view.seats === 4
          ? 'A outra dupla venceu a partida'
          : `${controller.names[(me + 1) % view.seats]} venceu a partida`
      : result.batida === null
        ? `Fim da mão ${result.hand}: o monte acabou`
        : `Fim da mão ${result.hand}: ${batedor(view) ?? (result.batida === myTeam ? (view.seats === 4 ? 'sua dupla bateu' : 'você bateu') : 'a outra dupla bateu')}`;
    const totals = el(
      'p',
      'totals',
      `Placar: ${TEAM_LABELS[0]} ${view.scores[myTeam]} × ${view.scores[1 - myTeam]} ${TEAM_LABELS[1]} (${view.rules.meta === 0 ? 'partida de uma mão' : `meta ${view.rules.meta}`})`,
    );
    const waiting = controller.waitingNext;
    const nextLabel = waiting?.voted ? `Aguardando os outros (${waiting.votes}/${waiting.needed})` : 'Próxima mão';
    const restart =
      controller.isHost === false ? el('p', 'muted', 'Aguardando quem criou a sala começar outra partida.') : button('Jogar de novo', 'button primary', options.onRestart);
    const actions = finished
      ? el('div', 'actions', restart, button('Menu', 'button secondary', options.onMenu))
      : el('div', 'actions', button(nextLabel, 'button primary', () => controller.nextHand(), Boolean(waiting?.voted)));
    const key = `${view.handNumber}:${view.phase}`;
    const still = key === shownModal;
    shownModal = key;
    return el('div', `modal-backdrop${still ? ' still' : ''}`, el('div', `modal${still ? ' still' : ''}`, el('h2', '', title), resultRows(result), totals, actions));
  }

  function batedor(view: PlayerView): string | null {
    const entry = [...view.log].reverse().find((item) => item.type === 'bater');
    if (!entry || entry.seat === null) return null;
    if (entry.seat === me) return 'você bateu';
    const partner = teamOf(entry.seat) === myTeam ? ' (sua dupla)' : '';
    return `${controller.names[entry.seat]}${partner} bateu`;
  }

  let detailsOpen = false;
  let shownModal = '';
  let shownToast: { text: string; until: number } | null = null;
  let lastActions = -1;
  let eventsBusyUntil = 0;
  let mortoArrivingUntil = 0;
  let mortoBlockUntil = 0;
  let nudgeUntil = 0;
  let nudgePile: string | null = null;
  let nudgeCard: number | null = null;
  const seatHold = new Map<number, number>();
  let blockReason = 'Aguarde o morto chegar.';
  let popHand = false;

  function center(rect: DOMRect): { x: number; y: number } {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function anchorRect(anchor: string): DOMRect | null {
    const element = root.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`);
    return element ? element.getBoundingClientRect() : null;
  }

  function schedule(duration: number, run: () => void): void {
    const start = Math.max(performance.now(), eventsBusyUntil);
    eventsBusyUntil = start + duration;
    setTimeout(() => {
      if (!disposed) run();
    }, start - performance.now());
  }

  function landingSpots(target: string, count: number): DOMRect[] {
    if (target === 'hand') {
      const cards = [...root.querySelectorAll<HTMLElement>('.hand .card')].map((card) => card.getBoundingClientRect());
      if (cards.length > 0) return cards;
    }
    const own = anchorRect(target);
    const area = own && own.width >= 12 ? own : anchorRect(target.replace('hand-', 'seat-')) ?? own;
    if (!area) return [];
    const sample = root.querySelector<HTMLElement>(`[data-anchor="${target}"] .card`)?.getBoundingClientRect();
    const width = sample && sample.width > 0 ? sample.width : Math.min(area.width, 40);
    const height = width * 1.4;
    if (target === 'monte') {
      const base = sample && sample.width > 0 ? sample : area;
      return Array.from({ length: count }, (_, i) => new DOMRect(base.left + base.width / 2 - width / 2 + ((i % 3) - 1) * 1.5, base.top + base.height / 2 - height / 2 - i * 0.6, width, height));
    }
    const vertical = area.height > area.width * 1.3;
    return Array.from({ length: count }, (_, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = vertical ? area.left + area.width / 2 - width / 2 : area.left + t * Math.max(0, area.width - width);
      const y = vertical ? area.top + t * Math.max(0, area.height - height) : area.top + area.height / 2 - height / 2;
      return new DOMRect(x, y, width, height);
    });
  }

  function spreadCards(origin: DOMRect, spots: readonly DOMRect[], keep: boolean, onDone: () => void): void {
    const from = center(origin);
    const flying = spots.map((spot, i) => {
      const card = cardBack('morto-card');
      Object.assign(card.style, { left: `${spot.left}px`, top: `${spot.top}px`, width: `${spot.width}px`, height: `${spot.height}px` });
      card.style.setProperty('--card-w', `${spot.width}px`);
      document.body.append(card);
      const to = center(spot);
      const scale = origin.width / Math.max(1, spot.width);
      const tilt = (i - (spots.length - 1) / 2) * 3;
      const lift = Math.min(90, Math.hypot(from.x - to.x, from.y - to.y) * 0.18);
      const animation = card.animate(
        [
          { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${scale}) rotate(${tilt}deg)` },
          { transform: `translate(${(from.x - to.x) * 0.45}px, ${(from.y - to.y) * 0.45 - lift}px) scale(${(scale + 1) / 2}) rotate(${tilt / 2}deg)`, offset: 0.5 },
          { transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
        ],
        { duration: SPREAD_CARD_MS, delay: i * SPREAD_STAGGER_MS, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'backwards' },
      );
      if (!keep) animation.onfinish = () => card.remove();
      return card;
    });
    setTimeout(() => {
      for (const card of flying) card.remove();
      onDone();
    }, SPREAD_CARD_MS + Math.max(0, spots.length - 1) * SPREAD_STAGGER_MS + 30);
  }

  function mortoFlight(label: string, target: string, landing: SoundName, onLand?: () => void): void {
    schedule(EVENT_MS, () => {
      const from = anchorRect('mortos');
      if (!from) {
        onLand?.();
        return;
      }
      const start = center(from);
      const middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const stack = el(
        'div',
        'morto-stack',
        ...Array.from({ length: 5 }, (_, i) => {
          const back = cardBack();
          back.style.setProperty('--k', String(i));
          if (i === 4) back.append(el('div', 'morto-shine'));
          return back;
        }),
      );
      const glow = el('div', 'morto-glow');
      const caption = el('div', 'event-caption', label);
      const layer = el('div', 'morto-fly', glow, stack, caption);
      document.body.append(layer);
      const at = (point: { x: number; y: number }, scale: number) => `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) scale(${scale})`;
      sound.play('mortoVoa');
      layer.animate(
        [
          { transform: at(start, 0.7), opacity: 0.9, offset: 0 },
          { transform: at(middle, 1.7), opacity: 1, offset: 0.5 },
          { transform: at(middle, 1.7), opacity: 1, offset: 1 },
        ],
        { duration: CENTER_PHASE_MS, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'both' },
      );
      caption.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration: CENTER_PHASE_MS, fill: 'both' });
      glow.animate(
        [
          { opacity: 0, transform: 'scale(0.4)' },
          { opacity: 0, transform: 'scale(0.4)', offset: 0.45 },
          { opacity: 1, transform: 'scale(1.15)', offset: 0.7 },
          { opacity: 0.75, transform: 'scale(0.95)', offset: 0.85 },
          { opacity: 1, transform: 'scale(1.1)' },
        ],
        { duration: CENTER_PHASE_MS, fill: 'both' },
      );
      stack.querySelector<HTMLElement>('.morto-shine')?.animate(
        [
          { backgroundPosition: '160% 0', opacity: 0 },
          { backgroundPosition: '160% 0', opacity: 1, offset: 0.55 },
          { backgroundPosition: '-60% 0', opacity: 1 },
        ],
        { duration: CENTER_PHASE_MS, fill: 'both' },
      );
      setTimeout(() => {
        if (disposed) return;
        sound.play('brilho');
        sparkles(stack, true);
      }, CENTER_PHASE_MS * 0.55);
      setTimeout(() => {
        const cards = stack.querySelectorAll<HTMLElement>('.card');
        const top = cards[cards.length - 1]?.getBoundingClientRect();
        layer.remove();
        if (disposed) return;
        const spots = landingSpots(target, MORTO_CARDS);
        if (!top || spots.length === 0) {
          sound.play(landing);
          onLand?.();
          return;
        }
        sound.play('deal');
        spreadCards(top, spots, target === 'hand', () => {
          sound.play(landing);
          onLand?.();
        });
      }, CENTER_PHASE_MS);
      setTimeout(() => layer.remove(), EVENT_MS + 500);
    });
  }

  function banner(title: string, subtitle: string, tone: 'us' | 'them' | 'neutral'): void {
    schedule(600, () => {
      const element = el('div', `event-banner ${tone}`, el('strong', '', title), subtitle ? el('span', '', subtitle) : null);
      document.body.append(element);
      element.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.12 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.85 },
          { transform: 'translate(-50%, -50%) scale(0.96)', opacity: 0 },
        ],
        { duration: BANNER_MS, easing: 'ease-out', fill: 'both' },
      ).onfinish = () => element.remove();
      setTimeout(() => sparkles(element, tone !== 'them'), 180);
      setTimeout(() => element.remove(), BANNER_MS + 400);
    });
  }

  function who(seat: number): string {
    return seat === me ? 'Você' : controller.names[seat];
  }

  function holdMortoSeats(view: PlayerView): void {
    const fresh = view.actions - lastActions;
    if (lastActions < 0 || !mounted || fresh <= 0) return;
    for (const entry of view.log.slice(-Math.min(fresh, view.log.length))) {
      if (entry.type === 'morto' && entry.seat !== me) seatHold.set(entry.seat, 0);
    }
  }

  function playEvents(view: PlayerView): void {
    const previous = lastActions;
    lastActions = view.actions;
    if (previous < 0 || !mounted || view.actions <= previous) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const entries = view.log.slice(-Math.min(view.actions - previous, view.log.length));
    for (const entry of entries) {
      if (entry.type === 'morto') {
        const team = teamOf(entry.seat);
        const second = view.mortoCount[team] > 1 ? 'o segundo morto' : 'o morto';
        const label = `${who(entry.seat)} pegou ${second}!`;
        if (entry.seat === me) {
          mortoArrivingUntil = Math.max(performance.now(), eventsBusyUntil) + EVENT_MS;
          root.querySelector('.dock')?.classList.add('morto-arriving');
          mortoFlight(label, 'hand', 'morto', () => {
            mortoArrivingUntil = 0;
            popHand = true;
            render(false);
          });
        } else {
          const seat = entry.seat;
          mortoFlight(label, `hand-${seat}`, 'morto', () => {
            seatHold.delete(seat);
            render(false);
          });
        }
        mortoBlockUntil = eventsBusyUntil;
        blockReason = 'Aguarde o morto chegar.';
      } else if (entry.type === 'monteVazio') {
        if (view.monteCount > 0) {
          mortoFlight('O morto virou monte', 'monte', 'mortoMonte');
          mortoBlockUntil = eventsBusyUntil;
          blockReason = 'Aguarde o morto virar monte.';
        }
        else banner('O monte acabou', 'Mão encerrada sem batida', 'neutral');
      } else if (entry.type === 'bater') {
        const team = teamOf(entry.seat);
        const title = entry.seat === me ? 'Você bateu!' : `${controller.names[entry.seat]} bateu!`;
        banner(title, `+100 para ${team === myTeam ? 'nós' : 'eles'}`, team === myTeam ? 'us' : 'them');
      }
    }
  }

  function breakdown(view: PlayerView, team: number): HTMLElement {
    const melds = view.melds.filter((meld) => meld.team === team);
    const cards = melds.reduce((sum, meld) => sum + meld.cards.reduce((acc, card) => acc + cardPoints(card), 0), 0);
    const kinds = melds.map((meld) => canastraKind(meld.cards, meld.wild)).filter((kind): kind is CanastraKind => kind !== null);
    const rows: [string, number][] = [['Mãos anteriores', view.scores[team]], ['Cartas na mesa', cards]];
    for (const kind of ['limpa', 'suja', 'canastrao', 'canastraoReal'] as CanastraKind[]) {
      const count = kinds.filter((item) => item === kind).length;
      if (count > 0) rows.push([`${count}× ${CANASTRA_NAMES[kind].toLowerCase()}`, count * CANASTRA_BONUS[kind]]);
    }
    const total = view.scores[team] + (view.phase === 'comprar' || view.phase === 'jogar' ? tablePoints(view.melds, team) : 0);
    return el(
      'div',
      `breakdown ${team === myTeam ? 'us' : 'them'}`,
      el('h4', '', TEAM_LABELS[team === myTeam ? 0 : 1]),
      ...rows.map(([label, value]) => el('div', 'breakdown-row', el('span', '', label), el('b', '', String(value)))),
      el('div', 'breakdown-row total', el('span', '', 'Total agora'), el('b', '', String(total))),
    );
  }

  function scoresElement(us: HTMLElement, them: HTMLElement, toggle: HTMLElement, details: HTMLElement | null): HTMLElement {
    const element = el('div', 'scores', us, el('span', 'versus', '×'), them, toggle, details);
    for (const target of [us, them]) {
      target.addEventListener('click', () => {
        detailsOpen = !detailsOpen;
        render(false);
      });
    }
    return element;
  }

  function topBar(view: PlayerView): HTMLElement {
    const score = (team: number) => {
      const mesa = view.phase === 'comprar' || view.phase === 'jogar' ? tablePoints(view.melds, team) : 0;
      const element = el('span', `score ${team === myTeam ? 'us' : 'them'}`, el('small', '', TEAM_LABELS[team === myTeam ? 0 : 1]), el('b', '', String(view.scores[team] + mesa)));
      element.dataset.score = String(team);
      return element;
    };
    const toggle = button(detailsOpen ? '▴' : '▾', 'button ghost small details-toggle', () => {
      detailsOpen = !detailsOpen;
      render(false);
    });
    toggle.setAttribute('aria-label', 'Ver o detalhe dos pontos');
    toggle.setAttribute('aria-expanded', String(detailsOpen));
    const details = detailsOpen
      ? el('div', 'details-panel', el('p', 'details-meta', view.rules.meta === 0 ? metaLabel(0) : `Mão ${view.handNumber} · meta ${view.rules.meta}`), breakdown(view, myTeam), breakdown(view, 1 - myTeam))
      : null;
    return el(
      'header',
      'bar',
      button('Menu', 'button ghost small', options.onMenu),
      scoresElement(score(myTeam), score(1 - myTeam), toggle, details),
      el('span', 'bar-info', view.rules.meta === 0 ? metaLabel(0) : `Mão ${view.handNumber} · meta ${view.rules.meta}`),
      controller.latency !== undefined ? pingBadge(() => controller.latency) : null,
      controller.sandbox ? button('Voltar jogada', 'button ghost small', () => controller.sandbox?.undo(), !controller.sandbox.canUndo()) : null,
      controller.sandbox ? button(paletteOpen ? 'Fechar cartas' : 'Cartas', `button small ${paletteOpen ? 'primary' : 'ghost'}`, togglePalette) : null,
      soundButton(),
      button('Regras', 'button ghost small', options.onRules),
    );
  }

  let paletteOpen = controller.sandbox !== undefined;

  function togglePalette(): void {
    paletteOpen = !paletteOpen;
    sound.play(paletteOpen ? 'select' : 'deselect');
    render();
  }

  let paletteTarget: 'mao' | 'lixo' | 'nos' | 'eles' = 'mao';
  let draft: SandboxCard[] = [];

  function pick(rank: number, suit: Suit | null): void {
    const sandbox = controller.sandbox;
    if (!sandbox) return;
    sound.play('draw');
    if (paletteTarget === 'mao') sandbox.addCard(rank, suit);
    else if (paletteTarget === 'lixo') sandbox.discardAs(rank, suit);
    else {
      draft.push({ rank, suit });
      render(false);
    }
  }

  function paletteTools(sandbox: NonNullable<TableController['sandbox']>): HTMLElement[] {
    const view = controller.view();
    const targets: [typeof paletteTarget, string][] = [
      ['mao', 'Minha mão'],
      ['lixo', 'Descarte do oponente'],
      ['nos', 'Jogo nosso'],
      ['eles', 'Jogo deles'],
    ];
    const switcher = el(
      'div',
      'palette-targets',
      ...targets.map(([value, label]) => {
        const element = button(label, `button small ${paletteTarget === value ? 'primary' : 'ghost'}`, () => {
          paletteTarget = value;
          draft = [];
          render(false);
        });
        element.setAttribute('aria-pressed', String(paletteTarget === value));
        return element;
      }),
    );
    const building = paletteTarget === 'nos' || paletteTarget === 'eles';
    const team = paletteTarget === 'nos' ? myTeam : 1 - myTeam;
    const draftRow = building
      ? el(
          'div',
          'palette-draft',
          draft.length === 0
            ? el('span', 'muted', 'Toque nas cartas para montar o jogo. Depois baixe, ou toque num jogo da mesa para acrescentar.')
            : el('div', 'palette-draft-cards', ...draft.map((item) => cardElement({ id: -1, ...item }))),
          el(
            'div',
            'palette-actions',
            button('Baixar jogo', 'button primary small', () => {
              const error = sandbox.meldAs(team, draft);
              if (error) notify(error);
              else draft = [];
            }, draft.length < 3),
            button('Limpar', 'button ghost small', () => {
              draft = [];
              render(false);
            }, draft.length === 0),
          ),
        )
      : null;
    const extras = el(
      'div',
      'palette-actions',
      button('Tirar selecionadas da mão', 'button ghost small', () => {
        sandbox.removeFromHand([...selection]);
        selection.clear();
      }, selection.size === 0),
      button('Esvaziar lixo', 'button ghost small', () => sandbox.clearLixo(), controller.view().lixo.length === 0),
    );
    const simulate = el(
      'div',
      'palette-actions',
      el('span', 'palette-label', 'Simular:'),
      button('Eu pego o morto', 'button ghost small', () => sandbox.mortoDemo('eu')),
      button('Oponente pega o morto', 'button ghost small', () => sandbox.mortoDemo('oponente')),
      button('Morto vira monte', 'button ghost small', () => sandbox.mortoDemo('monte')),
      button('Revelação do fim', 'button ghost small', () => sandbox.revealDemo(), !myTurn(view)),
      button(isVulnerable(view, myTeam) ? 'Sair do vulnerável' : 'Ficar vulnerável', 'button ghost small', () => sandbox.toggleVulnerable(), !myTurn(view)),
    );
    return [switcher, ...(draftRow ? [draftRow] : []), extras, simulate];
  }

  function paletteElement(): HTMLElement | null {
    const sandbox = controller.sandbox;
    if (!sandbox || !paletteOpen) return null;
    const rows = SUIT_ORDER.map((suit) =>
      el(
        'div',
        'palette-row',
        ...Array.from({ length: 13 }, (_, i) => {
          const rank = i + 1;
          const card = cardElement({ id: -1, rank, suit });
          delete card.dataset.id;
          card.setAttribute('role', 'button');
          card.tabIndex = 0;
          card.addEventListener('click', () => pick(rank, suit));
          return card;
        }),
      ),
    );
    const joker = cardElement({ id: -1, rank: 0, suit: null });
    delete joker.dataset.id;
    joker.setAttribute('role', 'button');
    joker.addEventListener('click', () => pick(0, null));
    const titles = { mao: 'colocar na sua mão', lixo: 'o oponente descarta no lixo', nos: 'montar um jogo da sua dupla', eles: 'montar um jogo da outra dupla' };
    const head = el('div', 'palette-head', el('p', 'palette-title', `Modo teste: toque numa carta para ${titles[paletteTarget]}. O × tira um jogo da mesa.`), button('Fechar', 'button ghost small', togglePalette));
    return el('div', 'palette', head, ...paletteTools(sandbox), ...rows, el('div', 'palette-row', joker));
  }

  function soundButton(): HTMLButtonElement {
    const label = () => [el('span', 'label-long', sound.enabled ? 'Som ligado' : 'Som desligado'), el('span', 'label-short', sound.enabled ? 'Som' : 'Mudo')];
    const element = button('', 'button ghost small', () => {
      sound.toggle();
      sound.unlock();
      sound.play('select');
      element.replaceChildren(...label());
      element.setAttribute('aria-pressed', String(sound.enabled));
    });
    element.replaceChildren(...label());
    element.setAttribute('aria-pressed', String(sound.enabled));
    return element;
  }

  let suppressClick = false;
  let press: { card: Card; x: number; y: number; pointer: number } | null = null;
  let drag: { ids: number[]; ghost: HTMLElement } | null = null;

  function dropTargets(ids: number[]): void {
    const view = controller.view();
    const cards = cardsOf(view, ids);
    for (const element of root.querySelectorAll<HTMLElement>('[data-drop]')) {
      const kind = element.dataset.drop as string;
      let ok = false;
      if (playing(view)) {
        if (kind === 'lixo') ok = cards.length === 1;
        else if (kind === 'new') ok = formsMeld(cards);
        else {
          const meld = view.melds.find((item) => `meld:${item.id}` === kind);
          ok = meld !== undefined && fitsMeld(meld, cards);
        }
      }
      element.classList.toggle('drop-ok', ok);
    }
  }

  function startPress(event: PointerEvent, card: Card): void {
    if (event.button !== 0) return;
    sound.unlock();
    press = { card, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
  }

  function onMove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointer) return;
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8) return;
      const ids = selection.has(press.card.id) ? [...selection] : [press.card.id];
      const ghost = el('div', 'drag-ghost', ...cardsOf(controller.view(), ids).map((card) => cardElement(card)));
      document.body.append(ghost);
      drag = { ids, ghost };
      root.classList.add('dragging');
      for (const id of ids) root.querySelector(`.hand .card[data-id="${id}"]`)?.classList.add('lifted');
      dropTargets(ids);
    }
    drag.ghost.style.translate = `${event.clientX}px ${event.clientY}px`;
  }

  function endDrag(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointercancel', endDrag);
    drag?.ghost.remove();
    drag = null;
    press = null;
    root.classList.remove('dragging');
    for (const element of root.querySelectorAll('.drop-ok, .lifted')) element.classList.remove('drop-ok', 'lifted');
  }

  function onUp(event: PointerEvent): void {
    const current = drag;
    if (!current) {
      endDrag();
      return;
    }
    current.ghost.style.display = 'none';
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drop]');
    const kind = target && root.contains(target) ? target.dataset.drop : undefined;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    endDrag();
    if (!kind) {
      render();
      return;
    }
    if (kind === 'lixo') descartar(current.ids);
    else if (kind === 'new') baixar(current.ids);
    else if (!playing(controller.view())) notify('Compre uma carta antes de jogar.');
    else perform({ type: 'adicionar', meld: Number(kind.slice(5)), cards: current.ids });
  }

  const celebrating = new Map<number, number>();
  const cleanedMelds = new Set<number>();
  let meldCards = new Map<number, number>();
  let meldSizes = new Map<number, { size: number; clean: boolean; kind: CanastraKind | null }>();

  function sparkles(target: HTMLElement, clean: boolean): void {
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const colors = target.classList.contains('canastraoReal')
      ? ['#ffd1e8', '#fff1a8', '#b8f5e0', '#bcd4ff', '#e7c6ff', '#ffffff']
      : target.classList.contains('canastrao')
        ? ['#e2c6ff', '#b77bff', '#9b5cf0', '#ffffff']
        : clean
          ? ['#fff4c4', '#f2c14e', '#ffd978', '#ffffff']
          : ['#f0b58a', '#c07a45', '#e39a6d', '#ffe3cc'];
    for (let i = 0; i < 18; i++) {
      const spark = el('div', `spark${i % 3 === 0 ? ' star' : ''}`);
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.background = colors[i % colors.length];
      spark.style.color = colors[i % colors.length];
      document.body.append(spark);
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const distance = rect.width * 0.35 + 40 + Math.random() * 50;
      const animation = spark.animate(
        [
          { translate: '-50% -50%', scale: '0.4', opacity: 1 },
          { translate: `calc(-50% + ${Math.cos(angle) * distance}px) calc(-50% + ${Math.sin(angle) * distance}px)`, scale: '1', opacity: 0 },
        ],
        { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
      );
      animation.onfinish = () => spark.remove();
    }
  }

  function celebrate(meldId: number, clean: boolean, delay: number, cleaned: boolean): void {
    setTimeout(() => {
      if (disposed) return;
      celebrating.set(meldId, performance.now());
      if (cleaned) cleanedMelds.add(meldId);
      const element = root.querySelector<HTMLElement>(`.meld[data-meld="${meldId}"]`);
      if (element) {
        element.classList.remove('celebrate', 'cleaned');
        void element.offsetWidth;
        element.style.setProperty('--party-delay', '0ms');
        element.classList.add('celebrate');
        if (cleaned) element.classList.add('cleaned');
        sparkles(element, clean);
      }
      sound.play(clean ? 'canastraLimpa' : 'canastraSuja');
    }, delay);
  }

  function floatText(target: HTMLElement, text: string, className: string, delay: number): void {
    setTimeout(() => {
      if (!target.isConnected) return;
      const rect = target.getBoundingClientRect();
      const label = el('div', `float-points ${className}`, text);
      const covered = target.nextElementSibling !== null && target.parentElement?.classList.contains('meld-cards');
      label.style.left = `${rect.left + (covered ? rect.width * 0.22 : rect.width / 2)}px`;
      const index = target.parentElement ? [...target.parentElement.children].indexOf(target) : 0;
      label.style.top = `${className.startsWith('big') ? rect.top - 58 : rect.top - 30 - (index % 2) * 22}px`;
      document.body.append(label);
      label.addEventListener('animationend', () => label.remove());
      setTimeout(() => label.remove(), 2000);
    }, delay);
  }

  function showPoints(view: PlayerView, reset: boolean): void {
    const current = new Map<number, number>();
    const sizes = new Map<number, { size: number; clean: boolean; kind: CanastraKind | null }>();
    for (const meld of view.melds) {
      for (const card of meld.cards) current.set(card.id, meld.id);
      sizes.set(meld.id, { size: meld.cards.length, clean: meld.wild === null, kind: canastraKind(meld.cards, meld.wild) });
    }
    if (!reset && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let index = 0;
      for (const meld of view.melds) {
        for (const card of meld.cards) {
          if (meldCards.has(card.id)) continue;
          const element = root.querySelector<HTMLElement>(`.meld[data-meld="${meld.id}"] .card[data-id="${card.id}"]`);
          if (element) floatText(element, `+${cardPoints(card)}`, meld.team === myTeam ? 'us' : 'them', 450 + index++ * 90);
        }
        const before = meldSizes.get(meld.id);
        const canastra = meld.cards.length >= CANASTRA_SIZE;
        const was = before !== undefined && before.size >= CANASTRA_SIZE;
        const clean = meld.wild === null;
        const cleaned = before !== undefined && !before.clean && clean;
        const special = canastraKind(meld.cards, meld.wild);
        const previousKind = before ? before.kind : null;
        const upgraded = special !== null && special !== previousKind && (special === 'canastrao' || special === 'canastraoReal');
        if (canastra && (!was || cleaned || upgraded)) {
          const element = root.querySelector<HTMLElement>(`.meld[data-meld="${meld.id}"]`);
          const gain = special ? CANASTRA_BONUS[special] - (previousKind ? CANASTRA_BONUS[previousKind] : 0) : 0;
          const text = upgraded
            ? `${CANASTRA_NAMES[special as CanastraKind]}! +${gain}`
            : cleaned
              ? (was ? `Limpou! +${gain}` : 'Limpou! +200 canastra limpa')
              : clean
                ? '+200 canastra limpa!'
                : '+100 canastra suja';
          const delay = 520 + index * 90;
          if (element) floatText(element, text, `big ${meld.team === myTeam ? 'us' : 'them'}`, delay + 120);
          celebrate(meld.id, clean, delay, cleaned);
        }
      }
    }
    meldCards = current;
    meldSizes = sizes;
  }

  function fitMelds(): void {
    const narrow = window.innerWidth <= NARROW_PX;
    const floor = narrow && window.innerHeight > SHORT_PX ? 1 : window.innerHeight <= SHORT_PX ? 0.42 : 0.62;
    const felt = root.querySelector<HTMLElement>('.felt');
    const zones = ['.melds.theirs', '.melds.ours'].map((selector) => root.querySelector<HTMLElement>(selector));
    for (const zone of zones) {
      zone?.style.setProperty('--meld-scale', '1');
      zone?.classList.remove('compact');
    }
    if (felt) {
      felt.style.gridTemplateRows = '';
      const needs = zones.map((zone) => (zone ? Math.max(MIN_ZONE_PX, [...zone.children].reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0) + 24) : MIN_ZONE_PX));
      felt.style.gridTemplateRows = `auto minmax(0, ${needs[0]}fr) minmax(0, ${needs[1]}fr)`;
    }
    for (const zone of root.querySelectorAll<HTMLElement>('.melds')) {
      let scale = 1;
      zone.style.setProperty('--meld-scale', '1');
      if (zone.scrollHeight > zone.clientHeight + 1) zone.classList.add('compact');
      while (zone.scrollHeight > zone.clientHeight + 1 && scale > floor) {
        scale = Math.round((scale - 0.06) * 100) / 100;
        zone.style.setProperty('--meld-scale', String(scale));
      }
    }
  }

  function fitHand(): void {
    const hand = root.querySelector<HTMLElement>('.hand');
    if (!hand) return;
    const cards = hand.querySelectorAll<HTMLElement>('.card');
    if (cards.length < 2) return;
    const width = cards[0].getBoundingClientRect().width;
    const available = hand.clientWidth - 8;
    const overlap = Math.min(6, (available - width * cards.length) / (cards.length - 1));
    const rows = window.innerWidth <= NARROW_PX && cards.length > 8 && width + overlap < width * MIN_VISIBLE;
    hand.classList.toggle('rows', rows);
    if (!rows) {
      hand.style.setProperty('--gap', `${Math.max(overlap, -width * 0.72)}px`);
      return;
    }
    const perRow = Math.ceil(cards.length / 2);
    const step = Math.min(width + 6, (available - width) / (perRow - 1));
    hand.style.setProperty('--per-row', String(perRow));
    hand.style.setProperty('--step', `${step}px`);
    hand.style.setProperty('--spill', `${Math.max(0, width - step)}px`);
  }

  let lastLogKey = '';
  let lastHandNumber = 0;
  let mounted = false;

  let lastTurnKey = '';
  let revealUntil = 0;
  let revealedHand = 0;

  function revealing(view: PlayerView): boolean {
    if (view.phase !== 'fimDeMao' && view.phase !== 'fimDePartida') return false;
    if (revealedHand !== view.handNumber) {
      revealedHand = view.handNumber;
      revealUntil = mounted ? performance.now() + REVEAL_MS : 0;
      if (revealUntil) setTimeout(() => render(false), REVEAL_MS + 30);
    }
    return performance.now() < revealUntil;
  }

  function playSounds(view: PlayerView, latest: LastAction | undefined, newHand: boolean): void {
    if (!mounted) return;
    if (newHand) sound.play('deal');
    else if (latest) {
      const name = ACTION_SOUNDS[latest.type];
      if (name) sound.play(name);
    }
    const turnKey = `${view.handNumber}:${view.turn}:${view.phase}`;
    if (turnKey !== lastTurnKey && view.turn === me && view.phase === 'comprar') setTimeout(() => sound.play('turn'), 250);
    lastTurnKey = turnKey;
  }

  function motionPlan(view: PlayerView) {
    const key = String(view.actions);
    const changed = key !== lastLogKey;
    const newHand = view.handNumber !== lastHandNumber;
    lastLogKey = key;
    lastHandNumber = view.handNumber;
    const latest = changed ? view.log[view.log.length - 1] : undefined;
    const actor = latest && latest.seat !== null ? latest.seat : null;
    playSounds(view, latest, newHand);
    return {
      stagger: newHand,
      flights: actor !== null && actor !== me && !newHand && latest?.type === 'comprar' ? [{ from: 'monte', to: `hand-${actor}`, count: 1 }] : [],
      forceFresh: (element: HTMLElement) => newHand && element.closest('.hand') !== null,
      vanishTarget: latest?.type === 'pegarLixo' && actor !== me ? `hand-${actor}` : null,
      sourceFor(element: HTMLElement): string | null {
        if (element.closest('.revealed')) return null;
        const inHand = element.closest('.hand') !== null;
        if (newHand) return inHand ? 'monte' : null;
        if (!latest) return null;
        if (inHand) {
          if (latest?.type === 'morto' && actor === me) return null;
          if (latest?.type === 'pegarLixo' && actor === me) return 'lixo';
          return 'monte';
        }
        if (actor !== null && actor !== me) return `hand-${actor}`;
        return 'hand';
      },
    };
  }

  function render(motion = true): void {
    if (disposed || drag) return;
    const view = controller.view();
    trackPicked(view);
    holdMortoSeats(view);
    const valid = new Set(view.hand.map((card) => card.id));
    for (const id of [...selection]) if (!valid.has(id)) selection.delete(id);
    if (view.phase !== 'comprar') choosingMeld = false;
    const before = mounted ? snapshot(root) : null;
    const previousCards = new Map<string, HTMLElement>();
    for (const element of root.querySelectorAll<HTMLElement>('.card[data-id]')) previousCards.set(element.dataset.id as string, element);
    const positions = view.seats === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'top'];
    const others = Array.from({ length: view.seats }, (_, i) => i).filter((seat) => seat !== me);
    const seatElements = others.map((seat) => seatElement(view, seat, positions[(seat - me + view.seats) % view.seats]));
    const felt = el('div', `felt seats-${view.seats}`, ...seatElements, meldZone(view, 1 - myTeam), centerElement(view), meldZone(view, myTeam));
    if (view.lixo.length === 0) lixoOpen = false;
    const dock = el(
      'div',
      `dock${myTurn(view) ? ' active' : ''}${canTakeLixo(view) ? ' take-lixo' : ''}${performance.now() < mortoArrivingUntil ? ' morto-arriving' : ''}`,
      handElement(view),
    );
    if (controller.turnTimer !== undefined) dock.prepend(myTurn(view) && controller.turnTimer ? timerBar(controller.turnTimer) : el('div', 'turn-bar idle'));
    dock.addEventListener('click', (event) => {
      const current = controller.view();
      if (!canTakeLixo(current)) return;
      if (current.rules.lixo === 'fechado' && (event.target as HTMLElement).closest('.card')) return;
      takeLixo(current);
    });

    const toastElement = toast ? el('div', `toast${toast === shownToast ? ' still' : ''}`, toast.text) : null;
    shownToast = toast;
    const palette = paletteElement();
    root.classList.toggle('with-palette', palette !== null);
    const modal = endModal(view);
    if (!modal) shownModal = '';
    const scrolls = SCROLL_KEEP.map((selector) => root.querySelector<HTMLElement>(selector)?.scrollTop ?? 0);
    root.replaceChildren(topBar(view), felt, dock, palette ?? '', toastElement ?? '', modal ?? '');
    SCROLL_KEEP.forEach((selector, index) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (element && scrolls[index]) element.scrollTop = scrolls[index];
    });
    fitHand();
    fitMelds();
    const plan = motionPlan(view);
    watchPenalty(view);
    if (!motion) stopAnimations();
    else if (before && root.isConnected) play(root, before, plan, previousCards);
    showPoints(view, !mounted || plan.stagger);
    playEvents(view);
    mounted = root.isConnected;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || (selection.size === 0 && !choosingMeld && !lixoOpen)) return;
    if (document.querySelector('.rules-modal')) return;
    if (lixoOpen) lixoOpen = false;
    else selection.clear();
    choosingMeld = false;
    sound.play('deselect');
    render(false);
  }

  document.addEventListener('keydown', onKey);
  const observer = new ResizeObserver(() => {
    fitHand();
    fitMelds();
  });
  observer.observe(root);
  controller.subscribe(render);
  controller.onError?.((message) => notify(message));
  render();

  return {
    root,
    mounted(fresh = true) {
      mounted = true;
      lastHandNumber = fresh ? 0 : controller.view().handNumber;
      lastLogKey = fresh ? '' : String(controller.view().actions);
      lastActions = controller.view().actions;
      render();
    },
    dispose() {
      disposed = true;
      stopAnimations();
      endDrag();
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
      if (toastTimer) clearTimeout(toastTimer);
      controller.dispose();
    },
  };
}
