import { describe, expect, it } from 'bun:test';
import { installPanelMembershipObservation } from '../src/panel-membership-observation';

describe('panel membership observation', () => {
  it('registers add before remove, forwards original events, and disposes in reverse', () => {
    const trace: string[] = [];
    let emitAdd: ((event: { id: string }) => void) | undefined;
    let emitRemove: ((event: { id: string }) => void) | undefined;
    const received: Array<{ kind: 'add' | 'remove'; event: { id: string } }> = [];
    const dispose = installPanelMembershipObservation<{ id: string }, { id: string }>({
      subscribeAdd: (listener) => {
        trace.push('subscribe:add');
        emitAdd = listener;
        return { dispose: () => { trace.push('dispose:add'); } };
      },
      subscribeRemove: (listener) => {
        trace.push('subscribe:remove');
        emitRemove = listener;
        return { dispose: () => { trace.push('dispose:remove'); } };
      },
      onAdd: (event) => { received.push({ kind: 'add', event }); },
      onRemove: (event) => { received.push({ kind: 'remove', event }); },
    });
    const added = { id: 'added' };
    const removed = { id: 'removed' };

    emitAdd?.(added);
    emitRemove?.(removed);
    dispose();
    dispose();
    emitAdd?.({ id: 'stale-add' });
    emitRemove?.({ id: 'stale-remove' });

    expect(received).toEqual([
      { kind: 'add', event: added },
      { kind: 'remove', event: removed },
    ]);
    expect(trace).toEqual([
      'subscribe:add',
      'subscribe:remove',
      'dispose:remove',
      'dispose:add',
    ]);
  });

  it('isolates callback and cleanup failures while fencing retained listeners', () => {
    let emitAdd: ((event: string) => void) | undefined;
    let emitRemove: ((event: number) => void) | undefined;
    const calls: string[] = [];
    const dispose = installPanelMembershipObservation<string, number>({
      subscribeAdd: (listener) => {
        emitAdd = listener;
        return { dispose: () => { throw new Error('add cleanup failed'); } };
      },
      subscribeRemove: (listener) => {
        emitRemove = listener;
        return { dispose: () => { throw new Error('remove cleanup failed'); } };
      },
      onAdd: () => {
        calls.push('add');
        throw new Error('add callback failed');
      },
      onRemove: () => {
        calls.push('remove');
        throw new Error('remove callback failed');
      },
    });

    expect(() => emitAdd?.('event')).not.toThrow();
    expect(() => emitRemove?.(1)).not.toThrow();
    expect(() => dispose()).not.toThrow();
    emitAdd?.('stale');
    emitRemove?.(2);

    expect(calls).toEqual(['add', 'remove']);
  });

  it('rolls back add when remove registers then throws and fences retained listeners', () => {
    let emitAdd: ((event: string) => void) | undefined;
    let emitRemove: ((event: string) => void) | undefined;
    const trace: string[] = [];
    let calls = 0;

    const dispose = installPanelMembershipObservation<string, string>({
      subscribeAdd: (listener) => {
        trace.push('subscribe:add');
        emitAdd = listener;
        return { dispose: () => { trace.push('dispose:add'); } };
      },
      subscribeRemove: (listener) => {
        trace.push('subscribe:remove');
        emitRemove = listener;
        throw new Error('registered then failed');
      },
      onAdd: () => { calls++; },
      onRemove: () => { calls++; },
    });

    emitAdd?.('stale-add');
    emitRemove?.('stale-remove');
    dispose();

    expect(trace).toEqual(['subscribe:add', 'subscribe:remove', 'dispose:add']);
    expect(calls).toBe(0);
  });
});
