export const REGIONS = ['DockShell', 'AuxBar', 'ChatDock', 'StatusBar'] as const;
export type Region = typeof REGIONS[number];

export const DOCK_REGIONS = ['DockShell', 'AuxBar', 'ChatDock'] as const;
export type DockRegion = typeof DOCK_REGIONS[number];

export function isDockRegion(value: string): value is DockRegion {
  return (DOCK_REGIONS as readonly string[]).includes(value);
}

export interface DockReadyCleanup {
  /** Register one teardown while active; late registrations are disposed immediately. */
  add(dispose: () => void): boolean;
  /** Dispose registered teardowns once, in reverse registration order. */
  dispose(): void;
}

/** Own the best-effort teardown lifecycle of one dock-ready session. */
export function createDockReadyCleanup(): DockReadyCleanup {
  const disposers: Array<() => void> = [];
  let active = true;

  return {
    add(dispose) {
      if (active) {
        disposers.push(dispose);
        return true;
      }
      try { dispose(); } catch { /* late cleanup remains best-effort */ }
      return false;
    },
    dispose() {
      if (!active) return;
      active = false;
      while (disposers.length > 0) {
        try { disposers.pop()?.(); } catch { /* cleanup continues */ }
      }
    },
  };
}

export type DockReadyAdapterInstaller = () => void | (() => void);

export interface DockReadyAdapterSession extends DockReadyCleanup {
  readonly installed: boolean;
}

/** Replace one dock-ready adapter session with an ordered, rollback-safe transaction. */
export function replaceDockReadyAdapters(
  previous: DockReadyCleanup | null | undefined,
  installers: readonly DockReadyAdapterInstaller[],
): DockReadyAdapterSession {
  try { previous?.dispose(); } catch { /* replacement continues */ }
  const cleanup = createDockReadyCleanup();

  try {
    for (const install of installers) {
      const dispose = install();
      if (dispose) cleanup.add(dispose);
    }
    return { ...cleanup, installed: true };
  } catch {
    cleanup.dispose();
    return { ...cleanup, installed: false };
  }
}

export interface DockReadyActivation<T> {
  /** Return the current value only after its complete adapter transaction succeeds. */
  getCurrent(): T | null;
  /** Replace the current ready session; failed or stale transactions stay unpublished. */
  replace(value: T, installers: readonly DockReadyAdapterInstaller[]): boolean;
  /** Revoke the current value and dispose its ready session once. */
  dispose(): void;
}

/** Own current-value publication and reentrant replacement for dock-ready sessions. */
export function createDockReadyActivation<T>(): DockReadyActivation<T> {
  let current: T | null = null;
  let session: DockReadyAdapterSession | null = null;
  let generation = 0;

  return {
    getCurrent: () => current,
    replace(value, installers) {
      const candidateGeneration = ++generation;
      current = null;
      const candidate = replaceDockReadyAdapters(session, installers);
      if (candidateGeneration !== generation) {
        candidate.dispose();
        return false;
      }
      session = candidate;
      if (!candidate.installed) return false;
      current = value;
      return true;
    },
    dispose() {
      generation += 1;
      current = null;
      session?.dispose();
      session = null;
    },
  };
}

export interface DockScopeTransitionAdapter<Scope, Live> {
  /** Resolve the currently published dock value without retaining it here. */
  getLive(): Live | null;
  /** Persist the previous product-owned scope before it is replaced. */
  save(live: Live, scope: Scope): void;
  /** Apply the next product-owned scope to the live dock value. */
  apply(live: Live, scope: Scope | null): void;
}

export interface DockScopeTransition<Scope> {
  getCurrent(): Scope | null;
  /** Save the previous scope, publish the next scope, then apply it when live. */
  transition(next: Scope | null): boolean;
  /** Apply the stable current scope to a newly ready or otherwise refreshed dock. */
  applyCurrent(): boolean;
}

