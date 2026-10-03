import '@fontsource-variable/fredoka';
import '@fontsource/roboto-condensed/latin-500.css';
import '@fontsource/roboto-condensed/latin-700.css';
import './style.css';
import { DEFAULT_RULES, TARGETS, botAction, isRoomCode, normalizeRoomCode, sanitizeName, sanitizeRules, type ClientMessage, type RuleSet } from '@canastra/shared';
import { cardElement } from './cards';
import { button, el } from './dom';
import { LocalMatch, type TableController } from './local';
import { OnlineMatch, OnlineSession, saveName, savedName, type RoomInfo } from './online';
import { startPresence } from './presence';
import { rulesContent } from './rules-text';
import { createTable, type TableUi } from './table';

interface Config {
  seats: number;
  rules: RuleSet;
}

const CONFIG_KEY = 'canastra-limpa:config';
const app = document.getElementById('app') as HTMLElement;
let table: TableUi | null = null;
let current: TableController | null = null;
let session: OnlineSession | null = null;
let onlineMatch: OnlineMatch | null = null;
const pace = import.meta.env.DEV && new URLSearchParams(location.search).has('rapido') ? 0.03 : 1;

function loadConfig(): Config {
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<Config>;
    return { seats: stored.seats === 2 ? 2 : 4, rules: sanitizeRules(stored.rules) };
  } catch {
    return { seats: 4, rules: { ...DEFAULT_RULES } };
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    return;
  }
}

let config = loadConfig();

function show(screen: HTMLElement): void {
  table?.dispose();
  table = null;
  if (!screen.classList.contains('table')) onlineMatch = null;
  app.replaceChildren(screen);
  app.style.visibility = 'visible';
  screen.querySelector<HTMLElement>('.button.primary')?.focus({ preventScroll: true });
}

function openRules(rules: RuleSet): void {
  const close = () => backdrop.remove();
  const backdrop = el(
    'div',
    'modal-backdrop',
    el('div', 'modal rules-modal', el('div', 'modal-head', el('h2', '', 'Regras'), button('Fechar', 'button ghost small', close)), rulesContent(rules)),
  );
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  backdrop.querySelector<HTMLElement>('button')?.focus();
}

function logo(): HTMLElement {
  const fan = el(
    'div',
    'logo-fan',
    ...[
      { id: -1, rank: 1, suit: 'espadas' as const },
      { id: -2, rank: 13, suit: 'copas' as const },
      { id: -3, rank: 12, suit: 'paus' as const },
      { id: -4, rank: 11, suit: 'ouros' as const },
    ].map((card) => cardElement(card)),
  );
  return el('div', 'logo', fan, el('h1', '', 'Canastra ', el('span', '', 'Limpa')), el('p', 'tagline', 'Buraco online com os amigos ou contra bots'));
}

function homeScreen(): HTMLElement {
  return el(
    'main',
    'screen home',
    logo(),
    el(
      'div',
      'menu',
      button('Jogar contra bots', 'button primary big', () => show(setupScreen())),
      button('Modo teste', 'button secondary big', () => startMatch(true)),
      button('Jogar online', 'button secondary big', () => show(onlineScreen())),
      lastRoom() ? button(`Voltar para a sala ${lastRoom()}`, 'button secondary big', () => resumeRoom(lastRoom() as string)) : null,
      button('Regras', 'button ghost big', () => openRules(config.rules)),
    ),
  );
}

function optionGroup<T extends string | number | boolean>(label: string, options: { value: T; label: string; hint?: string }[], current: T, onChange: (value: T) => void): HTMLElement {
  const buttons = options.map((option) => {
    const element = el('button', 'segment', el('span', 'segment-label', option.label), option.hint ? el('small', '', option.hint) : null);
    element.type = 'button';
    element.setAttribute('role', 'radio');
    element.setAttribute('aria-checked', String(option.value === current));
    element.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-checked', String(other === element));
      onChange(option.value);
      saveConfig();
    });
    return element;
  });
  const row = el('div', 'segmented', ...buttons);
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  return el('div', 'option-group', el('span', 'option-label', label), row);
}

