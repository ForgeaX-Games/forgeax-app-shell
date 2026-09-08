export type EventSourceMessageListener = (event: MessageEvent) => void;

export interface EventSourceObservationSource {
  addEventListener(type: 'event', listener: EventSourceMessageListener): void;
  close(): void;
}

export interface EventSourceObservationOptions {
  readonly url: string;
  readonly onEvent: EventSourceMessageListener;
  readonly createEventSource?: (url: string) => EventSourceObservationSource;
}

/** Observe fixed `event` messages without owning URL or payload policy. */
export function installEventSourceObservation(
  options: EventSourceObservationOptions,
): () => void {
  const createEventSource = options.createEventSource ?? (
    typeof EventSource === 'undefined'
      ? undefined
      : (url: string) => new EventSource(url) as unknown as EventSourceObservationSource
  );
  if (!createEventSource) return () => {};

  let disposed = false;
  let source: EventSourceObservationSource;
  let closed = false;

  try {
    source = createEventSource(options.url);
  } catch {
    return () => {};
  }

  const closeSource = () => {
    if (closed) return;
    closed = true;
    try { source.close(); } catch { /* cleanup stays isolated */ }
  };
  const listener: EventSourceMessageListener = (event) => {
    if (disposed) return;
    try { options.onEvent(event); } catch { /* caller payload policy stays isolated */ }
  };

  try {
    source.addEventListener('event', listener);
  } catch {
    // A host may retain the listener before throwing. Fence it before rollback.
    disposed = true;
    closeSource();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    closeSource();
  };
}
