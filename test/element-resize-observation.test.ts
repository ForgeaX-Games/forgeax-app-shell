import { describe, expect, it } from 'bun:test';
import { installElementResizeObservation } from '../src/element-resize-observation';

type TestElement = Element & { readonly id: string };

function element(id: string): TestElement {
  return { id } as TestElement;
}

describe('element resize observation', () => {
  it('observes a fixed element set without requiring a replacement subscription', () => {
    let resizeListener: (() => void) | undefined;
    const observed: string[] = [];
    let disconnects = 0;
    let notifications = 0;

    const dispose = installElementResizeObservation({
      getElements: () => [element('header'), element('measure-row')],
      createObserver: (listener) => {
        resizeListener = listener;
        return {
          observe: (target) => { observed.push((target as TestElement).id); },
          disconnect: () => { disconnects++; },
        };
      },
      onResize: () => { notifications++; },
    });

    expect(observed).toEqual(['header', 'measure-row']);
    resizeListener?.();
    expect(notifications).toBe(1);

    dispose();
    dispose();
    resizeListener?.();
    expect(disconnects).toBe(1);
    expect(notifications).toBe(1);
  });

  it('observes current elements, rebinds on source changes, and forwards resize notifications', () => {
    const first = element('first');
    const second = element('second');
    let current: readonly Element[] = [first];
    let sourceListener: (() => void) | undefined;
    let resizeListener: (() => void) | undefined;
    const observed: string[][] = [];
    let currentCycle: string[] = [];
    let disconnects = 0;
    let sourceDisposals = 0;
    const notifications: string[] = [];

    const dispose = installElementResizeObservation({
      getElements: () => current,
      subscribeElements: (listener) => {
        sourceListener = listener;
        return () => { sourceDisposals++; };
      },
      createObserver: (listener) => {
        resizeListener = listener;
        return {
          observe: (target) => { currentCycle.push((target as TestElement).id); },
          disconnect: () => {
            observed.push(currentCycle);
            currentCycle = [];
            disconnects++;
          },
        };
      },
      onResize: () => { notifications.push('resize'); },
      onElementsChanged: () => { notifications.push('elements'); },
    });

    expect(currentCycle).toEqual(['first']);
    current = [second];
    sourceListener?.();
    expect(observed).toEqual([['first']]);
    expect(currentCycle).toEqual(['second']);
    expect(notifications).toEqual(['elements']);

    resizeListener?.();
    expect(notifications).toEqual(['elements', 'resize']);

    dispose();
    dispose();
    sourceListener?.();
    resizeListener?.();
    expect(sourceDisposals).toBe(1);
    expect(disconnects).toBe(2);
    expect(notifications).toEqual(['elements', 'resize']);
  });

  it('rolls back setup and fences a listener retained by subscribe-then-throw', () => {
    let retained: (() => void) | undefined;
    let disconnects = 0;
    let changes = 0;

    const dispose = installElementResizeObservation({
      getElements: () => [element('anchor')],
      subscribeElements: (listener) => {
        retained = listener;
        throw new Error('registered then failed');
      },
      createObserver: () => ({
        observe: () => {},
        disconnect: () => { disconnects++; },
      }),
      onResize: () => {},
      onElementsChanged: () => { changes++; },
    });

    retained?.();
    dispose();
    expect(disconnects).toBe(1);
    expect(changes).toBe(0);
  });

  it('keeps a synchronously reentrant element replacement authoritative', () => {
    const initial = element('initial');
    const stale = element('stale');
    const current = element('current');
    let sourceListener: (() => void) | undefined;
    let mode: 'initial' | 'outer' | 'nested' = 'initial';
    const observed = new Set<string>();
    let changes = 0;

    const dispose = installElementResizeObservation({
      getElements: () => {
        if (mode === 'outer') {
          mode = 'nested';
          sourceListener?.();
          return [stale];
        }
        return mode === 'nested' ? [current] : [initial];
      },
      subscribeElements: (listener) => {
        sourceListener = listener;
        return () => {};
      },
      createObserver: () => ({
        observe: (target) => { observed.add((target as TestElement).id); },
        disconnect: () => { observed.clear(); },
      }),
      onResize: () => {},
      onElementsChanged: () => { changes++; },
    });

    expect([...observed]).toEqual(['initial']);
    mode = 'outer';
    sourceListener?.();
    expect([...observed]).toEqual(['current']);
    expect(changes).toBe(1);
    dispose();
  });

  it('isolates source, observer, callback, and cleanup failures', () => {
    let sourceListener: (() => void) | undefined;
    let resizeListener: (() => void) | undefined;
    let observes = 0;

    const dispose = installElementResizeObservation({
      getElements: () => [element('first'), element('second')],
      subscribeElements: (listener) => {
        sourceListener = listener;
        return () => { throw new Error('source cleanup'); };
      },
      createObserver: (listener) => {
        resizeListener = listener;
        return {
          observe: () => {
            observes++;
            if (observes % 2 === 1) throw new Error('observe');
          },
          disconnect: () => { throw new Error('disconnect'); },
        };
      },
      onResize: () => { throw new Error('resize callback'); },
      onElementsChanged: () => { throw new Error('elements callback'); },
    });

    expect(() => sourceListener?.()).not.toThrow();
    expect(() => resizeListener?.()).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => sourceListener?.()).not.toThrow();
    expect(() => resizeListener?.()).not.toThrow();
    expect(observes).toBe(4);
  });
});
