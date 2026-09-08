import { describe, expect, it } from 'bun:test';
import {
  installMutationObservation,
  type DomMutationObserver,
} from '../src/react';

describe('DOM mutation observation', () => {
  it('observes the exact target/options and forwards original records and observer', () => {
    const target = {} as Node;
    const observerOptions: MutationObserverInit = { childList: true, subtree: true };
    const records = [{ type: 'childList' }] as MutationRecord[];
    let retained: ((records: MutationRecord[], observer: DomMutationObserver) => void) | undefined;
    let observedTarget: Node | undefined;
    let observedOptions: MutationObserverInit | undefined;
    let disconnects = 0;
    const received: unknown[][] = [];
    const observer: DomMutationObserver = {
      observe: (nextTarget, nextOptions) => {
        observedTarget = nextTarget;
        observedOptions = nextOptions;
      },
      disconnect: () => { disconnects++; },
    };

    const dispose = installMutationObservation({
      target,
      observerOptions,
      createObserver: (listener) => {
        retained = listener;
        return observer;
      },
      onMutation: (nextRecords, nextObserver) => {
        received.push([nextRecords, nextObserver]);
      },
    });

    retained?.(records, observer);
    expect(observedTarget).toBe(target);
    expect(observedOptions).toBe(observerOptions);
    expect(received).toEqual([[records, observer]]);

    dispose();
    dispose();
    retained?.(records, observer);
    expect(disconnects).toBe(1);
    expect(received).toEqual([[records, observer]]);
  });

  it('isolates callback and disconnect failures while fencing retained callbacks', () => {
    let retained: ((records: MutationRecord[], observer: DomMutationObserver) => void) | undefined;
    const observer: DomMutationObserver = {
      observe: () => {},
      disconnect: () => { throw new Error('disconnect failed'); },
    };
    let calls = 0;
    const dispose = installMutationObservation({
      target: {} as Node,
      observerOptions: { attributes: true },
      createObserver: (listener) => {
        retained = listener;
        return observer;
      },
      onMutation: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.([], observer)).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.([], observer)).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences an observer retained by observe-then-throw', () => {
    let retained: ((records: MutationRecord[], observer: DomMutationObserver) => void) | undefined;
    let disconnects = 0;
    let calls = 0;
    const observer: DomMutationObserver = {
      observe: () => { throw new Error('observed then failed'); },
      disconnect: () => { disconnects++; },
    };

    const dispose = installMutationObservation({
      target: {} as Node,
      observerOptions: { childList: true },
      createObserver: (listener) => {
        retained = listener;
        return observer;
      },
      onMutation: () => { calls++; },
    });
    retained?.([], observer);
    dispose();

    expect(disconnects).toBe(1);
    expect(calls).toBe(0);
  });

  it('isolates observer construction failure', () => {
    expect(() => installMutationObservation({
      target: {} as Node,
      observerOptions: { childList: true },
      createObserver: () => { throw new Error('construction failed'); },
      onMutation: () => {},
    })()).not.toThrow();
  });
});
