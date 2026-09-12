/** Realm-local broadcast transport. Product boot owns the URL and connect/disconnect. */
export type BroadcastFrame = { type?: string } & Record<string, unknown>;
type FrameHandler = (frame: BroadcastFrame) => void;
interface StreamState {
  ws: WebSocket | null;
  desired: boolean;
  url: string;
  retryMs: number;
  retryTimer: number | null;
  handlers: Map<string, Set<FrameHandler>>;
}

// Preserve the existing Interface realm slot so mixed consumers share one owner.
const realm = globalThis as typeof globalThis & { __FORGEAX_BROADCAST_STREAM__?: StreamState };
const state = realm.__FORGEAX_BROADCAST_STREAM__ ??= {
  ws: null, desired: false, url: '', retryMs: 1000, retryTimer: null,
  handlers: new Map<string, Set<FrameHandler>>(),
};

function dispatch(frame: BroadcastFrame): void {
  const type = typeof frame.type === 'string' ? frame.type : '';
  const exact = type ? state.handlers.get(type) : undefined;
  const wildcard = state.handlers.get('*');
  if (exact) for (const handler of [...exact]) {
    try { handler(frame); } catch (error) { console.warn(`[broadcast-stream] handler "${type}" threw`, error); }
  }
  if (wildcard) for (const handler of [...wildcard]) {
    try { handler(frame); } catch (error) { console.warn('[broadcast-stream] "*" handler threw', error); }
  }
}

function scheduleReconnect(): void {
  if (state.retryTimer !== null || !state.desired) return;
  state.retryTimer = window.setTimeout(() => {
    state.retryTimer = null;
    state.retryMs = Math.min(state.retryMs * 2, 30_000);
    if (state.desired) open();
  }, state.retryMs);
}

function open(): void {
  if (typeof window === 'undefined') return;
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED) return;
  let socket: WebSocket;
  try { socket = new WebSocket(state.url); } catch { scheduleReconnect(); return; }
  state.ws = socket;
  socket.onopen = () => {
    if (state.ws !== socket) return;
    state.retryMs = 1000;
  };
  socket.onmessage = (event) => {
    if (state.ws !== socket) return;
    let frame: unknown;
    try { frame = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }
    if (frame && typeof frame === 'object') dispatch(frame as BroadcastFrame);
  };
  socket.onclose = () => {
    if (state.ws !== socket) return;
    state.ws = null;
    if (state.desired) scheduleReconnect();
  };
  socket.onerror = () => { try { socket.close(); } catch { /* preserve close failure isolation */ } };
}

/** Explicit boot only; calling again while connected does not replace the socket. */
export function connectBroadcast(url: string): void {
  if (typeof window === 'undefined') return;
  state.desired = true;
  if (url) state.url = url;
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED) return;
  state.retryMs = 1000;
  open();
}

export function disconnectBroadcast(): void {
  state.desired = false;
  if (state.retryTimer !== null) {
    window.clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  if (state.ws) {
    try { state.ws.close(); } catch { /* preserve close failure isolation */ }
    state.ws = null;
  }
}

/** Exact type plus wildcard routing; subscribing never opens a connection. */
export function subscribeBroadcast(type: string, handler: FrameHandler): () => void {
  let handlers = state.handlers.get(type);
  if (!handlers) { handlers = new Set(); state.handlers.set(type, handlers); }
  handlers.add(handler);
  return () => {
    const current = state.handlers.get(type);
    if (current) {
      current.delete(handler);
      if (!current.size) state.handlers.delete(type);
    }
  };
}

/** Empty URL before product boot; this package has no product endpoint default. */
export function getBroadcastStatus(): { connected: boolean; url: string } {
  return { connected: state.ws?.readyState === WebSocket.OPEN, url: state.url };
}
