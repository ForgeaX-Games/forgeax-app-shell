import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as application from '../src/application';
import {
  UI_ACTION_DISPATCH_EVENT,
  __resetRegistryForTest,
  buildManifest,
  dispatchAction,
  getAction,
  onRegistryChange,
  registerAction,
  registerStateSlice,
  snapshotActions,
  snapshotState,
  type JsonSchemaObject,
  type StateSliceSelector,
  type UiActionDef,
  type UiActionResult,
  type UiActionSummary,
  type UiCapability,
} from '../src/application';

function action(id: string, patch: Partial<UiActionDef> = {}): UiActionDef {
  return { id, title: id, capability: 'read', run: () => {}, ...patch };
}

let restoreConsole: () => void;
let windowDescriptor: PropertyDescriptor | undefined;
let eventDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  __resetRegistryForTest();
  windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const mocks = [
    spyOn(console, 'info').mockImplementation(() => {}),
    spyOn(console, 'warn').mockImplementation(() => {}),
    spyOn(console, 'error').mockImplementation(() => {}),
  ];
  restoreConsole = () => { for (const mock of mocks) mock.mockRestore(); };
});

afterEach(() => {
  __resetRegistryForTest();
  restoreConsole();
  for (const [name, descriptor] of [['window', windowDescriptor], ['CustomEvent', eventDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function installWindow(dispatchEvent: (event: CustomEvent) => boolean): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { dispatchEvent },
  });
}

describe('application action registry public contract', () => {
  test('exports the complete shared mechanism through the application entry', () => {
    for (const name of [
      'registerAction',
      'dispatchAction',
      'registerStateSlice',
      'onRegistryChange',
      'getAction',
      'snapshotActions',
      'snapshotState',
      'buildManifest',
      '__resetRegistryForTest',
    ]) {
      expect(typeof (application as Record<string, unknown>)[name]).toBe('function');
    }
    expect((application as Record<string, unknown>).UI_ACTION_DISPATCH_EVENT)
      .toBe('forgeax:ui-action-dispatch');
  });

  test('shares the implementation module instead of constructing an entry-local registry', async () => {
    const owner = await import('../src/action-registry');
    expect(application.registerAction).toBe(owner.registerAction);
    expect(application.dispatchAction).toBe(owner.dispatchAction);
    const def = action('identity');
    registerAction(def);
    expect(owner.getAction(def.id)).toBe(def);
    expect(owner.snapshotActions()).toEqual(snapshotActions());
  });

  test('last writer wins and stale or repeated action disposal does not remove a replacement', async () => {
    const first = action('replace');
    const second = action('replace', { run: () => ({ status: 'completed', stateDigest: 2 }) });
    const disposeFirst = registerAction(first);
    const disposeSecond = registerAction(second);
    disposeFirst();
    disposeFirst();
    expect(getAction('replace')).toBe(second);
    expect(await dispatchAction('replace')).toEqual({ status: 'completed', stateDigest: 2 });
    disposeSecond();
    disposeSecond();
    expect(getAction('replace')).toBeUndefined();
    expect(await dispatchAction('replace')).toEqual({
      status: 'rejected', reason: 'unknown action "replace" (not in the registry)',
    });
  });

  test('notifies synchronously for registration/removal, isolates listeners and balances unsubscription', () => {
    const observed: Array<string | undefined> = [];
    const stopThrowing = onRegistryChange(() => { throw new Error('subscriber'); });
    const stop = onRegistryChange(() => { observed.push(getAction('notify')?.title); });
    expect(observed).toEqual([]);
    const disposeFirst = registerAction(action('notify', { title: 'first' }));
    expect(observed).toEqual(['first']);
    const disposeSecond = registerAction(action('notify', { title: 'second' }));
    disposeFirst();
    expect(observed).toEqual(['first', 'second']);
    disposeSecond();
    disposeSecond();
    expect(observed).toEqual(['first', 'second', undefined]);
    stop();
    stop();
    stopThrowing();
    registerAction(action('notify'));
    expect(observed).toHaveLength(3);
  });

  test('invokes synchronously with original args, then preserves async accepted/completed/rejected results', async () => {
    const args = { value: 2 };
    const accepted: UiActionResult = { status: 'accepted', stateDigest: { job: 'j1' } };
    let seen: Record<string, unknown> | undefined;
    let resolveRun!: (result: UiActionResult) => void;
    registerAction(action('async', { run: (input) => {
      seen = input;
      return new Promise<UiActionResult>((resolve) => { resolveRun = resolve; });
    } }));
    const pending = dispatchAction('async', args);
    expect(seen).toBe(args);
    resolveRun(accepted);
    expect(await pending).toBe(accepted);
    for (const result of [
      { status: 'completed', stateDigest: 0 },
      { status: 'rejected', reason: 'handler policy' },
    ] satisfies UiActionResult[]) {
      registerAction(action('async', { run: async () => result }));
      expect(await dispatchAction('async')).toBe(result);
    }
    registerAction(action('async'));
    expect(await dispatchAction('async')).toEqual({ status: 'completed' });
  });

  test('rejects unknown, unavailable and failing availability before event delivery or handler invocation', async () => {
    let runs = 0;
    let events = 0;
    installWindow(() => { events++; return true; });
    expect(await dispatchAction('absent')).toEqual({
      status: 'rejected', reason: 'unknown action "absent" (not in the registry)',
    });
    for (const [available, reason] of [
      [() => 'not now', 'not now'],
      [() => { throw new Error('offline'); }, 'availability check threw: offline'],
      [() => { throw 'plain failure'; }, 'availability check threw: plain failure'],
    ] as const) {
      registerAction(action('blocked', { available, run: () => { runs++; } }));
      expect(await dispatchAction('blocked')).toEqual({ status: 'rejected', reason });
    }
    expect(runs).toBe(0);
    expect(events).toBe(0);
  });

  test('converts synchronous and asynchronous handler failures into structured rejection', async () => {
    for (const [run, message] of [
      [() => { throw new Error('sync'); }, 'sync'],
      [async () => { throw new Error('async'); }, 'async'],
      [() => { throw 'plain failure'; }, 'plain failure'],
    ] as const) {
      registerAction(action('failure', { run }));
      expect(await dispatchAction('failure')).toEqual({
        status: 'rejected', reason: `action "failure" threw: ${message}`,
      });
    }
  });

  test('validates required args while ignoring malformed required entries', async () => {
    let runs = 0;
    let events = 0;
    installWindow(() => { events++; return true; });
    registerAction(action('required', {
      schema: { required: ['name', 3] }, run: () => { runs++; },
    }));
    expect(await dispatchAction('required')).toEqual({
      status: 'rejected', reason: 'missing required arg "name"',
    });
    expect(runs).toBe(0);
    expect(events).toBe(0);
    expect(await dispatchAction('required', { name: undefined })).toEqual({ status: 'completed' });
    expect(runs).toBe(1);
  });

  for (const [type, valid, invalid, actual] of [
    ['string', 'value', 2, 'number'],
    ['number', 2.5, '2', 'string'],
    ['integer', 2, 2.5, 'number'],
    ['boolean', false, 0, 'number'],
    ['object', {}, [], 'array'],
    ['object', {}, null, 'null'],
    ['array', [], {}, 'object'],
  ] as const) {
    test(`validates ${type} and rejects ${actual} without dropping extra args`, async () => {
      const seen: unknown[] = [];
      const schema: JsonSchemaObject = { properties: { value: { type } } };
      registerAction(action('typed', { schema, run: (args) => { seen.push(args); } }));
      const args = { value: valid, extra: { opaque: true } };
      expect(await dispatchAction('typed', args)).toEqual({ status: 'completed' });
      expect(seen).toEqual([args]);
      expect(seen[0]).toBe(args);
      expect(await dispatchAction('typed', { value: invalid })).toEqual({
        status: 'rejected', reason: `arg "value" should be ${type}, got ${actual}`,
      });
      expect(seen).toHaveLength(1);
    });
  }

  test('checks enums and retains existing shallow-schema behavior', async () => {
    registerAction(action('enum', { schema: { properties: { mode: { enum: ['a', 'b'] } } } }));
    expect(await dispatchAction('enum', { mode: 'a' })).toEqual({ status: 'completed' });
    expect(await dispatchAction('enum', { mode: 'c' })).toEqual({
      status: 'rejected', reason: 'arg "mode" must be one of ["a","b"]',
    });
    registerAction(action('enum', { schema: { required: 'ignored', properties: false } }));
    expect(await dispatchAction('enum', { opaque: null })).toEqual({ status: 'completed' });
  });

  test('emits exact human/AI source and args before executing the handler', async () => {
    const events: CustomEvent[] = [];
    const order: string[] = [];
    installWindow((event) => { events.push(event); order.push('event'); return true; });
    registerAction(action('event', { run: () => { order.push('run'); } }));
    const args = { nested: { id: 3 } };
    const first = dispatchAction('event', args);
    expect(order).toEqual(['event', 'run']);
    expect(events[0].type).toBe(UI_ACTION_DISPATCH_EVENT);
    expect(events[0].detail).toEqual({ id: 'event', source: 'human', args });
    expect(events[0].detail.args).toBe(args);
    await first;
    await dispatchAction('event', args, { source: 'ai' });
    expect(events[1].detail).toEqual({ id: 'event', source: 'ai', args });
    expect(order).toEqual(['event', 'run', 'event', 'run']);
  });

  test('continues dispatch without window or when event construction/delivery fails', async () => {
    let runs = 0;
    registerAction(action('domless', { run: () => { runs++; } }));
    Reflect.deleteProperty(globalThis, 'window');
    expect(await dispatchAction('domless')).toEqual({ status: 'completed' });
    installWindow(() => { throw new Error('delivery'); });
    expect(await dispatchAction('domless')).toEqual({ status: 'completed' });
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true, value: class { constructor() { throw new Error('construction'); } },
    });
    expect(await dispatchAction('domless')).toEqual({ status: 'completed' });
    expect(runs).toBe(3);
  });

  test('derives live availability and expands schema detail only for selected ids', () => {
    let available: true | string = true;
    const schema = { type: 'object', properties: { n: { type: 'integer' } } };
    registerAction(action('first', { description: 'First action', schema, available: () => available }));
    registerAction(action('second'));
    const summary: UiActionSummary[] = snapshotActions();
    expect(summary).toEqual([
      { id: 'first', title: 'first', available: true },
      { id: 'second', title: 'second', available: true },
    ]);
    available = 'hidden';
    expect(snapshotActions('schema', ['first'])).toEqual([
      { id: 'first', title: 'first', available: false, reason: 'hidden', description: 'First action', inputSchema: schema },
      { id: 'second', title: 'second', available: true },
    ]);
    expect(snapshotActions('schema')).toEqual(snapshotActions());
    expect(snapshotActions('schema', ['second'])[1].inputSchema).toEqual({ type: 'object', properties: {} });
    registerAction(action('third', { available: () => { throw new Error('probe'); } }));
    expect(snapshotActions()[2]).toEqual({
      id: 'third', title: 'third', available: false, reason: 'availability check threw: probe',
    });
  });

  test('serializes complete declared manifest metadata without executing callbacks', () => {
    let calls = 0;
    const callback = () => { calls++; return true as const; };
    const schema = { type: 'object', properties: { id: { type: 'string' } } };
    const capability: UiCapability = 'credential';
    registerAction(action('manifest', {
      description: 'Declared action', schema, capability, surface: 'both', timeoutMs: 8000, firstClass: true,
      available: callback, run: () => { calls++; }, choices: { id: () => { calls++; return ['x']; } },
    }));
    registerAction(action('defaults', { timeoutMs: 0, firstClass: false }));
    const manifest = buildManifest();
    expect(manifest).toEqual([
      { id: 'manifest', title: 'manifest', description: 'Declared action', inputSchema: schema,
        capability, surface: 'both', timeoutMs: 8000, firstClass: true },
      { id: 'defaults', title: 'defaults', inputSchema: { type: 'object', properties: {} }, capability: 'read' },
    ]);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(calls).toBe(0);
  });

  test('derives state live, isolates selector failures and fences replacement disposers', () => {
    const changes: number[] = [];
    onRegistryChange(() => { changes.push(1); });
    let value = 1;
    const first: StateSliceSelector = () => value;
    const disposeFirst = registerStateSlice('state', first);
    expect(snapshotState()).toEqual({ state: 1 });
    value = 2;
    expect(snapshotState()).toEqual({ state: 2 });
    const disposeSecond = registerStateSlice('state', () => ({ value }));
    disposeFirst();
    expect(changes).toHaveLength(2);
    registerStateSlice('failure', () => { throw new Error('selector'); });
    registerStateSlice('plain', () => { throw 'plain selector'; });
    expect(snapshotState()).toEqual({
      state: { value: 2 }, failure: { error: 'state slice threw: selector' },
      plain: { error: 'state slice threw: plain selector' },
    });
    disposeSecond();
    disposeSecond();
    expect(snapshotState()).not.toHaveProperty('state');
    expect(changes).toHaveLength(5);
  });

  test('test reset clears registrations and listeners without emitting changes', () => {
    let changes = 0;
    registerAction(action('reset'));
    registerStateSlice('state', () => 1);
    onRegistryChange(() => { changes++; });
    __resetRegistryForTest();
    expect(getAction('reset')).toBeUndefined();
    expect(snapshotActions()).toEqual([]);
    expect(snapshotState()).toEqual({});
    expect(buildManifest()).toEqual([]);
    registerAction(action('next'));
    expect(changes).toBe(0);
  });
});
