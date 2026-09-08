import { describe, expect, test } from 'bun:test';
import { createApplicationMenuRegistry, type ApplicationMenuItem } from '../src/application';

const item = (id: string, group: string, groupOrder: number, order = 10): ApplicationMenuItem => ({
  id, menu: 'edit', group, groupOrder, order, label: id,
});

describe('application menu contributions', () => {
  test('rejects conflicting section ranks before replacing or notifying', () => {
    const menus = createApplicationMenuRegistry();
    let changes = 0;
    menus.subscribe(() => changes++);
    menus.register(item('undo', 'history', 10));
    menus.register(item('redo', 'history', 10, 20));
    const before = menus.snapshot('edit');
    expect(() => menus.register(item('undo', 'history', 30))).toThrow('section rank');
    expect(() => menus.register(item('third', 'history', 30))).toThrow('section rank');
    expect(menus.snapshot('edit')).toBe(before);
    expect(changes).toBe(2);
    // Section identity includes its menu; ranks need not match across menus.
    expect(() => menus.register({ ...item('other', 'history', 30), menu: 'other' })).not.toThrow();
  });

  test('rejects non-finite ordering values before changing the registry', () => {
    const menus = createApplicationMenuRegistry();
    expect(() => menus.register(item('bad', 'history', NaN))).toThrow('finite');
    expect(() => menus.register(item('bad', 'history', 10, Infinity))).toThrow('finite');
    expect(menus.snapshot()).toEqual([]);
  });

  test('orders groups independently of extension load order, retaining stable item ties', () => {
    const menus = createApplicationMenuRegistry();
    menus.register(item('cut', 'clipboard', 20));
    menus.register(item('copy', 'clipboard', 20));
    menus.register(item('undo', 'history', 10));
    menus.register(item('redo', 'history', 10, 20));
    expect(menus.snapshot('edit').map(row => row.id)).toEqual(['undo', 'redo', 'cut', 'copy']);
    expect(menus.snapshot('absent')).toEqual([]);
  });

  test('replacement cleanup cannot remove its successor, including identical input objects', () => {
    const menus = createApplicationMenuRegistry();
    const same = item('undo', 'history', 10);
    const old = menus.register(same);
    const current = menus.register(same);
    old();
    expect(menus.snapshot('edit')).toHaveLength(1);
    current(); current();
    expect(menus.snapshot('edit')).toEqual([]);
  });

  test('equal section ranks keep each section contiguous with stable section ties', () => {
    const menus = createApplicationMenuRegistry();
    menus.register(item('first-late', 'first', 10, 20));
    menus.register(item('second-early', 'second', 10, 1));
    menus.register(item('first-early', 'first', 10, 10));
    expect(menus.snapshot('edit').map(row => row.id))
      .toEqual(['first-early', 'first-late', 'second-early']);
  });

  test('keeps localized labels and dynamic children live without eagerly evaluating them', () => {
    const menus = createApplicationMenuRegistry();
    let label = 'Undo';
    let reads = 0;
    menus.register({ ...item('undo', 'history', 10),
      get label() { return label; },
      dynamicChildren: () => { reads++; return [item('child', 'history', 10)]; },
    });
    const row = menus.snapshot('edit')[0]!;
    expect(reads).toBe(0);
    label = 'Undo changed';
    expect(row.label).toBe(label);
    expect(row.dynamicChildren?.()).toHaveLength(1);
    expect(reads).toBe(1);
    expect(row.commandId).toBeUndefined();
  });

  test('publishes stable snapshots and isolates subscribers through idempotent disposal', () => {
    const menus = createApplicationMenuRegistry();
    let changes = 0;
    menus.subscribe(() => { throw new Error('subscriber'); });
    const unsubscribe = menus.subscribe(() => changes++);
    const remove = menus.register(item('undo', 'history', 10));
    expect(changes).toBe(1);
    expect(menus.snapshot('edit')).toBe(menus.snapshot('edit'));
    menus.dispose(); menus.dispose(); remove();
    expect(changes).toBe(2);
    expect(menus.snapshot('edit')).toEqual([]);
    menus.register(item('late', 'history', 10));
    expect(menus.snapshot('edit')).toEqual([]);
    unsubscribe();
  });
});