function ruleOptions(online: boolean): HTMLElement {
  return el(
    'div',
    'options-grid',
    optionGroup(
      'Jogadores',
      online
        ? [
            { value: 2, label: '1 contra 1', hint: 'você e mais uma pessoa' },
            { value: 4, label: 'Duplas', hint: 'até 4 pessoas; lugar vazio vira bot' },
          ]
        : [
            { value: 2, label: '1 contra 1', hint: 'você e um bot' },
            { value: 4, label: 'Duplas', hint: 'você e um bot parceiro contra 2 bots' },
          ],
      config.seats,
      (value) => (config.seats = value),
    ),
    optionGroup(
      'Lixo',
      [
        { value: 'aberto', label: 'Aberto', hint: 'pega o lixo quando quiser' },
        { value: 'fechado', label: 'Fechado', hint: 'só pega usando a carta de cima' },
      ],
      config.rules.lixo,
      (value) => (config.rules.lixo = value),
    ),
    optionGroup(
      'Coringas',
      [
        { value: 'dois', label: 'Só os 2', hint: '104 cartas' },
        { value: 'doisEJokers', label: '2 e jokers', hint: '108 cartas' },
      ],
      config.rules.coringas,
      (value) => (config.rules.coringas = value),
    ),
    optionGroup(
      'Duque que limpa',
      [
        { value: 'ate8', label: 'Até o 8', hint: 'só limpa se o jogo começou até o 8' },
        { value: 'sempre', label: 'Sempre', hint: 'limpa quando o duque chega ao lugar dele' },
      ],
      config.rules.duque,
      (value) => (config.rules.duque = value),
    ),
    optionGroup(
      'Mortos por dupla',
      [
        { value: 'dois', label: 'Os dois', hint: 'bateu de novo com uma limpa, pega o outro morto' },
        { value: 'um', label: 'Só um', hint: 'depois do morto, a próxima batida encerra a mão' },
      ],
      config.rules.mortos,
      (value) => (config.rules.mortos = value),
    ),
    optionGroup(
      'Até quando',
      TARGETS.map((value) => ({ value, label: value === 0 ? '1 partida' : String(value), hint: value === 0 ? 'uma mão só; vence quem fizer mais pontos' : 'pontos' })),
      config.rules.meta,
      (value) => (config.rules.meta = value),
    ),
    optionGroup(
      'Vulnerável',
      [
        { value: true, label: 'Ligado', hint: 'com 1000 pontos, abre com 75 ou mais' },
        { value: false, label: 'Desligado', hint: 'baixa livre a partida toda' },
      ],
      config.rules.vulneravel,
      (value) => (config.rules.vulneravel = value),
    ),
  );
}

function setupScreen(): HTMLElement {
  const panel = el(
    'div',
    'panel setup',
    el('h2', '', 'Nova partida'),
    el('p', 'muted', 'Escolha o formato e as regras. Os lugares vazios são ocupados por bots.'),
    ruleOptions(false),
    el(
      'div',
      'actions',
      button('Começar', 'button primary big', () => startMatch()),
      button('Ver regras', 'button ghost', () => openRules(config.rules)),
      button('Voltar', 'button secondary', () => show(homeScreen())),
    ),
  );
  return el('main', 'screen', panel);
}

function nameField(): HTMLInputElement {
  const input = el('input', 'text-input');
  input.id = 'player-name';
  input.maxLength = 16;
  input.placeholder = 'Seu nome';
  input.autocomplete = 'name';
  input.value = savedName();
  input.addEventListener('change', () => {
    const name = sanitizeName(input.value);
    input.value = name;
    saveName(name);
  });
  return input;
}

function currentName(input: HTMLInputElement): string {
  const name = sanitizeName(input.value);
  saveName(name);
  return name;
}

