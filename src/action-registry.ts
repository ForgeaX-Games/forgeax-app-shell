/**
 * One application action registry shared by UI dispatch, command discovery and
 * external invocation. Products supply action definitions and domain handlers;
 * this module owns registration, dispatch and serializable projections only.
 * Schemas are plain JSON objects. Executable callbacks never enter manifests.
 */

/** Declared capability classification, preserved in the external manifest. */
export type UiCapability =
  | 'read'
  | 'write'
  | 'delete'
  | 'exec'
  | 'network'
  | 'credential'
  | 'delegate'
  | 'other';

/** Completed, asynchronously accepted, or rejected without executing. */
export interface UiActionResult {
  status: 'completed' | 'accepted' | 'rejected';
  reason?: string;
  stateDigest?: unknown;
}

/** Plain JSON Schema; no schema-library runtime is required. */
export type JsonSchemaObject = Record<string, unknown>;

export interface UiActionDef {
  /** Stable, product-selected action identity. */
  id: string;
  /** Human-readable title for menus and command discovery. */
  title: string;
  /** Optional description included in schema detail and the manifest. */
  description?: string;
  /** Optional argument schema. */
  schema?: JsonSchemaObject;
  /** Capability declaration consumed by the product's permission boundary. */
  capability: UiCapability;
  /** Declared availability surface; the product owns its implementation. */
  surface?: 'ui' | 'server' | 'both';
  /** Expected duration advertised to external callers, not an enforced timeout. */
  timeoutMs?: number;
  /** Returns true or an unavailable reason; omitted means available. */
  available?: () => true | string;
  /** Whether external tooling should expose this as a first-class action. */
  firstClass?: boolean;
  /** Human-only actions are excluded from external discovery and invocation. */
  audience?: 'human';
  /** Client-only dynamic argument choices, omitted from serialized manifests. */
  choices?: Record<string, () => string[] | Promise<string[]>>;
  /** Void becomes completed; thrown/rejected failures become rejected results. */
  run: (args: Record<string, unknown>) => UiActionResult | void | Promise<UiActionResult | void>;
}

/** Caller-owned, serializable state projection evaluated at snapshot time. */
export type StateSliceSelector = () => unknown;

const actions = new Map<string, UiActionDef>();
const stateSlices = new Map<string, StateSliceSelector>();
const changeListeners = new Set<() => void>();

function notifyChange(): void {
  for (const cb of changeListeners) {
    try {
      cb();
    } catch {
      /* Listener failures do not interrupt other subscribers. */
    }
  }
}

/** Last registration wins; a stale disposer cannot remove its replacement. */
export function registerAction(def: UiActionDef): () => void {
  actions.set(def.id, def);
  notifyChange();
  return () => {
    if (actions.get(def.id) === def) {
      actions.delete(def.id);
      notifyChange();
    }
  };
}

/** Register a state projection with replacement-safe disposal. */
export function registerStateSlice(id: string, selector: StateSliceSelector): () => void {
  stateSlices.set(id, selector);
  notifyChange();
  return () => {
    if (stateSlices.get(id) === selector) {
      stateSlices.delete(id);
      notifyChange();
    }
  };
}

/** Observe action/state registration changes, synchronously and fail-soft. */
export function onRegistryChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function getAction(id: string): UiActionDef | undefined {
  return actions.get(id);
}

/** Carries { id, source, args } for caller-owned feedback and tracing. */
export const UI_ACTION_DISPATCH_EVENT = 'forgeax:ui-action-dispatch';

/** Validate required arguments, declared top-level primitive types and enums. */
function validateArgs(schema: JsonSchemaObject | undefined, args: Record<string, unknown>): true | string {
  if (!schema) return true;
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  for (const k of required) {
    if (typeof k === 'string' && !(k in args)) return `missing required arg "${k}"`;
  }
  const props = schema.properties && typeof schema.properties === 'object'
    ? (schema.properties as Record<string, { type?: unknown; enum?: unknown[] }>)
    : {};
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) continue; // Undeclared arguments remain the handler's responsibility.
    const t = p.type;
    if (typeof t === 'string') {
      const actual = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      const okType =
        (t === 'string' && actual === 'string') ||
        (t === 'number' && actual === 'number') ||
        (t === 'integer' && actual === 'number' && Number.isInteger(v)) ||
        (t === 'boolean' && actual === 'boolean') ||
        (t === 'object' && actual === 'object') ||
        (t === 'array' && actual === 'array');
      if (!okType) return `arg "${k}" should be ${t}, got ${actual}`;
    }
    if (Array.isArray(p.enum) && !p.enum.includes(v)) {
      return `arg "${k}" must be one of ${JSON.stringify(p.enum)}`;
    }
  }
  return true;
}

