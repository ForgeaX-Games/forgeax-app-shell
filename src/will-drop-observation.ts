export interface WillDropObservationSubscription {
  dispose(): void;
}

export interface WillDropObservationOptions<DropEvent = unknown> {
  readonly subscribe: (
    listener: (event: DropEvent) => void,
  ) => WillDropObservationSubscription;
  readonly onWillDrop: (event: DropEvent) => void;
}

/** Observe pending drops without owning target validation or mutation policy. */
export function installWillDropObservation<DropEvent>(
  options: WillDropObservationOptions<DropEvent>,
): () => void {
  let live = true;
  let subscription: WillDropObservationSubscription | undefined;

  const onWillDrop = (event: DropEvent): void => {
    if (!live) return;
    try { options.onWillDrop(event); } catch { /* product drop policy stays isolated */ }
  };
  const disposeSubscription = (): void => {
    if (!subscription) return;
    try { subscription.dispose(); } catch { /* cleanup stays isolated */ }
  };

  try {
    subscription = options.subscribe(onWillDrop);
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