function onlineScreen(): HTMLElement {
  const name = nameField();
  const code = el('input', 'text-input code-input');
  code.maxLength = 6;
  code.placeholder = 'CÓDIGO';
  code.autocomplete = 'off';
  code.addEventListener('input', () => (code.value = normalizeRoomCode(code.value)));
  const error = el('p', 'form-error');
  const join = () => {
    const value = normalizeRoomCode(code.value);
    if (!isRoomCode(value)) {
      error.textContent = 'O código tem 6 letras ou números, como K7Q2XM.';
      code.focus();
      return;
    }
    startOnline({ type: 'join', room: value, name: currentName(name) });
  };
  code.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') join();
  });
  const panel = el(
    'div',
    'panel setup',
    el('h2', '', 'Jogar online'),
    el('label', 'field', el('span', 'option-label', 'Seu nome'), name),
    el('h3', 'section-title', 'Criar uma sala'),
    el('p', 'muted', 'Escolha o formato e as regras. Depois é só mandar o link para os amigos.'),
    ruleOptions(true),
    el(
      'div',
      'actions',
      button('Criar sala', 'button primary big', () =>
        startOnline({ type: 'create', name: currentName(name), seats: config.seats, rules: { ...config.rules } }),
      ),
    ),
    el('h3', 'section-title', 'Entrar numa sala'),
    el('div', 'join-row', code, button('Entrar', 'button secondary', join)),
    error,
    el('div', 'actions', button('Voltar', 'button ghost', () => show(homeScreen()))),
  );
  return el('main', 'screen', panel);
}

function joinScreen(room: string): HTMLElement {
  const name = nameField();
  const enter = () => startOnline({ type: 'join', room, name: currentName(name) });
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') enter();
  });
  const panel = el(
    'div',
    'panel',
    el('h2', '', 'Entrar na sala'),
    el('p', 'muted', `Você foi convidado para a sala ${room}. Como quer ser chamado?`),
    el('label', 'field', el('span', 'option-label', 'Seu nome'), name),
    el('div', 'actions', button('Entrar', 'button primary big', enter), button('Voltar', 'button ghost', () => leaveOnline())),
  );
  setTimeout(() => name.focus(), 0);
  return el('main', 'screen', panel);
}

function messageScreen(title: string, text: string, busy = false): HTMLElement {
  const panel = el('div', 'panel', el('h2', '', title), el('p', 'muted', text), busy ? el('div', 'spinner') : null, el('div', 'actions', button(busy ? 'Cancelar' : 'Voltar ao menu', 'button secondary', () => leaveOnline())));
  return el('main', 'screen', panel);
}

function inviteLink(room: string): string {
  return `${location.origin}${location.pathname}?sala=${room}`;
}

function rulesSummary(rules: RuleSet): string {
  return [
    rules.lixo === 'aberto' ? 'lixo aberto' : 'lixo fechado',
    rules.coringas === 'dois' ? 'só os 2 de coringa' : '2 e jokers de coringa',
    rules.duque === 'ate8' ? 'duque limpa até o 8' : 'duque sempre limpa',
    rules.mortos === 'dois' ? 'dois mortos' : 'um morto por dupla',
    rules.meta === 0 ? 'partida de uma mão' : `até ${rules.meta} pontos`,
    rules.meta === 0 ? null : rules.vulneravel ? 'vulnerável' : 'sem vulnerável',
  ]
    .filter(Boolean)
    .join(' · ');
}