/** Shared UI/external dispatch path; unknown actions fail closed. */
export async function dispatchAction(
  id: string,
  args: Record<string, unknown> = {},
  opts: { source?: 'human' | 'ai' } = {},
): Promise<UiActionResult> {
  const src = opts.source ?? 'human';
  // Preserve entry and terminal trace events, including caller-supplied data.
  console.info(`%c[fx-action]%c ▶ ${id} (${src})`, 'color:#818cf8;font-weight:bold', 'color:inherit', { args });
  const done = (r: UiActionResult): UiActionResult => {
    if (r.status === 'rejected') {
      console.warn(`[fx-action] ✗ ${id} rejected: ${r.reason ?? ''}`);
    } else {
      console.info(
        `%c[fx-action]%c ✔ ${id} → ${r.status}`,
        'color:#34d399;font-weight:bold',
        'color:inherit',
        r.stateDigest !== undefined ? { stateDigest: r.stateDigest } : {},
      );
    }
    return r;
  };

  const def = actions.get(id);
  if (!def) return done({ status: 'rejected', reason: `unknown action "${id}" (not in the registry)` });

  if (src === 'ai' && def.audience === 'human') return done({ status: 'rejected', reason: 'This action is only available through the user interface.' });

  const avail = def.available ? safeAvailable(def) : true;
  if (avail !== true) return done({ status: 'rejected', reason: avail });

  const valid = validateArgs(def.schema, args);
  if (valid !== true) return done({ status: 'rejected', reason: valid });

  try {
    window.dispatchEvent(new CustomEvent(UI_ACTION_DISPATCH_EVENT, { detail: { id, source: src, args } }));
  } catch {
    /* Missing DOM globals or event delivery failure does not prevent execution. */
  }

  try {
    const out = await def.run(args);
    return done(out ?? { status: 'completed' });
  } catch (e) {
    console.error(`[fx-action] ✗ ${id} threw`, e); // Preserve the original failure trace.
    return done({ status: 'rejected', reason: `action "${id}" threw: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function safeAvailable(def: UiActionDef): true | string {
  try {
    return def.available!();
  } catch (e) {
    return `availability check threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export interface UiActionSummary {
  id: string;
  title: string;
  available: boolean;
  reason?: string;
  /** Included only for selected schema-detail requests. */
  description?: string;
  inputSchema?: JsonSchemaObject;
}

/** Lightweight discovery by default; expand schema detail only for named ids. */
export function snapshotActions(detail?: string, ids?: string[], audience: 'human' | 'ai' = 'ai'): UiActionSummary[] {
  const expand = detail === 'schema' ? new Set(ids ?? []) : null;
  const out: UiActionSummary[] = [];
  for (const def of actions.values()) {
    if (audience === 'ai' && def.audience === 'human') continue;
    const avail = def.available ? safeAvailable(def) : true;
    const row: UiActionSummary = {
      id: def.id,
      title: def.title,
      available: avail === true,
      ...(avail === true ? {} : { reason: avail }),
    };
    if (expand?.has(def.id)) {
      if (def.description) row.description = def.description;
      row.inputSchema = def.schema ?? { type: 'object', properties: {} };
    }
    out.push(row);
  }
  return out;
}

/** Evaluate state slices independently; one failing projection does not mask others. */
export function snapshotState(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, selector] of stateSlices) {
    try {
      out[id] = selector();
    } catch (e) {
      out[id] = { error: `state slice threw: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return out;
}

/** Project declared permission/discovery metadata without executable callbacks. */
export function buildManifest(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const def of actions.values()) {
    if (def.audience === 'human') continue;
    out.push({
      id: def.id,
      title: def.title,
      ...(def.description ? { description: def.description } : {}),
      inputSchema: def.schema ?? { type: 'object', properties: {} },
      capability: def.capability,
      ...(def.surface ? { surface: def.surface } : {}),
      ...(def.timeoutMs ? { timeoutMs: def.timeoutMs } : {}),
      ...(def.firstClass ? { firstClass: true } : {}),
    });
  }
  return out;
}

/** Test-only reset; production callers must dispose their own registrations. */
export function __resetRegistryForTest(): void {
  actions.clear();
  stateSlices.clear();
  changeListeners.clear();
}
