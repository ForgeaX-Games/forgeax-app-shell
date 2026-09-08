import { createIntervalTaskLifecycle, type IntervalTaskLifecycle } from './interval-task';

export type SurfacePane = 'left' | 'center';
export type SurfaceKind = 'plugin' | 'panel';

/** Structural identity shared by in-window and detached surface carriers. */
export interface SurfaceDescriptor {
  readonly kind: SurfaceKind;
  readonly id: string;
  readonly pane?: SurfacePane;
  readonly instance?: string;
}

/** Complete carrier-neutral declaration for opening one detached surface. */
export interface DetachedWindowTarget {
  readonly surface: SurfaceDescriptor;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly dockBehavior: 'close' | 'keep-anchor';
}

/** Presence of this factory declares that a surface may be detached. */
export interface DetachedWindowCapability<Context = void> {
  createTarget(context: Context): DetachedWindowTarget;
}

export interface DetachWindowOptions {
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly x?: number;
  readonly y?: number;
}

export interface WindowManager {
  canDetach(): boolean;
  openSurfaceWindow(surface: SurfaceDescriptor, options?: DetachWindowOptions): Promise<boolean>;
  closeSurfaceWindow(surface: SurfaceDescriptor): Promise<void>;
  isSurfaceWindowOpen(surface: SurfaceDescriptor): Promise<boolean>;
  onSurfaceWindowClosed(listener: (surface: SurfaceDescriptor) => void): () => void;
}

export interface BrowserPopupWindow {
  readonly closed: boolean;
  focus(): void;
  close(): void;
}