function lobbyScreen(info: RoomInfo): HTMLElement {
  const current = session as OnlineSession;
  const you = info.you;
  const me = info.seats[you];
  const link = el('input', 'text-input invite-input');
  link.readOnly = true;
  link.value = inviteLink(info.room);
  const copy = button('Copiar link', 'button secondary', () => {
    link.select();
    void navigator.clipboard?.writeText(link.value).catch(() => undefined);
    copy.textContent = 'Copiado!';
    setTimeout(() => (copy.textContent = 'Copiar link'), 1500);
  });
  const teams = info.seatsCount === 4 ? ['Dupla 1', 'Dupla 2', 'Dupla 1', 'Dupla 2'] : ['Lado 1', 'Lado 2'];
  const rows = info.seats.map((seat, index) => {
    const tags = [
      index === you ? el('span', 'tag team-us', 'você') : null,
      index === info.host ? el('span', 'tag', 'dono da sala') : null,
      seat.human && !seat.connected ? el('span', 'tag', 'desconectado') : null,
      seat.human && index !== info.host ? el('span', `tag ${seat.ready ? 'ready' : ''}`, seat.ready ? 'pronto' : 'esperando') : null,
    ];
    const label = seat.human ? el('span', 'seat-name', seat.name) : el('span', 'seat-free', 'Lugar livre, vira bot');
    const sit = !seat.human ? button('Sentar aqui', 'button ghost small', () => current.send({ type: 'seat', seat: index })) : null;
    return el('li', `lobby-seat team-${index % 2}`, el('span', 'seat-team', teams[index]), label, ...tags, sit);
  });
  const name = el('input', 'text-input');
  name.id = 'lobby-name';
  name.maxLength = 16;
  name.value = me?.name ?? '';
  name.addEventListener('change', () => {
    const clean = sanitizeName(name.value);
    if (!clean) return;
    saveName(clean);
    current.send({ type: 'name', name: clean });
  });
  const others = info.seats.filter((seat, index) => seat.human && seat.connected && index !== info.host);
  const allReady = others.every((seat) => seat.ready);
  const actions = info.host === you
    ? [
        button('Começar partida', 'button primary big', () => current.send({ type: 'start' }), !allReady),
        button('Alterar regras', 'button ghost', () => openRoomConfig(info)),
      ]
    : [button(me?.ready ? 'Não estou pronto' : 'Estou pronto', `button ${me?.ready ? 'secondary' : 'primary'} big`, () => current.send({ type: 'ready', ready: !me?.ready }))];
  const note = info.host === you ? (allReady ? 'Quando quiser, comece a partida. Os lugares livres viram bots.' : 'Esperando todos marcarem que estão prontos.') : 'Marque que está pronto e aguarde quem criou a sala começar.';
  const panel = el(
    'div',
    'panel setup lobby',
    el('h2', '', `Sala ${info.room}`),
    el('p', 'muted', rulesSummary(info.rules)),
    el('div', 'join-row', link, copy),
    el('ul', 'lobby-seats', ...rows),
    el('label', 'field', el('span', 'option-label', 'Seu nome'), name),
    el('p', 'muted', note),
    el('div', 'actions', ...actions, button('Sair da sala', 'button ghost', () => leaveOnline())),
  );
  return el('main', 'screen', panel);
}

function openRoomConfig(info: RoomInfo): void {
  config = { seats: info.seatsCount, rules: { ...info.rules } };
  const close = () => backdrop.remove();
  const save = () => {
    session?.send({ type: 'config', seats: config.seats, rules: { ...config.rules } });
    close();
  };
  const backdrop = el(
    'div',
    'modal-backdrop',
    el('div', 'modal rules-modal', el('div', 'modal-head', el('h2', '', 'Regras da sala'), button('Fechar', 'button ghost small', close)), ruleOptions(true), el('div', 'actions', button('Salvar', 'button primary', save))),
  );
  document.body.append(backdrop);
}

const LAST_ROOM_KEY = 'canastra-limpa:ultima-sala';

function lastRoom(): string | null {
  try {
    const room = localStorage.getItem(LAST_ROOM_KEY);
    return room && isRoomCode(room) && localStorage.getItem(`canastra-limpa:sala:${room}`) ? room : null;
  } catch {
    return null;
  }
}

function rememberRoom(room: string | null): void {
  try {
    if (room) localStorage.setItem(LAST_ROOM_KEY, room);
    else localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    return;
  }
}

function confirmLeave(text: string, onLeave: () => void): void {
  const close = () => backdrop.remove();
  const backdrop = el(
    'div',
    'modal-backdrop',
    el(
      'div',
      'modal',
      el('h2', '', 'Sair da partida?'),
      el('p', 'muted', text),
      el(
        'div',
        'actions',
        button('Continuar jogando', 'button primary', close),
        button('Sair', 'button secondary', () => {
          close();
          onLeave();
        }),
      ),
    ),
  );
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.body.append(backdrop);
  backdrop.querySelector<HTMLElement>('.button.primary')?.focus();
}