/** Own ordered, reentrant-safe scope transitions while product adapters retain policy. */
export function createDockScopeTransition<Scope, Live>(
  adapter: DockScopeTransitionAdapter<Scope, Live>,
  initial: Scope | null = null,
): DockScopeTransition<Scope> {
  let current = initial;
  let generation = 0;
  let processing = false;
  let pending: { readonly generation: number; readonly next: Scope | null; readonly savePrevious: boolean } | null = null;

  const getLive = (): Live | null => {
    try { return adapter.getLive(); } catch { return null; }
  };

  const enqueue = (next: Scope | null, savePrevious: boolean): boolean => {
    const request = { generation: ++generation, next, savePrevious };
    pending = request;
    if (processing) return true;

    processing = true;
    let requestedResult = true;
    let savedPrevious: Scope | null = null;
    try {
      while (pending) {
        const candidate = pending;
        pending = null;
        const previous = current;
        const live = getLive();
        if (pending) {
          if (candidate === request) requestedResult = false;
          continue;
        }
        if (candidate.savePrevious && live && previous !== null && savedPrevious !== previous) {
          try { adapter.save(live, previous); } catch { /* product persistence stays isolated */ }
          savedPrevious = previous;
          if (pending) {
            if (candidate === request) requestedResult = false;
            continue;
          }
        }
        current = candidate.next;
        if (live) {
          try { adapter.apply(live, candidate.next); } catch {
            if (candidate === request) requestedResult = false;
          }
        } else if (!candidate.savePrevious && candidate === request) {
          requestedResult = false;
        }
        if (pending && candidate === request) requestedResult = false;
      }
    } finally {
      processing = false;
    }
    return requestedResult;
  };

  return {
    getCurrent: () => current,
    transition: (next) => enqueue(next, true),
    applyCurrent: () => enqueue(current, false),
  };
}

export interface PanelDescriptorLite {
  defaultRegion?: DockRegion;
}

export function resolveRegion(
  id: string,
  descriptor: PanelDescriptorLite,
  overrides: Readonly<Record<string, DockRegion>>,
): DockRegion {
  return overrides[id] ?? descriptor.defaultRegion ?? 'DockShell';
}

export interface DockviewApiLike {
  readonly id: string;
  getPanel(id: string): { readonly api: { close(): void } } | undefined;
}

const dockviewApis = new Map<string, DockviewApiLike>();

export function registerDockviewApi(api: DockviewApiLike): () => void {
  dockviewApis.set(api.id, api);
  return () => { if (dockviewApis.get(api.id) === api) dockviewApis.delete(api.id); };
}

export function getDockviewApi(viewId: string): DockviewApiLike | undefined {
  return dockviewApis.get(viewId);
}

export interface DockRegionEntry {
  readonly viewId: string;
  readonly region: string;
  readonly api: unknown;
  readonly wrapEl: HTMLElement;
}

const dockRegions = new Map<string, DockRegionEntry>();

export function registerDockRegion(entry: DockRegionEntry): () => void {
  dockRegions.set(entry.viewId, entry);
  return () => { if (dockRegions.get(entry.viewId) === entry) dockRegions.delete(entry.viewId); };
}

export function getDockRegions(): DockRegionEntry[] {
  return [...dockRegions.values()];
}

const visibleDockPanels = new Map<string, number>();

