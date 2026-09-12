import { expect, test } from 'bun:test';
import * as publicApi from '../src/application';

type Owner = typeof import('../src/broadcast-stream');
let moduleId = 0;
const loadOwner = (): Promise<Owner> => import(new URL(`../src/broadcast-stream.ts?contract=${++moduleId}`, import.meta.url).href);
const stateKey = '__FORGEAX_BROADCAST_STREAM__';

// Serial tests restore descriptors even on failure; other browser tests keep
// their original realm. Each scenario loads a fresh owner against its own state.
async function isolated(run: () => Promise<void>): Promise<void> {
  const saved = ['window', 'WebSocket', stateKey].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const warn = console.warn;
  try {
    Reflect.deleteProperty(globalThis, stateKey);
    await run();
  } finally {
    console.warn = warn;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function fakeBrowser() {
  const sockets: Socket[] = [];
  const timers = new Map<number, { fn: () => void; delay: number }>();
  let nextTimer = 0, attempts = 0;
  let failConstruction = false, failClose = false;
  class Socket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: unknown }) => void;
    constructor(readonly url: string) {
      attempts++;
      if (failConstruction) throw new Error('offline');
      sockets.push(this);
    }
    close() {
      if (failClose) throw new Error('close');
      this.readyState = 3;
      this.onclose?.();
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: Socket });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {
    setTimeout(fn: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  } });
  return {
    sockets, timers,
    get attempts() { return attempts; },
    failConstruction(value: boolean) { failConstruction = value; },
    failClose(value: boolean) { failClose = value; },
    fire() {
      const [id, timer] = [...timers][0]!;
      timers.delete(id);
      timer.fn();
    },
  };
}

test('public application entry exports the broadcast owner', () => {
  for (const key of ['connectBroadcast', 'disconnectBroadcast', 'subscribeBroadcast', 'getBroadcastStatus'] as const) {
    expect(typeof publicApi[key]).toBe('function');
  }
});

test('broadcast owner preserves connection, routing and retry contracts', () => isolated(async () => {
  const browser = fakeBrowser();
  const api = await loadOwner();
  const seen: unknown[] = [];
  const unsubscribe = api.subscribeBroadcast('tick', msg => seen.push(msg));
  const wildcard = api.subscribeBroadcast('*', msg => seen.push(msg));
  expect(browser.sockets).toHaveLength(0);
  api.connectBroadcast('wss://example.test/events');
  api.connectBroadcast('wss://example.test/events');
  expect(browser.sockets).toHaveLength(1);
  const first = browser.sockets[0]!;
  first.readyState = 1;
  first.onopen!();
  expect(api.getBroadcastStatus()).toEqual({ connected: true, url: first.url });
  for (const data of ['invalid', 'null', 123]) first.onmessage!({ data });
  expect(seen).toHaveLength(0);
  first.onmessage!({ data: '{"type":"tick","value":1}' });
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);
  unsubscribe(); unsubscribe(); wildcard();
  first.close();
  expect(browser.timers.size).toBe(1);
  expect([...browser.timers.values()][0]!.delay).toBe(1000);
  browser.fire();
  expect(browser.sockets).toHaveLength(2);
  first.onmessage!({ data: '{"type":"tick"}' });
  expect(seen).toHaveLength(2);
  browser.sockets[1]!.close();
  expect([...browser.timers.values()][0]!.delay).toBe(2000);
  api.disconnectBroadcast(); api.disconnectBroadcast();
  expect(browser.timers.size).toBe(0);
  expect(api.getBroadcastStatus().connected).toBe(false);
  api.connectBroadcast('wss://example.test/next');
  expect(browser.sockets[2]!.url).toBe('wss://example.test/next');
  api.disconnectBroadcast();
}));

test('broadcast owner shares legacy state and preserves failure/backoff behavior', () => isolated(async () => {
  const legacy = { ws: null, desired: false, url: '', retryMs: 1000, retryTimer: null, handlers: new Map() };
  Object.defineProperty(globalThis, stateKey, { configurable: true, writable: true, value: legacy });
  Reflect.deleteProperty(globalThis, 'window');
  const api = await loadOwner();
  expect(Reflect.get(globalThis, stateKey)).toBe(legacy);
  api.connectBroadcast('wss://example.test');
  expect(legacy.desired).toBe(false);
  const browser = fakeBrowser();
  browser.failConstruction(true);
  api.connectBroadcast('wss://example.test');
  expect(browser.attempts).toBe(1);
  expect([...browser.timers.values()][0]!.delay).toBe(1000);
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    browser.fire();
    expect([...browser.timers.values()][0]!.delay).toBe(delay);
  }
  api.disconnectBroadcast();
  expect(browser.timers.size).toBe(0);
  browser.failConstruction(false);
  browser.failClose(true);
  console.warn = () => {};
  const seen: unknown[] = [];
  api.subscribeBroadcast('x', () => { throw new Error('handler'); });
  const listener = (frame: unknown) => { seen.push(frame); };
  const dispose = api.subscribeBroadcast('x', listener);
  api.subscribeBroadcast('x', listener);
  api.subscribeBroadcast('*', listener);
  api.connectBroadcast('wss://example.test');
  const socket = browser.sockets[0]!;
  socket.onopen!();
  expect(legacy.retryMs).toBe(1000);
  socket.onmessage!({ data: '{"type":"x"}' });
  expect(seen).toHaveLength(2);
  dispose();
  socket.onmessage!({ data: '{"type":"x"}' });
  expect(seen).toHaveLength(3);
  const again = await loadOwner();
  const stop = again.subscribeBroadcast('z', listener);
  socket.onmessage!({ data: '{"type":"z"}' });
  expect(seen).toHaveLength(5);
  stop(); socket.onerror!();
  api.disconnectBroadcast();
  expect(legacy.ws).toBeNull();
  socket.onmessage!({ data: '{"type":"z"}' });
  expect(seen).toHaveLength(5);
}));

test('realm restoration survives a failing scenario', async () => {
  const saved = ['window', 'WebSocket', stateKey].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const warn = console.warn;
  await expect(isolated(async () => {
    fakeBrowser();
    await loadOwner();
    console.warn = () => {};
    throw new Error('scenario failure');
  })).rejects.toThrow('scenario failure');
  expect(['window', 'WebSocket', stateKey].map(key => Object.getOwnPropertyDescriptor(globalThis, key))).toEqual(saved);
  expect(console.warn).toBe(warn);
});
