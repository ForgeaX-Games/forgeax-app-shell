export interface ReplaceableObservationSubscription {
  dispose(): void;
}

export interface ReplaceableObservationSetOptions<Item, Observation> {
  readonly subscribe: (
    item: Item,
    listener: (observation: Observation) => void,
  ) => ReplaceableObservationSubscription;
  readonly onObservation: (item: Item, observation: Observation) => void;
}

export interface ReplaceableObservationSetLifecycle<Item> {
  replace(items: readonly Item[]): void;
  dispose(): void;
}

/** Own a replaceable set of subscriptions without owning item or event policy. */
export function createReplaceableObservationSetLifecycle<Item, Observation>(
  options: ReplaceableObservationSetOptions<Item, Observation>,
): ReplaceableObservationSetLifecycle<Item> {
  let disposed = false;
  let generation = 0;
  let subscriptions: ReplaceableObservationSubscription[] = [];

  const cleanup = (owned: readonly ReplaceableObservationSubscription[]): void => {
    for (let index = owned.length - 1; index >= 0; index--) {
      try { owned[index]?.dispose(); } catch { /* cleanup continues */ }
    }
  };

  const replace = (items: readonly Item[]): void => {
    if (disposed) return;
    const nextGeneration = ++generation;
    const previous = subscriptions;
    subscriptions = [];
    cleanup(previous);
    if (disposed || generation !== nextGeneration) return;

    const next: ReplaceableObservationSubscription[] = [];
    for (const item of items) {
      if (disposed || generation !== nextGeneration) break;
      let listenerCurrent = true;
      const listener = (observation: Observation): void => {
        if (!listenerCurrent || disposed || generation !== nextGeneration) return;
        try { options.onObservation(item, observation); } catch { /* product policy stays isolated */ }
      };

      try {
        const subscription = options.subscribe(item, listener);
        if (!subscription || typeof subscription.dispose !== 'function') {
          throw new TypeError('observation subscription must provide dispose()');
        }
        if (disposed || generation !== nextGeneration) {
          listenerCurrent = false;
          try { subscription.dispose(); } catch { /* stale cleanup stays isolated */ }
          cleanup(next);
          return;
        }
        next.push(subscription);
      } catch {
        listenerCurrent = false;
        if (generation === nextGeneration) generation++;
        cleanup(next);
        return;
      }
    }

    if (disposed || generation !== nextGeneration) {
      cleanup(next);
      return;
    }
    subscriptions = next;
  };

  return {
    replace,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation++;
      const owned = subscriptions;
      subscriptions = [];
      cleanup(owned);
    },
  };
}