/** Track one live mount of a dock panel and return an idempotent release. */
export function trackDockPanelVisibility(panelId: string): () => void {
  visibleDockPanels.set(panelId, (visibleDockPanels.get(panelId) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const next = (visibleDockPanels.get(panelId) ?? 1) - 1;
    if (next > 0) visibleDockPanels.set(panelId, next);
    else visibleDockPanels.delete(panelId);
  };
}

export function isDockPanelVisible(panelId: string): boolean {
  return visibleDockPanels.has(panelId);
}

export interface DockPanelVisibilityEventSource {
  onDidAddPanel(listener: (panel: { readonly id: string }) => void): { dispose(): void };
  onDidRemovePanel(listener: (panel: { readonly id: string }) => void): { dispose(): void };
}

export interface DockPanelVisibilityHooks {
  readonly onAdded?: (panelId: string) => void;
  readonly onRemoved?: (panelId: string) => void;
}

/** Balance one visibility lease per live panel id across an injected event source. */
export function installDockPanelVisibilityTracking(
  source: DockPanelVisibilityEventSource,
  hooks: DockPanelVisibilityHooks = {},
): () => void {
  const releases = new Map<string, () => void>();
  let active = true;
  const added = source.onDidAddPanel(({ id }) => {
    if (!active) return;
    if (!releases.has(id)) releases.set(id, trackDockPanelVisibility(id));
    try { hooks.onAdded?.(id); } catch { /* product hook must not break source dispatch */ }
  });
  let removed: { dispose(): void };
  try {
    removed = source.onDidRemovePanel(({ id }) => {
      if (!active) return;
      try { releases.get(id)?.(); } catch { /* release remains best-effort */ }
      releases.delete(id);
      try { hooks.onRemoved?.(id); } catch { /* product hook must not break source dispatch */ }
    });
  } catch (error) {
    active = false;
    try { added.dispose(); } catch { /* registration rollback remains best-effort */ }
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    try { added.dispose(); } catch { /* cleanup continues */ }
    try { removed.dispose(); } catch { /* cleanup continues */ }
    releases.forEach((release) => { try { release(); } catch { /* cleanup continues */ } });
    releases.clear();
  };
}

export function hasMountedPanelPlacement(
  panelIds: readonly string[],
  mountedPanelIds: ReadonlySet<string>,
): boolean {
  return panelIds.some((id) => mountedPanelIds.has(id));
}

export interface DockLayoutPersistenceScope<Identity> {
  readonly key: string;
  readonly identity: Identity;
}

export interface DockLayoutPersistenceAdapter<Layout, Identity> {
  load(key: string, identity: Identity): Layout | null;
  save(key: string, identity: Identity, layout: Layout): void;
  remove(key: string): void;
}

export interface DockLayoutPersistence<Layout, Identity> {
  restore(scope: DockLayoutPersistenceScope<Identity>, apply: (saved: Layout | null) => void): void;
  save(scope: DockLayoutPersistenceScope<Identity>, layout: Layout): boolean;
  captureAndSave(scope: DockLayoutPersistenceScope<Identity>, capture: () => Layout): boolean;
  clear(scope: DockLayoutPersistenceScope<Identity>): void;
  isRestoring(): boolean;
}

/**
 * Own the load-before-mutation and reentrant-save suppression required by dock
 * layout restoration. Product callers retain key construction, identity,
 * storage, snapshot validation, and concrete Dockview mutation.
 */
export function createDockLayoutPersistence<Layout, Identity>(
  adapter: DockLayoutPersistenceAdapter<Layout, Identity>,
): DockLayoutPersistence<Layout, Identity> {
  let restoreDepth = 0;
  return {
    restore(scope, apply) {
      const saved = adapter.load(scope.key, scope.identity);
      restoreDepth += 1;
      try {
        apply(saved);
      } finally {
        restoreDepth -= 1;
      }
    },
    save(scope, layout) {
      if (restoreDepth > 0) return false;
      adapter.save(scope.key, scope.identity, layout);
      return true;
    },
    captureAndSave(scope, capture) {
      if (restoreDepth > 0) return false;
      adapter.save(scope.key, scope.identity, capture());
      return true;
    },
    clear(scope) {
      adapter.remove(scope.key);
    },
    isRestoring() {
      return restoreDepth > 0;
    },
  };
}

export interface DockLayoutObservationSource {
  onDidLayoutChange(listener: () => void): { dispose(): void };
}

export interface DockLayoutObservationAdapter<Scope> {
  /** Resolve the current product-owned scope at event time. */
  getCurrentScope(): Scope | null;
  /** Capture and persist a scoped layout; false identifies a suppressed capture. */
  readonly captureAndSave?: (scope: Scope) => boolean;
  /** Publish one stable notification only after capture succeeds or is not required. */
  onCommitted(): void;
}

/**
 * Own one layout-change subscription and its capture-before-notify sequencing.
 * Product callers retain concrete event, scope, snapshot, persistence, and UI adapters.
 */
export function installDockLayoutObservation<Scope>(
  source: DockLayoutObservationSource,
  adapter: DockLayoutObservationAdapter<Scope>,
): () => void {
  let active = true;
  let subscription: { dispose(): void } | undefined;
  const onDidLayoutChange = (): void => {
    if (!active) return;
    let scope: Scope | null;
    try { scope = adapter.getCurrentScope(); } catch { return; }
    if (!active) return;
    if (scope !== null && adapter.captureAndSave) {
      try {
        if (!adapter.captureAndSave(scope)) return;
      } catch {
        return;
      }
      if (!active) return;
    }
    try { adapter.onCommitted(); } catch { /* product notification stays isolated */ }
  };

  try {
    subscription = source.onDidLayoutChange(onDidLayoutChange);
  } catch {
    active = false;
    try { subscription?.dispose(); } catch { /* cleanup remains best-effort */ }
  }

  return () => {
    if (!active) return;
    active = false;
    try { subscription?.dispose(); } catch { /* cleanup remains best-effort */ }
  };
}

export interface DockLayoutResetSource {
  onReset(listener: () => void): { dispose(): void };
}

export interface DockLayoutResetAdapter<Scope, Live> {
  /** Resolve the current product-owned scope at reset time. */
  getCurrentScope(): Scope | null;
  /** Remove the persisted layout for a concrete product-owned scope. */
  clear(scope: Scope): void;
  /** Resolve the currently published dock value without retaining it here. */
  getLive(): Live | null;
  /** Reapply the current product-owned scope after persistence is cleared. */
  apply(live: Live, scope: Scope | null): void;
}

/**
 * Own one reset subscription and clear-before-reapply sequencing. Reentrant
 * requests are serialized so the newest reset is applied last; product callers
 * retain the concrete event, scope, persistence, live dock, and layout adapters.
 */
export function installDockLayoutReset<Scope, Live>(
  source: DockLayoutResetSource,
  adapter: DockLayoutResetAdapter<Scope, Live>,
): () => void {
  let active = true;
  let processing = false;
  let pending = false;

  const reset = () => {
    if (!active) return;
    pending = true;
    if (processing) return;
    processing = true;
    try {
      while (active && pending) {
        pending = false;
        let scope: Scope | null;
        try { scope = adapter.getCurrentScope(); } catch { continue; }
        if (!active) break;
        if (pending) continue;
        if (scope !== null) {
          try { adapter.clear(scope); } catch { continue; }
          if (!active) break;
          if (pending) continue;
        }
        let live: Live | null;
        try { live = adapter.getLive(); } catch { continue; }
        if (!active) break;
        if (pending) continue;
        if (live) {
          try { adapter.apply(live, scope); } catch { /* product apply stays isolated */ }
        }
      }
    } finally {
      processing = false;
    }
  };

  const subscription = source.onReset(reset);
  return () => {
    if (!active) return;
    active = false;
    pending = false;
    try { subscription.dispose(); } catch { /* cleanup remains best-effort */ }
  };
}

export interface SerializedDockPanelLike {
  readonly contentComponent?: string;
}

export interface SerializedDockLayoutLike {
  readonly panels?: Readonly<Record<string, SerializedDockPanelLike>>;
  readonly grid?: Readonly<{ readonly root?: unknown }>;
}

/**
 * Remove panels that the current shell cannot render, then prune empty grid
 * leaves and branches. The input snapshot is never mutated.
 */
export function pruneSerializedDockLayout<T extends SerializedDockLayoutLike>(
  layout: T,
  knownComponents: ReadonlySet<string>,
  allowedPanelIds?: ReadonlySet<string>,
): T | null {
  if (!layout.panels) return layout;
  const removed = new Set(Object.entries(layout.panels)
    .filter(([id, panel]) => !knownComponents.has(panel.contentComponent ?? id)
      || (allowedPanelIds !== undefined && !allowedPanelIds.has(id)))
    .map(([id]) => id));
  if (removed.size === 0) return layout;

  const panels = Object.fromEntries(
    Object.entries(layout.panels).filter(([id]) => !removed.has(id)),
  );
  if (Object.keys(panels).length === 0) return null;

  const pruneNode = (node: unknown): unknown | null => {
    if (!node || typeof node !== 'object') return node;
    const value = node as { readonly type?: string; readonly data?: unknown };
    if (value.type === 'leaf') {
      const data = value.data as { readonly views?: unknown; readonly activeView?: string } | undefined;
      if (!Array.isArray(data?.views)) return node;
      const views = (data.views as readonly string[]).filter((id) => !removed.has(id));
      if (views.length === 0) return null;
      return {
        ...value,
        data: {
          ...data,
          views,
          activeView: views.includes(data.activeView ?? '') ? data.activeView : views[0],
        },
      };
    }
    if (value.type === 'branch' && Array.isArray(value.data)) {
      const children = value.data.map(pruneNode).filter((child) => child !== null);
      return children.length === 0 ? null : { ...value, data: children };
    }
    return node;
  };

  const root = pruneNode(layout.grid?.root);
  if (root === null) return null;
  return {
    ...layout,
    panels,
    grid: layout.grid ? { ...layout.grid, root } : layout.grid,
  } as T;
}

export type DockLayoutOrientation = 'HORIZONTAL' | 'VERTICAL';
export type DockReopenDirection = 'left' | 'right' | 'above' | 'below' | 'within';

/** Structural shape shared by concrete serialized dock tree implementations. */
export interface AuthoredDockNodeLike {
  readonly type: 'leaf' | 'branch';
  readonly data: unknown;
}

export interface AuthoredDockLayoutLike {
  readonly grid?: {
    readonly orientation: DockLayoutOrientation;
    readonly root?: AuthoredDockNodeLike;
  };
}

export type DesignedDockPanelPosition =
  | {
      readonly kind: 'relative';
      readonly referencePanel: string;
      readonly direction: DockReopenDirection;
    }
  | {
      readonly kind: 'edge';
      readonly direction: Exclude<DockReopenDirection, 'within'>;
    };

function authoredLeafViews(node: AuthoredDockNodeLike): readonly string[] {
  if (node.type !== 'leaf' || !node.data || typeof node.data !== 'object') return [];
  const views = (node.data as { readonly views?: unknown }).views;
  return Array.isArray(views) ? views as readonly string[] : [];
}

function authoredBranchChildren(node: AuthoredDockNodeLike): readonly AuthoredDockNodeLike[] {
  return node.type === 'branch' && Array.isArray(node.data)
    ? node.data as readonly AuthoredDockNodeLike[]
    : [];
}

function firstOpenAuthoredPanel(
  node: AuthoredDockNodeLike,
  isOpen: (id: string) => boolean,
): string | undefined {
  if (node.type === 'leaf') return authoredLeafViews(node).find(isOpen);
  for (const child of authoredBranchChildren(node)) {
    const match = firstOpenAuthoredPanel(child, isOpen);
    if (match) return match;
  }
  return undefined;
}

function findAuthoredPanelPath(
  root: AuthoredDockNodeLike,
  panelId: string,
): AuthoredDockNodeLike[] | undefined {
  if (root.type === 'leaf') {
    return authoredLeafViews(root).includes(panelId) ? [root] : undefined;
  }
  for (const child of authoredBranchChildren(root)) {
    const path = findAuthoredPanelPath(child, panelId);
    if (path) return [root, ...path];
  }
  return undefined;
}

function authoredBranchOrientation(
  rootOrientation: DockLayoutOrientation,
  depth: number,
): DockLayoutOrientation {
  if (depth % 2 === 0) return rootOrientation;
  return rootOrientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
}

/**
 * Derive a closed panel's authored seat against a panel that is still open.
 * Returns undefined when the panel is absent or no live sibling can anchor it.
 */
export function designedDockPanelPosition(
  layout: AuthoredDockLayoutLike,
  panelId: string,
  isOpen: (id: string) => boolean,
): DesignedDockPanelPosition | undefined {
  const root = layout.grid?.root;
  if (!root) return undefined;
  const path = findAuthoredPanelPath(root, panelId);
  if (!path) return undefined;

  const leaf = path[path.length - 1];
  const tabMate = authoredLeafViews(leaf).find((id) => id !== panelId && isOpen(id));
  if (tabMate) return { kind: 'relative', referencePanel: tabMate, direction: 'within' };

  if (path.length === 2 && path[0].type === 'branch') {
    const siblings = authoredBranchChildren(path[0]);
    const index = siblings.indexOf(leaf);
    const horizontal = layout.grid?.orientation === 'HORIZONTAL';
    if (index === 0) return { kind: 'edge', direction: horizontal ? 'left' : 'above' };
    if (index === siblings.length - 1) {
      return { kind: 'edge', direction: horizontal ? 'right' : 'below' };
    }
  }

  for (let depth = path.length - 2; depth >= 0; depth--) {
    const branch = path[depth];
    if (branch.type !== 'branch') continue;
    const children = authoredBranchChildren(branch);
    const index = children.indexOf(path[depth + 1]);
    if (index < 0) continue;
    const horizontal = authoredBranchOrientation(layout.grid.orientation, depth) === 'HORIZONTAL';
    for (let i = index + 1; i < children.length; i++) {
      const referencePanel = firstOpenAuthoredPanel(children[i], isOpen);
      if (referencePanel) {
        return { kind: 'relative', referencePanel, direction: horizontal ? 'left' : 'above' };
      }
    }
    for (let i = index - 1; i >= 0; i--) {
      const referencePanel = firstOpenAuthoredPanel(children[i], isOpen);
      if (referencePanel) {
        return { kind: 'relative', referencePanel, direction: horizontal ? 'right' : 'below' };
      }
    }
  }
  return undefined;
}

export interface DockCommandPanel {
  close(): void;
  setActive(): void;
}

export interface DockPanelCommandAdapter {
  getPanel(id: string): DockCommandPanel | undefined;
  addPanel(options: {
    id: string;
    component: string;
    title: string;
    position?: { referencePanel?: string; direction: DockReopenDirection };
  }): void;
  canOpen(id: string): boolean;
  titleFor(id: string): string;
  authoredLayout?(): AuthoredDockLayoutLike | undefined;
  fallbackPanelId?(): string | undefined;
}

export interface DockPanelCommands {
  open(id: string): boolean;
  close(id: string): boolean;
  focus(id: string): boolean;
  reveal(id: string): boolean;
}

/** Own idempotent panel commands while callers retain membership and product policy. */
export function createDockPanelCommands(adapter: DockPanelCommandAdapter): DockPanelCommands {
  const panel = (id: string): DockCommandPanel | undefined => {
    try { return adapter.getPanel(id); } catch { return undefined; }
  };
  const focus = (id: string): boolean => {
    const target = panel(id);
    if (!target) return false;
    try { target.setActive(); return true; } catch { return false; }
  };
  const open = (id: string): boolean => {
    if (panel(id)) return false;
    try {
      if (!adapter.canOpen(id)) return false;
      const layout = adapter.authoredLayout?.();
      const designed = layout
        ? designedDockPanelPosition(layout, id, (candidate) => panel(candidate) !== undefined)
        : undefined;
      const referencePanel = designed?.kind === 'relative'
        ? designed.referencePanel
        : designed === undefined
          ? adapter.fallbackPanelId?.()
          : undefined;
      adapter.addPanel({
        id,
        component: id,
        title: adapter.titleFor(id),
        position: designed?.kind === 'edge'
          ? { direction: designed.direction }
          : referencePanel
            ? { referencePanel, direction: designed?.direction ?? 'right' }
            : undefined,
      });
      return true;
    } catch { return false; }
  };
  return {
    open,
    close(id) {
      const target = panel(id);
      if (!target) return false;
      try { target.close(); return true; } catch { return false; }
    },
    focus,
    reveal(id) {
      if (!panel(id) && !open(id)) return false;
      return focus(id);
    },
  };
}

export interface DockPanelCommandSubscriptionSource {
  onOpen(listener: (panelId: string) => void): { dispose(): void };
  onClose(listener: (panelId: string) => void): { dispose(): void };
  onFocus(listener: (panelId: string) => void): { dispose(): void };
  onReveal(listener: (panelId: string) => void): { dispose(): void };
}

/**
 * Own balanced panel-command subscriptions while callers retain event names,
 * payload mapping, membership, titles, layout policy, and concrete Dock APIs.
 */
export function installDockPanelCommandSubscriptions(
  source: DockPanelCommandSubscriptionSource,
  commands: DockPanelCommands,
): () => void {
  const subscriptions: Array<{ dispose(): void }> = [];
  let active = true;

  const cleanup = () => {
    if (!active) return;
    active = false;
    while (subscriptions.length > 0) {
      try { subscriptions.pop()?.dispose(); } catch { /* cleanup continues */ }
    }
  };
  const route = (command: (panelId: string) => boolean) => (panelId: string) => {
    if (!active) return;
    try { command(panelId); } catch { /* command failure must not break source dispatch */ }
  };

  try {
    subscriptions.push(source.onOpen(route((id) => commands.open(id))));
    subscriptions.push(source.onClose(route((id) => commands.close(id))));
    subscriptions.push(source.onFocus(route((id) => commands.focus(id))));
    subscriptions.push(source.onReveal(route((id) => commands.reveal(id))));
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}

export interface DockLayoutPanelControlAdapter {
  isOpen(panelId: string): boolean;
  close(panelId: string): void;
  reopen(panelId: string): void;
}

export interface DockLayoutPanelControl {
  /** Project whether the live Dock currently contains the panel. */
  isOpen(panelId: string): boolean;
  /** Close an open panel or reopen a closed panel. Returns false when the adapter fails. */
  toggle(panelId: string): boolean;
}

/** Own product-neutral panel projection and close-vs-reopen selection for a layout control. */
export function createDockLayoutPanelControl(
  adapter: DockLayoutPanelControlAdapter,
): DockLayoutPanelControl {
  const readOpen = (panelId: string): { ok: true; value: boolean } | { ok: false } => {
    try {
      return { ok: true, value: adapter.isOpen(panelId) };
    } catch {
      return { ok: false };
    }
  };

  return {
    isOpen(panelId) {
      const result = readOpen(panelId);
      return result.ok ? result.value : false;
    },
    toggle(panelId) {
      const result = readOpen(panelId);
      if (!result.ok) return false;
      try {
        if (result.value) adapter.close(panelId);
        else adapter.reopen(panelId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface DockLayoutControlSnapshot<Anchor> {
  readonly open: boolean;
  readonly anchor: Anchor | null;
}

export interface DockLayoutControlState<Anchor> {
  getSnapshot(): DockLayoutControlSnapshot<Anchor>;
  subscribe(listener: () => void): () => void;
  /** Publish a fresh snapshot after the live Dock projection changes. */
  refresh(): void;
  /** Toggle visibility and preserve the previous anchor when none is supplied. */
  toggle(anchor?: Anchor): void;
  /** Close without publishing a duplicate snapshot when already closed. */
  close(): void;
}

/** Own stable external-store state for a product-presented Dock layout control. */
export function createDockLayoutControlState<Anchor>(
  initialAnchor: Anchor | null = null,
): DockLayoutControlState<Anchor> {
  let snapshot: DockLayoutControlSnapshot<Anchor> = { open: false, anchor: initialAnchor };
  const listeners = new Set<() => void>();

  const commit = (open: boolean, anchor: Anchor | null, force = false): void => {
    if (!force && snapshot.open === open && snapshot.anchor === anchor) return;
    snapshot = { open, anchor };
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* one consumer must not block the others */ }
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    refresh: () => commit(snapshot.open, snapshot.anchor, true),
    toggle: (anchor) => commit(
      !snapshot.open,
      anchor === undefined ? snapshot.anchor : anchor,
    ),
    close: () => commit(false, snapshot.anchor),
  };
}

export interface DockLayoutControlToggleSource<Anchor> {
  onToggle(listener: (anchor?: Anchor) => void): { dispose(): void };
}

/** Own one layout-control toggle subscription while product callers map events and payloads. */
export function installDockLayoutControlToggle<Anchor>(
  source: DockLayoutControlToggleSource<Anchor>,
  state: Pick<DockLayoutControlState<Anchor>, 'toggle'>,
): () => void {
  let active = true;
  const subscription = source.onToggle((anchor) => {
    if (!active) return;
    try { state.toggle(anchor); } catch { /* state consumer failure stays isolated */ }
  });

  return () => {
    if (!active) return;
    active = false;
    try { subscription.dispose(); } catch { /* cleanup remains best-effort */ }
  };
}

export type SideEdge = 'left' | 'right';

export interface RectLike {
  left: number;
  right: number;
}

export function isOnSideEdge(location: { type: string; position?: string }): boolean {
  return location.type === 'edge'
    && (location.position === 'left' || location.position === 'right');
}

export function nearerSideEdge(panel: RectLike, shell: RectLike): SideEdge {
  const middle = (panel.left + panel.right) / 2;
  return middle - shell.left <= shell.right - middle ? 'left' : 'right';
}

type DropPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';
type Direction = 'left' | 'right' | 'above' | 'below' | 'within';

interface AddPanelPosition {
  referenceGroup?: unknown;
  direction?: Direction;
}

export interface CrossInstanceDropEvent {
  readonly api: DockviewApiLike & {
    addPanel(options: {
      id: string;
      component: string;
      title?: string;
      position?: AddPanelPosition;
    }): unknown;
  };
  readonly position?: DropPosition;
  readonly group?: unknown;
  getData(): { readonly viewId: string; readonly panelId: string | null } | undefined;
}

function toDirection(position: DropPosition | undefined): Direction | undefined {
  switch (position) {
    case 'top': return 'above';
    case 'bottom': return 'below';
    case 'left': return 'left';
    case 'right': return 'right';
    case 'center': return 'within';
    default: return undefined;
  }
}

export function handleCrossInstanceDrop(
  event: CrossInstanceDropEvent,
  targetRegion: DockRegion,
  moveTo: (panelId: string, region: DockRegion) => void,
  options?: {
    componentFor?: (panelId: string) => string;
    titleFor?: (panelId: string) => string | undefined;
  },
): void {
  const transfer = event.getData();
  if (!transfer?.panelId || transfer.viewId === event.api.id) return;

  const sourceApi = getDockviewApi(transfer.viewId);
  if (sourceApi) {
    try { sourceApi.getPanel(transfer.panelId)?.api.close(); } catch { /* source already closed */ }
  }

  const direction = toDirection(event.position);
  let position: AddPanelPosition | undefined;
  if (event.group && direction) {
    position = { referenceGroup: event.group, direction };
  } else if (direction && direction !== 'within') {
    position = { direction };
  }

  try {
    event.api.addPanel({
      id: transfer.panelId,
      component: options?.componentFor?.(transfer.panelId) ?? transfer.panelId,
      title: options?.titleFor?.(transfer.panelId),
      ...(position ? { position } : {}),
    });
  } catch { /* target already contains the panel or rejected the add */ }

  moveTo(transfer.panelId, targetRegion);
}