export interface BrowserWindowHost {
  readonly screen: { readonly width: number; readonly height: number };
  open(url: string, target: string, features: string): BrowserPopupWindow | null;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CreateBrowserWindowManagerOptions {
  readonly surfaceUrl: (surface: SurfaceDescriptor) => string;
  readonly host?: BrowserWindowHost;
  readonly closePollIntervalMs?: number;
}

/** Product-neutral handle implemented by event-driven native window adapters. */
export interface ExternalWindowHandle {
  show(): void | Promise<void>;
  focus(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface ExternalWindowLifecycle {
  created(): void;
  error(): void;
  destroyed(): void;
}

/** Adapter seam: products retain native API loading and concrete create policy. */
export interface ExternalWindowHost {
  getByLabel(label: string): Promise<ExternalWindowHandle | null>;
  create(
    label: string,
    surface: SurfaceDescriptor,
    options: DetachWindowOptions | undefined,
    lifecycle: ExternalWindowLifecycle,
  ): Promise<ExternalWindowHandle>;
}

export interface CreateExternalWindowManagerOptions {
  readonly canDetach: () => boolean;
  readonly loadHost: () => Promise<ExternalWindowHost | undefined>;
  readonly createdTimeoutMs?: number;
}

export interface OpenPanelWindowOptions {
  readonly detachSurface: (
    surface: SurfaceDescriptor,
    options: Required<Pick<DetachWindowOptions, 'title' | 'width' | 'height'>>
      & Pick<DetachWindowOptions, 'x' | 'y'>,
  ) => Promise<boolean>;
  readonly position?: Readonly<Pick<DetachWindowOptions, 'x' | 'y'>>;
  readonly closeDockPanel?: () => void;
}

export interface PanelWindowingController {
  openPanelWindow(
    panelId: string,
    capability: DetachedWindowCapability | undefined,
    options: OpenPanelWindowOptions,
  ): Promise<boolean>;
  panelForClosedSurface(surface: SurfaceDescriptor): string | undefined;
}

export interface CreateSurfaceWindowingControllerOptions {
  readonly manager: WindowManager;
  readonly beforeDetach?: (surface: SurfaceDescriptor) => void;
}

export interface SurfaceWindowingController {
  snapshot(): Readonly<Record<string, true>>;
  onChange(listener: () => void): () => void;
  detachSurface(surface: SurfaceDescriptor, options?: DetachWindowOptions): Promise<boolean>;
  redockSurface(surface: SurfaceDescriptor): Promise<void>;
  markSurfaceDocked(surface: SurfaceDescriptor): void;
}

export interface EdgePinStore {
  snapshot(): Readonly<Record<string, string>>;
  onChange(listener: () => void): () => void;
  pinnedIn(groupId: string): string | undefined;
  setPinned(groupId: string, panelId: string | undefined): void;
  clear(): void;
}

/** Product-neutral state for one mutually-exclusive pinned item per edge group. */
export function createEdgePinStore(): EdgePinStore {
  const emptySnapshot = Object.freeze({}) as Readonly<Record<string, string>>;
  const pinnedByGroup = new Map<string, string>();
  const listeners = new Set<() => void>();
  let snapshot: Readonly<Record<string, string>> = emptySnapshot;

  const publish = (): void => {
    snapshot = pinnedByGroup.size === 0
      ? emptySnapshot
      : Object.freeze(Object.fromEntries([...pinnedByGroup.entries()].sort(([a], [b]) => a.localeCompare(b))));
    for (const listener of listeners) {
      try { listener(); } catch { /* one observer cannot block state convergence */ }
    }
  };

  return {
    snapshot: () => snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    pinnedIn: (groupId) => pinnedByGroup.get(groupId),
    setPinned(groupId, panelId) {
      if (panelId === undefined) {
        if (!pinnedByGroup.delete(groupId)) return;
      } else {
        if (pinnedByGroup.get(groupId) === panelId) return;
        pinnedByGroup.set(groupId, panelId);
      }
      publish();
    },
    clear() {
      if (pinnedByGroup.size === 0) return;
      pinnedByGroup.clear();
      publish();
    },
  };
}

export function canOpenPanelWindow(
  capability: DetachedWindowCapability | undefined,
  carrierAvailable: boolean,
): capability is DetachedWindowCapability {
  return capability !== undefined && carrierAvailable;
}

export function shouldShowDetachedPlaceholder(
  floatingSurfaces: Readonly<Record<string, true>>,
  surface: SurfaceDescriptor,
): boolean {
  return floatingSurfaces[surfaceKey(surface)] === true;
}

/** Product-neutral transaction joining a dock placement to a detached carrier. */
export function createPanelWindowingController(): PanelWindowingController {
  const detachedPanels = new Map<string, { panelId: string; state: 'pending' | 'leased' }>();

  return {
    async openPanelWindow(panelId, capability, options) {
      if (!capability) return false;

      let target: DetachedWindowTarget;
      try {
        target = capability.createTarget();
      } catch {
        return false;
      }

      const key = surfaceKey(target.surface);
      const closesPlacement = target.dockBehavior === 'close';
      let reservation: { panelId: string; state: 'pending' | 'leased' } | undefined;
      if (closesPlacement) {
        if (!options.closeDockPanel || detachedPanels.has(key)) return false;
        reservation = { panelId, state: 'pending' };
        detachedPanels.set(key, reservation);
      }

      let opened: boolean;
      try {
        opened = await options.detachSurface(target.surface, {
          title: target.title,
          width: target.width,
          height: target.height,
          ...options.position,
        });
      } catch {
        if (reservation && detachedPanels.get(key) === reservation) detachedPanels.delete(key);
        return false;
      }
      if (!opened) {
        if (reservation && detachedPanels.get(key) === reservation) detachedPanels.delete(key);
        return false;
      }

      if (closesPlacement) {
        if (detachedPanels.get(key) !== reservation) return false;
        try {
          options.closeDockPanel!();
        } catch {
          if (detachedPanels.get(key) === reservation) detachedPanels.delete(key);
          return false;
        }
        reservation!.state = 'leased';
      }
      return true;
    },

    panelForClosedSurface(surface) {
      const key = surfaceKey(surface);
      const lease = detachedPanels.get(key);
      if (lease?.state === 'pending') {
        detachedPanels.delete(key);
        return undefined;
      }
      if (lease?.state === 'leased') {
        queueMicrotask(() => {
          if (detachedPanels.get(key) === lease) detachedPanels.delete(key);
        });
      }
      return lease?.state === 'leased' ? lease.panelId : undefined;
    },
  };
}

/** Product-neutral state machine joining floating presentation to a carrier. */
export function createSurfaceWindowingController(
  options: CreateSurfaceWindowingControllerOptions,
): SurfaceWindowingController {
  const emptySnapshot = Object.freeze({}) as Readonly<Record<string, true>>;
  const floating = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: Readonly<Record<string, true>> = emptySnapshot;

  const publish = (): void => {
    snapshot = floating.size === 0
      ? emptySnapshot
      : Object.freeze(Object.fromEntries([...floating].sort().map((key) => [key, true as const])));
    for (const listener of listeners) {
      try { listener(); } catch { /* one observer cannot block state convergence */ }
    }
  };
  const markFloating = (surface: SurfaceDescriptor): void => {
    const key = surfaceKey(surface);
    if (floating.has(key)) return;
    floating.add(key);
    publish();
  };
  const markDocked = (surface: SurfaceDescriptor): void => {
    if (!floating.delete(surfaceKey(surface))) return;
    publish();
  };

  return {
    snapshot: () => snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async detachSurface(surface, detachOptions) {
      if (!options.manager.canDetach()) return false;
      try {
        options.beforeDetach?.(surface);
      } catch {
        return false;
      }
      markFloating(surface);
      let opened = false;
      try {
        opened = await options.manager.openSurfaceWindow(surface, detachOptions);
      } catch {
        opened = false;
      }
      if (!opened) markDocked(surface);
      return opened;
    },
    async redockSurface(surface) {
      await options.manager.closeSurfaceWindow(surface);
      markDocked(surface);
    },
    markSurfaceDocked: markDocked,
  };
}

function currentBrowserHost(): BrowserWindowHost | undefined {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return undefined;
  return {
    screen: window.screen,
    open: (url, target, features) => window.open(url, target, features),
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (handle) => window.clearInterval(handle as number),
  };
}

/** Product-neutral browser popup carrier with injected surface URL policy. */
export function createBrowserWindowManager(
  options: CreateBrowserWindowManagerOptions,
): WindowManager {
  const host = options.host ?? currentBrowserHost();
  const windows = new Map<string, BrowserPopupWindow>();
  const closePolls = new Map<string, IntervalTaskLifecycle>();
  const closeListeners = new Set<(surface: SurfaceDescriptor) => void>();

  const forget = (surface: SurfaceDescriptor): void => {
    const key = surfaceWindowLabel(surface);
    const poll = closePolls.get(key);
    closePolls.delete(key);
    windows.delete(key);
    poll?.dispose();
  };
  const notifyClosed = (surface: SurfaceDescriptor): void => {
    for (const listener of closeListeners) {
      try { listener(surface); } catch { /* one listener cannot block the others */ }
    }
  };

  return {
    canDetach: () => host !== undefined,
    async openSurfaceWindow(surface, detachOptions) {
      if (!host) return false;
      const label = surfaceWindowLabel(surface);
      const existing = windows.get(label);
      if (existing !== undefined && !existing.closed) {
        existing.focus();
        return true;
      }
      if (existing !== undefined) {
        forget(surface);
        // Injected cleanup can synchronously open a replacement for this identity.
        const replacement = windows.get(label);
        if (replacement !== undefined) {
          if (replacement.closed) return false;
          replacement.focus();
          return true;
        }
      }
      const width = detachOptions?.width ?? 960;
      const height = detachOptions?.height ?? 720;
      const left = detachOptions?.x ?? Math.max(0, Math.round((host.screen.width - width) / 2));
      const top = detachOptions?.y ?? Math.max(0, Math.round((host.screen.height - height) / 2));
      const popup = host.open(
        options.surfaceUrl(surface),
        label,
        `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes`,
      );
      if (popup === null) return false;
      windows.set(label, popup);
      const poll = createIntervalTaskLifecycle({
        intervalMs: options.closePollIntervalMs ?? 250,
        setInterval: (callback, delay) => host.setInterval(callback, delay),
        clearInterval: (handle) => host.clearInterval(handle),
        task: () => {
          if (!popup.closed) return;
          forget(surface);
          notifyClosed(surface);
        },
      });
      closePolls.set(label, poll);
      poll.start();
      return true;
    },
    async closeSurfaceWindow(surface) {
      const popup = windows.get(surfaceWindowLabel(surface));
      if (popup !== undefined && !popup.closed) popup.close();
      forget(surface);
    },
    async isSurfaceWindowOpen(surface) {
      const popup = windows.get(surfaceWindowLabel(surface));
      return popup !== undefined && !popup.closed;
    },
    onSurfaceWindowClosed(listener) {
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
  };
}

/** Event-driven external-window lifecycle with all native policy injected. */
export function createExternalWindowManager(
  options: CreateExternalWindowManagerOptions,
): WindowManager {
  const closeListeners = new Set<(surface: SurfaceDescriptor) => void>();
  const notifyClosed = (surface: SurfaceDescriptor): void => {
    for (const listener of closeListeners) {
      try { listener(surface); } catch { /* one listener cannot block the others */ }
    }
  };

  return {
    canDetach: options.canDetach,
    async openSurfaceWindow(surface, detachOptions) {
      const host = await options.loadHost();
      if (!host) return false;
      const label = surfaceWindowLabel(surface);
      const existing = await host.getByLabel(label);
      if (existing) {
        try {
          await existing.show();
          await existing.focus();
          return true;
        } catch {
          /* window vanished between lookup and focus — replace it below */
        }
      }

      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (result: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };
        const timeout = setTimeout(() => finish(true), options.createdTimeoutMs ?? 2000);
        void host.create(label, surface, detachOptions, {
          created: () => finish(true),
          error: () => finish(false),
          destroyed: () => notifyClosed(surface),
        }).catch(() => finish(false));
      });
    },
    async closeSurfaceWindow(surface) {
      const host = await options.loadHost();
      if (!host) return;
      const existing = await host.getByLabel(surfaceWindowLabel(surface));
      if (!existing) return;
      try {
        await existing.close();
      } catch {
        /* already gone */
      }
    },
    async isSurfaceWindowOpen(surface) {
      const host = await options.loadHost();
      if (!host) return false;
      return (await host.getByLabel(surfaceWindowLabel(surface))) !== null;
    },
    onSurfaceWindowClosed(listener) {
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
  };
}

/** Stable identity shared by keep-alive registries and physical carriers. */
export function surfaceKey(surface: SurfaceDescriptor): string {
  const id = surface.id.includes(':') || surface.id.startsWith('~')
    ? `~${encodeURIComponent(surface.id)}`
    : surface.id;
  const pane = surface.pane ? `:${surface.pane}` : '';
  const instance = surface.instance ? `:instance=${encodeURIComponent(surface.instance)}` : '';
  return `${surface.kind}:${id}${pane}${instance}`;
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64URL_ALPHABET[first >> 2];
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) encoded += BASE64URL_ALPHABET[third & 0x3f];
  }
  return encoded;
}

/** Deterministic, injective and carrier-safe label for the complete identity. */
export function surfaceWindowLabel(surface: SurfaceDescriptor): string {
  return `fx-surface-${utf8ToBase64Url(surfaceKey(surface))}`;
}

/** Encode only structural surface identity; product carrier policy stays outside. */
export function encodeSurfaceQuery(surface: SurfaceDescriptor): string {
  const params = new URLSearchParams();
  params.set('surface', surface.kind);
  params.set('id', surface.id);
  if (surface.pane) params.set('pane', surface.pane);
  if (surface.instance) params.set('instance', surface.instance);
  return params.toString();
}

/** Decode structural identity, or null for a normal shell/invalid entry. */
export function decodeSurfaceFromLocation(search: string = typeof window !== 'undefined' ? window.location.search : ''): SurfaceDescriptor | null {
  const params = new URLSearchParams(search);
  const kind = params.get('surface');
  const id = params.get('id');
  if (!id || (kind !== 'plugin' && kind !== 'panel')) return null;
  const pane = params.get('pane');
  const instance = params.get('instance');
  return {
    kind,
    id,
    pane: pane === 'left' || pane === 'center' ? pane : undefined,
    instance: instance || undefined,
  };
}
