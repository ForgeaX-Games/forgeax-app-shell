import { afterEach, expect, test } from 'bun:test';
import {
  createApplicationShortcutRegistry,
  installApplicationKeyboardRouter,
  registerApplicationKeydownHandler,
  type ApplicationShortcut,
} from '../src/application';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const listeners = new Set<(e: KeyboardEvent) => void>();
  const captures: boolean[] = [];
  const target = {
    addEventListener(_type: 'keydown', callback: (e: KeyboardEvent) => void, capture?: boolean) {
      captures.push(capture === true); listeners.add(callback);
    },
    removeEventListener(_type: 'keydown', callback: (e: KeyboardEvent) => void) { listeners.delete(callback); },
  };
  const trace: string[] = [];
  const contributions = createApplicationShortcutRegistry();
  cleanups.push(() => contributions.dispose());
  function shortcut(id: string, extras: Partial<ApplicationShortcut> = {}): ApplicationShortcut {
    return { combo: id, label: id, group: 'general', match: () => true,
      run: () => { trace.push(id); }, ...extras };
  }
  function event(extras: Partial<KeyboardEvent> = {}) {
    return { key: 'Escape', preventDefault() { trace.push('prevent'); },
      stopPropagation() { trace.push('stop'); }, ...extras } as KeyboardEvent;
  }
  return { target, listeners, captures, trace, contributions, shortcut, event,
    emit(e: KeyboardEvent) { for (const callback of [...listeners]) callback(e); } };
}

test('IME blocks transient owners and contextual/fallback routes', () => {
  const f = fixture();
  cleanups.push(registerApplicationKeydownHandler(() => { f.trace.push('transient'); return true; }));
  cleanups.push(installApplicationKeyboardRouter({ target: f.target, contributions: f.contributions,
    keybindings: { handle() { f.trace.push('context'); return { status: 'unclaimed' }; } }, shortcuts: [f.shortcut('fallback')],
    isTypingTarget: () => false, shouldSkipShortcut: () => false }));
  for (const props of [{ isComposing: true }, { keyCode: 229 }, { key: 'Process' }]) f.emit(f.event(props));
  expect(f.trace).toEqual([]);
  f.emit(f.event());
  expect(f.trace).toEqual(['transient', 'prevent', 'stop']);
  expect(f.captures).toEqual([true]);
});

test('contextual handled and disabled claims retain priority over fallback', () => {
  for (const status of ['handled', 'claimed-disabled'] as const) {
    const f = fixture();
    const dispose = installApplicationKeyboardRouter({ target: f.target, contributions: f.contributions,
      keybindings: { handle() { f.trace.push(status); return { status, binding: { commandId: 'context', keys: 'Escape', scope: 'application', registrationOrder: 0 } };  } },
      shortcuts: [f.shortcut('fallback')], isTypingTarget: () => false, shouldSkipShortcut: () => false });
    f.emit(f.event()); expect(f.trace).toEqual([status]); dispose();
  }
});

test('live contributions sort with product definitions and false ends route without preventing', () => {
  const f = fixture();
  cleanups.push(installApplicationKeyboardRouter({ target: f.target, contributions: f.contributions,
    keybindings: { handle() { return { status: 'unclaimed' }; } }, shortcuts: [f.shortcut('product', { priority: 10 })],
    isTypingTarget: () => false, shouldSkipShortcut: () => false }));
  f.emit(f.event()); expect(f.trace.splice(0)).toEqual(['product', 'prevent', 'stop']);
  const remove = f.contributions.register(f.shortcut('live', { priority: 20, run: () => { f.trace.push('yield'); return false; } }));
  f.emit(f.event()); expect(f.trace.splice(0)).toEqual(['yield']);
  remove(); f.emit(f.event()); expect(f.trace).toEqual(['product', 'prevent', 'stop']);
});

test('input and product surface policies are live and run before matching', () => {
  const f = fixture(); let typing = true; let owned = true;
  cleanups.push(installApplicationKeyboardRouter({ target: f.target, contributions: f.contributions,
    keybindings: { handle() { return { status: 'unclaimed' }; } }, shortcuts: [f.shortcut('edit', { group: 'edit', allowInInput: true }), f.shortcut('regular')],
    isTypingTarget: () => typing, shouldSkipShortcut: (_event, shortcut) => shortcut.group === 'edit' && owned }));
  f.emit(f.event()); expect(f.trace).toEqual([]);
  typing = false; f.emit(f.event()); expect(f.trace.splice(0)).toEqual(['regular', 'prevent', 'stop']);
  owned = false; f.emit(f.event()); expect(f.trace).toEqual(['edit', 'prevent', 'stop']);
});

test('equal priority keeps product then registration order and teardown fences retained listeners', () => {
  const f = fixture();
  f.contributions.register(f.shortcut('contribution'));
  const dispose = installApplicationKeyboardRouter({ target: f.target, contributions: f.contributions,
    keybindings: { handle() { return { status: 'unclaimed' }; } }, shortcuts: [f.shortcut('product')],
    isTypingTarget: () => false, shouldSkipShortcut: () => false });
  const retained = [...f.listeners][0]!;
  f.emit(f.event()); expect(f.trace.splice(0)).toEqual(['product', 'prevent', 'stop']);
  dispose(); dispose(); retained(f.event());
  expect(f.listeners.size).toBe(0); expect(f.trace).toEqual([]);
});
