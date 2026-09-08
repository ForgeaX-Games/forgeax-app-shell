import { describe, expect, it } from 'bun:test';
import * as shell from '../src/react';

type SourceListener = (event: MessageEvent) => void;

interface TestEventSource {
  addEventListener(type: 'event', listener: SourceListener): void;
  close(): void;
}

type InstallEventSourceObservation = (options: {
  readonly url: string;
  readonly onEvent: (event: MessageEvent) => void;
  readonly createEventSource?: (url: string) => TestEventSource;
}) => () => void;

const readInstaller = (): InstallEventSourceObservation => {
  const installer = (shell as unknown as {
    installEventSourceObservation?: InstallEventSourceObservation;
  }).installEventSourceObservation;
  if (!installer) throw new Error('missing public EventSource observation lifecycle');
  return installer;
};

class SourceHost implements TestEventSource {
  listener?: SourceListener;
  registrations: string[] = [];
  closeCalls = 0;

  addEventListener(type: 'event', listener: SourceListener): void {
    this.registrations.push(type);
    this.listener = listener;
  }

  close(): void {
    this.closeCalls++;
  }

  emit(event: MessageEvent): void {
    this.listener?.(event);
  }
}

describe('EventSource observation lifecycle', () => {
  it('is available from the public React entry', () => {
    expect(typeof (shell as Record<string, unknown>).installEventSourceObservation).toBe('function');
  });

  it('constructs the exact URL, forwards event messages, and closes idempotently', () => {
    const source = new SourceHost();
    const urls: string[] = [];
    const received: MessageEvent[] = [];
    const dispose = readInstaller()({
      url: '/api/events/stream?topic=plugin.reloaded',
      createEventSource: (url) => {
        urls.push(url);
        return source;
      },
      onEvent: (event) => { received.push(event); },
    });
    const event = new MessageEvent('event', { data: '{"topic":"plugin.reloaded"}' });

    source.emit(event);
    expect(urls).toEqual(['/api/events/stream?topic=plugin.reloaded']);
    expect(source.registrations).toEqual(['event']);
    expect(received).toEqual([event]);

    dispose();
    dispose();
    source.emit(event);
    expect(source.closeCalls).toBe(1);
    expect(received).toEqual([event]);
  });

  it('isolates callback and close failures while fencing a retained listener', () => {
    let retained: SourceListener | undefined;
    let calls = 0;
    const dispose = readInstaller()({
      url: '/events',
      createEventSource: () => ({
        addEventListener(_type, listener): void { retained = listener; },
        close(): void { throw new Error('close failed'); },
      }),
      onEvent: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.(new MessageEvent('event'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(new MessageEvent('event'))).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back register-then-throw and isolates construction failure', () => {
    let retained: SourceListener | undefined;
    let closeCalls = 0;
    let calls = 0;
    const disposeRegistered = readInstaller()({
      url: '/events',
      createEventSource: () => ({
        addEventListener(_type, listener): void {
          retained = listener;
          throw new Error('registered then failed');
        },
        close(): void { closeCalls++; },
      }),
      onEvent: () => { calls++; },
    });

    retained?.(new MessageEvent('event'));
    disposeRegistered();
    expect(closeCalls).toBe(1);
    expect(calls).toBe(0);

    let disposeConstruction!: () => void;
    expect(() => {
      disposeConstruction = readInstaller()({
        url: '/events',
        createEventSource: () => { throw new Error('construction failed'); },
        onEvent: () => { calls++; },
      });
    }).not.toThrow();
    expect(() => disposeConstruction()).not.toThrow();
    expect(calls).toBe(0);
  });
});
