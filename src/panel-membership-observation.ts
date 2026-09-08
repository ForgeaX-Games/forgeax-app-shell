export interface PanelMembershipObservationSubscription {
  dispose(): void;
}

export interface PanelMembershipObservationOptions<AddEvent = unknown, RemoveEvent = unknown> {
  readonly subscribeAdd: (
    listener: (event: AddEvent) => void,
  ) => PanelMembershipObservationSubscription;
  readonly subscribeRemove: (
    listener: (event: RemoveEvent) => void,
  ) => PanelMembershipObservationSubscription;
  readonly onAdd: (event: AddEvent) => void;
  readonly onRemove: (event: RemoveEvent) => void;
}

/** Observe panel membership changes without owning panel or layout policy. */
export function installPanelMembershipObservation<AddEvent, RemoveEvent>(
  options: PanelMembershipObservationOptions<AddEvent, RemoveEvent>,
): () => void {
  let live = true;
  let addSubscription: PanelMembershipObservationSubscription | undefined;
  let removeSubscription: PanelMembershipObservationSubscription | undefined;

  const onAdd = (event: AddEvent): void => {
    if (!live) return;
    try { options.onAdd(event); } catch { /* product membership policy stays isolated */ }
  };
  const onRemove = (event: RemoveEvent): void => {
    if (!live) return;
    try { options.onRemove(event); } catch { /* product membership policy stays isolated */ }
  };
  const disposeOne = (subscription: PanelMembershipObservationSubscription | undefined): void => {
    if (!subscription) return;
    try { subscription.dispose(); } catch { /* cleanup continues */ }
  };

  try {
    addSubscription = options.subscribeAdd(onAdd);
    removeSubscription = options.subscribeRemove(onRemove);
  } catch {
    live = false;
    disposeOne(removeSubscription);
    disposeOne(addSubscription);
  }

  return () => {
    if (!live) return;
    live = false;
    disposeOne(removeSubscription);
    disposeOne(addSubscription);
  };
}
