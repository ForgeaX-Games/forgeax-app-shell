import { Fragment, type ReactNode } from 'react';
import type { DockLayoutControlState, DockLayoutControlToggleSource } from './dock';
import { useDockLayoutControlBinding } from './dock-layout-control';
import { FloatingMenu, type FloatingMenuAnchor } from './floating-menu';

export interface DockLayoutMenuPanel {
  readonly id: string;
  readonly title: string;
  readonly icon?: ReactNode;
}

export interface DockLayoutMenuProps<Anchor extends FloatingMenuAnchor> {
  readonly state: DockLayoutControlState<Anchor>;
  readonly onToggle: DockLayoutControlToggleSource<Anchor>['onToggle'];
  readonly isPanelOpen: (panelId: string) => boolean;
  readonly closePanel: (panelId: string) => void;
  readonly reopenPanel: (panelId: string) => void;
  readonly onReset: () => void;
  readonly resetLabel: ReactNode;
  readonly sectionLabel: ReactNode;
  readonly emptyLabel: ReactNode;
  readonly resetIcon?: ReactNode;
  readonly panels: readonly DockLayoutMenuPanel[];
  readonly renderPanelActions?: (panel: DockLayoutMenuPanel) => ReactNode;
}

/**
 * Product-neutral Dock layout-menu composition.
 *
 * Consumers inject copy, icons, reset policy and concrete panel adapters while
 * App Shell owns the stable binding, carrier, row semantics and structure.
 */
export function DockLayoutMenu<Anchor extends FloatingMenuAnchor>({
  state,
  onToggle,
  isPanelOpen,
  closePanel,
  reopenPanel,
  onReset,
  resetLabel,
  sectionLabel,
  emptyLabel,
  resetIcon,
  panels,
  renderPanelActions,
}: DockLayoutMenuProps<Anchor>) {
  const { snapshot, panelControl } = useDockLayoutControlBinding({
    state,
    onToggle,
    isPanelOpen,
    closePanel,
    reopenPanel,
  });

  return (
    <FloatingMenu
      open={snapshot.open}
      onClose={state.close}
      anchor={snapshot.anchor}
      align="end"
      className="fx-dl-menu"
    >
      <button
        type="button"
        role="menuitem"
        data-app-shell-dock-layout-reset=""
        className="fx-dl-item fx-dl-reset"
        onClick={() => {
          try { onReset(); } finally { state.close(); }
        }}
      >
        {resetIcon ? <span aria-hidden="true">{resetIcon}</span> : null}
        {resetLabel}
      </button>
      <div className="fx-dl-sep" role="separator" />
      <div className="fx-dl-head">{sectionLabel}</div>
      {panels.length === 0 ? (
        <div className="fx-dl-head" data-app-shell-dock-layout-empty="">{emptyLabel}</div>
      ) : panels.map((panel) => {
        const isOpen = panelControl.isOpen(panel.id);
        return (
          <Fragment key={panel.id}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={isOpen}
            className={`fx-dl-item${isOpen ? ' on' : ''}`}
            onClick={() => { panelControl.toggle(panel.id); }}
          >
            <span className="fx-dl-check" aria-hidden="true">{isOpen ? '✓' : '＋'}</span>
            {panel.icon ? <span className="fx-dl-icon" aria-hidden="true">{panel.icon}</span> : null}
            {panel.title}
          </button>
          {renderPanelActions?.(panel)}
          </Fragment>
        );
      })}
    </FloatingMenu>
  );
}
