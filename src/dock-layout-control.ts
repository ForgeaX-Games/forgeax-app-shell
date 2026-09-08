import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  createDockLayoutPanelControl,
  installDockLayoutControlToggle,
  type DockLayoutControlSnapshot,
  type DockLayoutControlState,
  type DockLayoutPanelControl,
  type DockLayoutControlToggleSource,
} from './dock';

export interface DockLayoutControlBindingOptions<Anchor> {
  state: DockLayoutControlState<Anchor>;
  onToggle: DockLayoutControlToggleSource<Anchor>['onToggle'];
  isPanelOpen(panelId: string): boolean;
  closePanel(panelId: string): void;
  reopenPanel(panelId: string): void;
}

export interface DockLayoutControlBinding<Anchor> {
  readonly snapshot: DockLayoutControlSnapshot<Anchor>;
  readonly panelControl: DockLayoutPanelControl;
}

/** Bind the product-neutral layout-control state, toggle source, and live panel projection to React. */
export function useDockLayoutControlBinding<Anchor>({
  state,
  onToggle,
  isPanelOpen,
  closePanel,
  reopenPanel,
}: DockLayoutControlBindingOptions<Anchor>): DockLayoutControlBinding<Anchor> {
  const snapshot = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    state.getSnapshot,
  );

  useEffect(() => installDockLayoutControlToggle({ onToggle }, state), [onToggle, state]);

  const panelControl = useMemo(() => createDockLayoutPanelControl({
    isOpen: isPanelOpen,
    close: closePanel,
    reopen: reopenPanel,
  }), [closePanel, isPanelOpen, reopenPanel]);

  return useMemo(() => ({ snapshot, panelControl }), [panelControl, snapshot]);
}
