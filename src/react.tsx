import { createElement, type HTMLAttributes, type ReactElement } from 'react';
export { useApplicationDialogRequest } from './application-dialog-host';

export {
  createIntervalTaskLifecycle,
  type IntervalTaskLifecycle,
  type IntervalTaskLifecycleOptions,
} from './interval-task';

export {
  createSettledPollingLifecycle,
  type SettledPollingLifecycle,
  type SettledPollingLifecycleOptions,
} from './settled-polling';

export {
  SlotDebugOverlay,
  hashSlotHue,
  isSlotDebugEnabled,
} from './slot-debug';

export {
  ApplicationRecoveryBoundary,
  type ApplicationRecoveryBoundaryProps,
  type ApplicationRecoveryMessages,
} from './application-recovery';

export {
  AnchoredResizeHandle,
  ResizeHandle,
  applyAnchoredResizeDelta,
  beginAnchoredResize,
  createPersistentSizeStore,
  installThresholdPointerDragSession,
  installPointerDragSession,
  useLocalSize,
  usePersistentSizeStore,
  type AnchoredResizeDirection,
  type AnchoredResizeHandleProps,
  type AnchoredResizeSession,
  type PersistentSizeStorage,
  type PersistentSizeStore,
  type PersistentSizeStoreOptions,
  type PersistentSizeUpdate,
  type PointerDragFinishReason,
  type PointerDragSessionOptions,
  type ResizeHandleProps,
  type ThresholdPointerDragFinishReason,
  type ThresholdPointerDragSession,
  type ThresholdPointerDragSessionOptions,
} from './resize';

export {
  installPointerReorderSession,
  type PointerReorderFinishReason,
  type PointerReorderSession,
  type PointerReorderSessionOptions,
} from './pointer-reorder';

export {
  useTabCloseInteractions,
  type TabCloseInteractions,
  type TabCloseInteractionsOptions,
} from './tab-close';

export {
  useLiveTabTitle,
  type LiveTabTitleSource,
} from './tab-title';

export {
  useLiveTabPlacement,
  type LiveTabPlacement,
  type LiveTabPlacementSource,
} from './tab-placement';

export {
  useTabPinnedState,
  type TabPinnedStateSource,
} from './tab-pinned-state';

export {
  DockTabAction,
  DockTabFrame,
  DockTabIcon,
  DockTabTitle,
  type DockTabActionProps,
  type DockTabFrameProps,
  type DockTabIconProps,
  type DockTabTitleProps,
} from './dock-tab-frame';

