export interface LayoutFromJsonObservationSubscription {
  dispose(): void;
}

export interface LayoutFromJsonObservationOptions<HydrationEvent = unknown> {
  readonly subscribe: (
    listener: (event: HydrationEvent) => void,
  ) => LayoutFromJsonObservationSubscription;
  readonly onHydrated: (event: HydrationEvent) => void;
}

/** Observe completed layout hydration without owning product reconciliation policy. */
export function installLayoutFromJsonObservation<HydrationEvent>(
  options: LayoutFromJsonObservationOptions<HydrationEvent>,
): () => void {
  let live = true;
  let subscription: LayoutFromJsonObservationSubscription | undefined;

  const onHydrated = (event: HydrationEvent): void => {
    if (!live) return;
    try { options.onHydrated(event); } catch { /* product reconciliation stays isolated */ }
  };
  const disposeSubscription = (): void => {
    if (!subscription) return;
    try { subscription.dispose(); } catch { /* cleanup stays isolated */ }
  };

  try {
    subscription = options.subscribe(onHydrated);
  } catch {
    live = false;
    disposeSubscription();
  }

  return () => {
    if (!live) return;
    live = false;
    disposeSubscription();
  };
}
