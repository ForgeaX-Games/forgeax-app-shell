export interface ActivePanelObservationSubscription {
  dispose(): void;
}

export interface ActivePanelObservationOptions<ChangeEvent = unknown> {
  readonly subscribe: (
    listener: (event: ChangeEvent) => void,
  ) => ActivePanelObservationSubscription;
  readonly onChange: (event: ChangeEvent) => void;
}

/** Observe active-panel changes without owning panel selection or reconciliation policy. */
export function installActivePanelObservation<ChangeEvent>(
  options: ActivePanelObservationOptions<ChangeEvent>,
): () => void {
  let live = true;
  let subscription: ActivePanelObservationSubscription | undefined;

  const onChange = (event: ChangeEvent): void => {
    if (!live) return;
    try { options.onChange(event); } catch { /* product reconciliation stays isolated */ }
  };
  const disposeSubscription = (): void => {
    if (!subscription) return;
    try { subscription.dispose(); } catch { /* cleanup stays isolated */ }
  };

  try {
    subscription = options.subscribe(onChange);
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
