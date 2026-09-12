/** Consumers may augment this interface with their own topic payloads. */
export interface BusTopics {}

type TopicName = keyof BusTopics | (string & {});
type PayloadOf<K> = K extends keyof BusTopics ? BusTopics[K] : unknown;
type Handler = (payload: unknown) => void;
interface BusState {
  handlers: Map<string, Set<Handler>>;
  retained: Map<string, unknown>;
}

// Keep the established realm identity: source/installed readers and HMR must
// share the same subscribers and retained values during consumer migration.
const BUS_KEY = '__FORGEAX_BUS__';
const realm = globalThis as typeof globalThis & { [BUS_KEY]?: BusState };
const bus = realm[BUS_KEY] ?? (realm[BUS_KEY] = {
  handlers: new Map(),
  retained: new Map(),
});

/** Publish synchronously. Retention is opt-in; later intents do not erase it. */
export function publishTopic<K extends TopicName>(
  topic: K,
  payload: PayloadOf<K>,
  options?: { retain?: boolean },
): void {
  if (options?.retain) bus.retained.set(topic, payload);
  const handlers = bus.handlers.get(topic);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`[bus] handler for "${topic}" threw`, error);
    }
  }
}

/** Subscribe and synchronously replay any retained value, even undefined.
 * Identical callback registrations share one Set entry, not a reference count.
 */
export function subscribeTopic<K extends TopicName>(
  topic: K,
  handler: (payload: PayloadOf<K>) => void,
): () => void {
  const callback = handler as Handler;
  let handlers = bus.handlers.get(topic);
  if (!handlers) {
    handlers = new Set();
    bus.handlers.set(topic, handlers);
  }
  handlers.add(callback);
  if (bus.retained.has(topic)) {
    try {
      callback(bus.retained.get(topic));
    } catch (error) {
      console.warn(`[bus] replay for "${topic}" threw`, error);
    }
  }
  return () => {
    const current = bus.handlers.get(topic);
    if (current) {
      current.delete(callback);
      if (current.size === 0) bus.handlers.delete(topic);
    }
  };
}

/** Read without subscribing; absent and retained undefined both read undefined. */
export function peekTopic<K extends TopicName>(topic: K): PayloadOf<K> | undefined {
  return bus.retained.get(topic) as PayloadOf<K> | undefined;
}

/** Remove the snapshot without notifying or removing current subscribers. */
export function clearRetainedTopic(topic: TopicName): void {
  bus.retained.delete(topic);
}