function leaveOnline(): void {
  session?.close();
  session = null;
  onlineMatch = null;
  current = null;
  history.replaceState(null, '', location.pathname);
  show(homeScreen());
}

function resumeRoom(room: string): void {
  let token: string | null = null;
  try {
    token = localStorage.getItem(`canastra-limpa:sala:${room}`);
  } catch {
    token = null;
  }
  startOnline({ type: 'join', room, name: savedName(), ...(token ? { token } : {}) });
}

let reconnectBanner: HTMLElement | null = null;

function startOnline(first: ClientMessage): void {
  session?.close();
  onlineMatch = null;
  show(messageScreen('Conectando', 'Entrando na sala...', true));
  const created = new OnlineSession(first, {
    room(info) {
      if (created !== session) return;
      if (new URLSearchParams(location.search).get('sala') !== info.room) history.replaceState(null, '', `${location.pathname}?sala=${info.room}`);
      rememberRoom(info.room);
      if (info.status === 'lobby') {
        const focused = document.activeElement?.id === 'lobby-name';
        show(lobbyScreen(info));
        if (focused) document.getElementById('lobby-name')?.focus();
      } else if (onlineMatch) onlineMatch.changed();
    },
    state() {
      if (created !== session || !created.view) return;
      if (onlineMatch) {
        onlineMatch.changed();
        return;
      }
      const match = new OnlineMatch(created);
      onlineMatch = match;
      current = match;
      const ui = createTable(match, {
        onMenu: () =>
          confirmLeave('Você sai da sala, e um bot joga no seu lugar. Dá para voltar pelo botão "Voltar para a sala" na tela inicial enquanto a partida durar.', () => leaveOnline()),
        onRules: () => openRules(match.view().rules),
        onRestart: () => match.restart(),
      });
      show(ui.root);
      onlineMatch = match;
      table = ui;
      ui.mounted(created.view.log.length === 0);
    },
    error(message) {
      if (onlineMatch) onlineMatch.failed(message);
      else {
        const panel = app.querySelector('.panel');
        const note = el('p', 'form-error', message);
        panel?.querySelector('.form-error')?.remove();
        panel?.append(note);
      }
    },
    failure(message) {
      if (created !== session) return;
      if (/não existe|já foi fechada/.test(message)) rememberRoom(null);
      session = null;
      onlineMatch = null;
      show(messageScreen('Não deu para continuar', message));
    },
    reconnecting(active) {
      reconnectBanner?.remove();
      reconnectBanner = null;
      if (!active) return;
      reconnectBanner = el('div', 'toast', 'Reconectando à sala...');
      document.body.append(reconnectBanner);
    },
  });
  session = created;
}

function startMatch(practice = false): void {
  session?.close();
  session = null;
  const controller = new LocalMatch(config.seats, { ...config.rules }, pace, practice);
  current = controller;
  const ui = createTable(controller, {
    onMenu: () => (practice ? show(homeScreen()) : confirmLeave('A partida contra os bots vai ser encerrada.', () => show(homeScreen()))),
    onRules: () => openRules(controller.view().rules),
    onRestart: () => startMatch(practice),
  });
  show(ui.root);
  table = ui;
  ui.mounted();
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    __canastra: {
      view: () => current?.view() ?? null,
      suggest: () => {
        const view = current?.view();
        return view ? botAction(view, Math.random) : null;
      },
    },
  });
}

const invited = normalizeRoomCode(new URLSearchParams(location.search).get('sala') ?? '');
if (isRoomCode(invited)) {
  let token: string | null = null;
  try {
    token = localStorage.getItem(`canastra-limpa:sala:${invited}`);
  } catch {
    token = null;
  }
  if (token) startOnline({ type: 'join', room: invited, name: savedName(), token });
  else show(joinScreen(invited));
} else show(homeScreen());

startPresence();
