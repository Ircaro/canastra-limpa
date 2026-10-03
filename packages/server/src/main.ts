import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { MESSAGE_MAX_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, parseClientMessage } from '@canastra/shared';
import { Room, type Socket } from './room';
import { serveStatic } from './static';

const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_ROOMS = 100;
const MAX_CONNECTIONS = 400;
const MESSAGES_PER_SECOND = 40;
const JOIN_FAILURE_WINDOW_MS = 60_000;
const MAX_JOIN_FAILURES = 12;
const root = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) + path.sep : fileURLToPath(new URL('../../client/dist/', import.meta.url));

if (!existsSync(path.join(root, 'index.html'))) {
  console.error('Não encontrei o build do jogo. Rode "npm run build" antes de iniciar o servidor.');
  process.exit(1);
}

const rooms = new Map<string, Room>();
const joinFailures = new Map<string, number[]>();

function header(request: http.IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientKey(request: http.IncomingMessage): string {
  const remote = request.socket.remoteAddress;
  if (TRUST_PROXY) {
    const behindProxy = header(request, 'x-forwarded-for')?.split(',')[0]?.trim();
    if (behindProxy) return behindProxy;
  }
  const viaTunnel = header(request, 'cf-connecting-ip');
  if (viaTunnel && isLoopback(remote)) return viaTunnel;
  return remote ?? 'desconhecido';
}

function recentFailures(key: string, time: number): number[] {
  const recent = (joinFailures.get(key) ?? []).filter((at) => time - at < JOIN_FAILURE_WINDOW_MS);
  if (recent.length > 0) joinFailures.set(key, recent);
  else joinFailures.delete(key);
  return recent;
}

function createRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Sem códigos de sala disponíveis');
}

function wrap(socket: WebSocket): Socket {
  return {
    get open() {
      return socket.readyState === socket.OPEN;
    },
    send: (data) => socket.send(data),
    close: () => socket.close(1000, 'replaced'),
  };
}

function reject(socket: WebSocket, code: string, message: string): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'error', code, message }));
  socket.close(1008, code);
}

const PRESENCE_WINDOW_MS = 150_000;
const PRESENCE_MAX = 5000;
const presence = new Map<string, number>();

function isInternal(request: http.IncomingMessage): boolean {
  return isLoopback(request.socket.remoteAddress) && !request.headers['cf-connecting-ip'] && !request.headers['x-forwarded-for'];
}

function onlineNow(): number {
  const time = Date.now();
  for (const [key, at] of presence) if (time - at > PRESENCE_WINDOW_MS) presence.delete(key);
  return presence.size;
}

function readPresence(request: http.IncomingMessage, response: http.ServerResponse, leaving: boolean): void {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
    if (body.length > 100) request.destroy();
  });
  request.on('end', () => {
    const id = body.trim();
    if (/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      if (leaving) presence.delete(id);
      else if (presence.has(id) || presence.size < PRESENCE_MAX) presence.set(id, Date.now());
    }
    response.writeHead(204, { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    response.end();
  });
}

const server = http.createServer((request, response) => {
  const pathname = (request.url ?? '/').split('?')[0];
  if (request.method === 'POST' && (pathname === '/api/presenca' || pathname === '/api/presenca/sair')) {
    readPresence(request, response, pathname.endsWith('/sair'));
    return;
  }
  if (pathname === '/api/online') {
    if (!isInternal(request)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const players = [...rooms.values()].reduce((sum, room) => sum + room.humans(), 0);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ conectados: sockets.clients.size, salas: rooms.size, jogadores: players, online: onlineNow() }));
    return;
  }
  void serveStatic(root, request, response);
});
const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: MESSAGE_MAX_BYTES });

sockets.on('connection', (socket, request) => {
  const key = clientKey(request);
  if (sockets.clients.size > MAX_CONNECTIONS) {
    reject(socket, 'server-full', 'O servidor está cheio. Tente de novo em instantes.');
    return;
  }
  const peer = wrap(socket);
  let room: Room | null = null;
  let windowStart = performance.now();
  let received = 0;

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const time = performance.now();
    if (time - windowStart >= 1000) {
      windowStart = time;
      received = 0;
    }
    if (++received > MESSAGES_PER_SECOND) return;
    const message = parseClientMessage(data.toString());
    if (!message) return;
    if (room) {
      room.handle(peer, message);
      return;
    }
    if (message.type === 'create') {
      if (rooms.size >= MAX_ROOMS) {
        reject(socket, 'server-full', 'O servidor está cheio. Tente de novo em instantes.');
        return;
      }
      const created = new Room(createRoomCode(), message.seats, message.rules, (empty) => rooms.delete(empty.code));
      rooms.set(created.code, created);
      const joined = created.join(peer, message.name);
      if ('error' in joined) return;
      room = created;
      socket.send(JSON.stringify({ type: 'joined', room: created.code, seat: joined.seat, token: joined.token }));
      return;
    }
    if (message.type === 'join') {
      const failures = recentFailures(key, time);
      if (failures.length >= MAX_JOIN_FAILURES) {
        reject(socket, 'too-many-attempts', 'Muitas tentativas de entrar em salas. Espere um minuto e tente de novo.');
        return;
      }
      const target = rooms.get(message.room);
      if (!target) {
        joinFailures.set(key, [...failures, time]);
        reject(socket, 'room-not-found', 'Essa sala não existe ou já foi fechada.');
        return;
      }
      const joined = target.join(peer, message.name, message.token);
      if ('error' in joined) {
        reject(socket, joined.code, joined.error);
        return;
      }
      room = target;
      socket.send(JSON.stringify({ type: 'joined', room: target.code, seat: joined.seat, token: joined.token }));
    }
  });

  socket.on('close', () => room?.detach(peer));
  socket.on('error', () => socket.terminate());
});

const ticker = setInterval(() => {
  for (const room of rooms.values()) room.tick();
}, 1000);

function shutdown(): void {
  clearInterval(ticker);
  for (const room of rooms.values()) room.stop();
  sockets.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Canastra Limpa rodando em http://localhost:${PORT}`);
});