export {
  DockTabStatusSummary,
  type DockTabStatusSummaryItem,
  type DockTabStatusSummaryProps,
  type DockTabStatusTone,
} from './dock-tab-status-summary';
export {
  OWNED_INTERACTION_SURFACE_SELECTOR,
  isDismissExemptInteractionTarget,
} from './dismiss-exemption';
export {
  installOutsideDismissLifecycle,
  type OutsideDismissEventTarget,
  type OutsideDismissLifecycleOptions,
  type OutsideDismissReason,
} from './outside-dismiss';
export {
  installBoundedFrameRetryLifecycle,
  type BoundedFrameRetryLifecycleOptions,
} from './frame-retry';
export {
  createCoalescedFrameTaskLifecycle,
  type CoalescedFrameTaskLifecycle,
  type CoalescedFrameTaskLifecycleOptions,
} from './coalesced-frame-task';
export {
  createRestartableTimeoutTaskLifecycle,
  type RestartableTimeoutTaskLifecycle,
  type RestartableTimeoutTaskLifecycleOptions,
} from './restartable-timeout-task';
export {
  installDragPresenceLifecycle,
  type DragPresenceEventTarget,
  type DragPresenceLifecycleOptions,
} from './drag-presence';
export {
  installViewportResizeObservation,
  type ViewportResizeEventTarget,
  type ViewportResizeObservationOptions,
} from './viewport-resize';
export {
  installViewportScrollObservation,
  type ViewportScrollEventTarget,
  type ViewportScrollObservationOptions,
} from './viewport-scroll';
export {
  installElementResizeObservation,
  type ElementResizeObservationOptions,
  type ElementResizeObserver,
} from './element-resize-observation';
export {
  installMutationObservation,
  type DomMutationListener,
  type DomMutationObserver,
  type MutationObservationOptions,
} from './mutation-observation';
export {
  installCustomEventObservation,
  type CustomEventObservationOptions,
  type CustomEventObservationTarget,
} from './custom-event-observation';
export {
  installWindowMessageObservation,
  type WindowMessageEventTarget,
  type WindowMessageObservationOptions,
} from './window-message-observation';
export {
  installStorageObservation,
  type StorageEventTarget,
  type StorageObservationOptions,
} from './storage-observation';
export {
  installEventSourceObservation,
  type EventSourceMessageListener,
  type EventSourceObservationOptions,
  type EventSourceObservationSource,
} from './event-source-observation';
export {
  installKeydownObservation,
  type KeydownEventTarget,
  type KeydownObservationOptions,
} from './keydown-observation';
export {
  installCaptureInteractionObservation,
  type CaptureInteractionEventTarget,
  type CaptureInteractionObservationOptions,
} from './capture-interaction-observation';
export {
  createReplaceableObservationSetLifecycle,
  type ReplaceableObservationSetLifecycle,
  type ReplaceableObservationSetOptions,
  type ReplaceableObservationSubscription,
} from './replaceable-observation-set';
export {
  installPanelMembershipObservation,
  type PanelMembershipObservationOptions,
  type PanelMembershipObservationSubscription,
} from './panel-membership-observation';
export {
  installActivePanelObservation,
  type ActivePanelObservationOptions,
  type ActivePanelObservationSubscription,
} from './active-panel-observation';
export {
  installLayoutFromJsonObservation,
  type LayoutFromJsonObservationOptions,
  type LayoutFromJsonObservationSubscription,
} from './layout-from-json-observation';
export {
  installWillDropObservation,
  type WillDropObservationOptions,
  type WillDropObservationSubscription,
} from './will-drop-observation';

export {
  PanelEmptyState,
  PanelSurface,
  type PanelContentPadding,
  type PanelContentPolicy,
  type PanelContentScroll,
  type PanelContentTone,
  type PanelEmptyStateProps,
  type PanelSurfaceProps,
} from './panel';

export {
  DetachedPanelBoundary,
  type DetachedPanelBoundaryProps,
} from './detached-panel';

export {
  DetachedSurfaceFrame,
  DetachedSurfaceStatus,
  type DetachedSurfaceFrameProps,
  type DetachedSurfaceStatusProps,
  type DetachedSurfaceStatusTone,
} from './detached-surface-frame';

export {
  SurfacePlaceholder,
  type SurfacePlaceholderProps,
} from './surface-placeholder';

export {
  SurfaceRegion,
  type SurfaceRegionProps,
} from './surface-region';

export {
  useDockLayoutControlBinding,
  type DockLayoutControlBinding,
  type DockLayoutControlBindingOptions,
} from './dock-layout-control';

export {
  FloatingMenu,
  type FloatingMenuAnchor,
  type FloatingMenuPoint,
  type FloatingMenuProps,
} from './floating-menu';
export {
  DockLayoutMenu,
  type DockLayoutMenuPanel,
  type DockLayoutMenuProps,
} from './dock-layout-menu';

export type ShellSlotElement = 'aside' | 'div' | 'main' | 'section';

export interface ShellSlotProps extends HTMLAttributes<HTMLElement> {
  as?: ShellSlotElement;
  name: string;
}

/** Structural shell marker that preserves the caller's semantic element. */
export function ShellSlot({
  as = 'div',
  name,
  ...props
}: ShellSlotProps): ReactElement {
  return createElement(as, { ...props, 'data-fx-slot': name });
}
