import { describe, expect, it, spyOn } from 'bun:test';
import * as application from '../src/application';

declare module '../src/application' {
  interface BusTopics {
    'test:bus:typed': { value: number };
  }
}

// This function is typechecked, not executed: callers retain topic augmentation.
function checkTopicTypes(): void {
  application.publishTopic('test:bus:typed', { value: 1 });
  // @ts-expect-error Registered topics require their declared payload.
  application.publishTopic('test:bus:typed', { value: 'wrong' });
  const value: number | undefined = application.peekTopic('test:bus:typed')?.value;
  void value;
}
void checkTopicTypes;

describe('application topic bus', () => {
  it('shares retained values and subscribers across module reevaluation', async () => {
    const topic = 'test:bus:realm';
    const got: unknown[] = [];
    application.publishTopic(topic, 1, { retain: true });
    const off = application.subscribeTopic(topic, p => got.push(p));
    const path = '../src/topic-bus.ts?realm-test';
    const reloaded = await import(path) as typeof import('../src/topic-bus');
    expect(reloaded.peekTopic(topic)).toBe(1);
    reloaded.publishTopic(topic, 2, { retain: true });
    expect(got).toEqual([1, 2]);
    expect(application.peekTopic(topic)).toBe(2);
    off(); reloaded.clearRetainedTopic(topic);
  });
  it('exports the complete bus from the public application entry', () => {
    for (const name of ['publishTopic', 'subscribeTopic', 'peekTopic', 'clearRetainedTopic']) {
      expect(typeof (application as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('delivers intents synchronously without replaying history', () => {
    const got: unknown[] = [];
    const off = application.subscribeTopic('test:bus:intent', p => got.push(p));
    const payload = { value: 1 };
    application.publishTopic('test:bus:intent', payload);
    const late: unknown[] = [];
    const offLate = application.subscribeTopic('test:bus:intent', p => late.push(p));
    expect(got).toEqual([payload]);
    expect(got[0]).toBe(payload);
    expect(late).toEqual([]);
    off(); off(); offLate();
    application.publishTopic('test:bus:intent', 2);
    expect(got).toHaveLength(1);
  });

  it('retains exact values, including undefined, and clears without notifying', () => {
    const topic = 'test:bus:retained';
    application.publishTopic(topic, undefined, { retain: true });
    const got: unknown[] = [];
    const off = application.subscribeTopic(topic, p => got.push(p));
    expect(got).toEqual([undefined]);
    const payload = { value: 2 };
    application.publishTopic(topic, payload, { retain: true });
    application.publishTopic(topic, 'intent');
    expect(application.peekTopic(topic)).toBe(payload);
    application.clearRetainedTopic(topic);
    expect(application.peekTopic(topic)).toBeUndefined();
    expect(got).toEqual([undefined, payload, 'intent']);
    off();
    const late: unknown[] = [];
    application.subscribeTopic(topic, p => late.push(p))();
    expect(late).toEqual([]);
  });

  it('preserves Set identity semantics and snapshots listeners during publication', () => {
    const topic = 'test:bus:snapshot';
    const got: string[] = [];
    let offSecond = () => {};
    let offLate = () => {};
    const first = () => {
      got.push('first');
      offSecond();
      offLate = application.subscribeTopic(topic, () => got.push('late'));
    };
    const offFirst = application.subscribeTopic(topic, first);
    const duplicate = application.subscribeTopic(topic, first);
    offSecond = application.subscribeTopic(topic, () => got.push('second'));
    application.publishTopic(topic, null);
    expect(got).toEqual(['first', 'second']);
    duplicate(); // Subscribing twice is not reference-counted.
    application.publishTopic(topic, null);
    expect(got).toEqual(['first', 'second', 'late']);
    offFirst(); offLate();
  });

  it('isolates replay and dispatch errors without removing subscribers', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const topic = 'test:bus:errors';
    application.publishTopic(topic, 1, { retain: true });
    const bad = application.subscribeTopic(topic, () => { throw new Error('expected'); });
    const got: unknown[] = [];
    const good = application.subscribeTopic(topic, p => got.push(p));
    try {
      application.publishTopic(topic, 2);
      expect(got).toEqual([1, 2]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      bad(); good(); application.clearRetainedTopic(topic); warn.mockRestore();
    }
  });
});
