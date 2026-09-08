import { describe, expect, it } from 'bun:test';
import * as application from '../src/application';

// M151: the host owns keyboard contributions, never another DOM observer.
const createRegistry = () => application.createApplicationShortcutRegistry();
const event = { key: 'v' } as KeyboardEvent;
const shortcut = (label: string, priority = 0) => ({
  combo: label,
  label,
  group: 'caller-owned-surface',
  priority,
  match: () => true,
  run: () => true,
});

describe('application shortcut contributions', () => {
  it('exports the registry through the public application entry', () => {
    expect(typeof application.createApplicationShortcutRegistry).toBe('function');
  });

  it('reads late contributions and keeps stable priority and caller ordering', () => {
    const registry = createRegistry();
    expect(registry.snapshot()).toEqual([]);
    registry.register(shortcut('first'));
    registry.register(shortcut('second'));
    registry.register(shortcut('before', 10));
    registry.register(shortcut('after', -10));
    expect(registry.snapshot().map((item) => item.label)).toEqual([
      'before', 'first', 'second', 'after',
    ]);
  });

  it('balances individual registrations even when the same definition is reused', () => {
    const registry = createRegistry();
    const definition = shortcut('same');
    const removeA = registry.register(definition);
    const removeB = registry.register(definition);
    expect(registry.snapshot()).toHaveLength(2);
    removeA();
    removeA();
    expect(registry.snapshot()).toHaveLength(1);
    removeB();
    expect(registry.snapshot()).toEqual([]);
  });

  it('reads caller-owned labels live without changing registration identity or equal-priority order', () => {
    const registry = createRegistry();
    let locale = 'en';
    registry.register({
      ...shortcut('editor'),
      get label() { return locale === 'en' ? 'Save' : '保存'; },
    });
    registry.register(shortcut('later owner'));
    const snapshot = registry.snapshot();
    const entry = snapshot[0]!;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    for (const [next, label] of [['en', 'Save'], ['zh', '保存'], ['en', 'Save']]) {
      locale = next!;
      expect(registry.snapshot()).toBe(snapshot);
      expect(registry.snapshot()[0]).toBe(entry);
      expect(entry.label).toBe(label);
      expect(registry.snapshot().map((item) => item.combo)).toEqual(['editor', 'later owner']);
    }
    registry.dispose();
    expect(entry.match(event)).toBe(false);
    expect(entry.run(event)).toBe(false);
  });

  it('fences retained callbacks after removal without touching a replacement', () => {
    const registry = createRegistry();
    const calls: KeyboardEvent[] = [];
    const removeA = registry.register({
      ...shortcut('A'),
      run: (received: KeyboardEvent) => { calls.push(received); return true; },
    });
    const retained = registry.snapshot()[0]!;
    expect(retained.match(event)).toBe(true);
    expect(retained.run(event)).toBe(true);
    expect(calls).toEqual([event]);
    removeA();
    const removeB = registry.register(shortcut('B'));
    removeA();
    expect(retained.match(event)).toBe(false);
    expect(retained.run(event)).toBe(false);
    expect(calls).toEqual([event]);
    expect(registry.snapshot().map((item) => item.label)).toEqual(['B']);
    removeB();
  });

  it('preserves first-match false results and raw callback exceptions', () => {
    const registry = createRegistry();
    const failure = new Error('caller-owned callback failure');
    registry.register({ ...shortcut('yield'), run: () => false });
    registry.register({ ...shortcut('throw'), run: () => { throw failure; } });
    expect(registry.snapshot()[0]!.run(event)).toBe(false);
    expect(() => registry.snapshot()[1]!.run(event)).toThrow(failure);
  });

  it('closes one host without reviving callbacks or affecting a second host', () => {
    const first = createRegistry();
    const second = createRegistry();
    first.register(shortcut('first'));
    second.register(shortcut('second'));
    const retained = first.snapshot()[0]!;
    first.dispose();
    first.dispose();
    expect(retained.match(event)).toBe(false);
    expect(retained.run(event)).toBe(false);
    const removeLate = first.register(shortcut('late'));
    removeLate();
    expect(first.snapshot()).toEqual([]);
    expect(second.snapshot()).toHaveLength(1);
  });
});
