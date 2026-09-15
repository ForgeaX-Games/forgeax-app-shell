import type { ApplicationShortcut, ApplicationShortcutRegistry } from './application-shortcuts';
import type { ContextualKeybindingsApi } from './contextual-keybindings';
import { installKeydownObservation, type KeydownEventTarget } from './keydown-observation';

export type ApplicationKeydownHandler = (event: KeyboardEvent) => boolean;

// One realm-wide interaction registry, also used by compatibility entry points.
const transientHandlers = new Set<ApplicationKeydownHandler>();

export function registerApplicationKeydownHandler(handler: ApplicationKeydownHandler): () => void {
  transientHandlers.add(handler);
  return () => { transientHandlers.delete(handler); };
}

export function dispatchApplicationKeydownHandlers(event: KeyboardEvent): boolean {
  for (const handler of [...transientHandlers]) {
    if (handler(event)) return true;
  }
  return false;
}

export function isApplicationKeyComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229 || event.key === 'Process';
}

export interface ApplicationKeyboardRouterOptions {
  readonly target?: KeydownEventTarget;
  readonly keybindings: Pick<ContextualKeybindingsApi, 'handle'>;
  readonly contributions: ApplicationShortcutRegistry;
  readonly shortcuts: readonly ApplicationShortcut[];
  /** Product input surfaces are tested at event time, before matching. */
  readonly isTypingTarget: (event: KeyboardEvent) => boolean;
  /** Product classification/visibility policy; no product selectors live here. */
  readonly shouldSkipShortcut: (event: KeyboardEvent, shortcut: ApplicationShortcut) => boolean;
}

/** The single capture router: transient interaction, contextual command, then
 * live application contributions. The caller owns installation and policy. */
export function installApplicationKeyboardRouter(options: ApplicationKeyboardRouterOptions): () => void {
  return installKeydownObservation({
    target: options.target,
    capture: true,
    onKeyDown(event) {
      if (isApplicationKeyComposing(event)) return;
      if (dispatchApplicationKeydownHandlers(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const contextual = options.keybindings.handle(event);
      if (contextual?.status === 'handled' || contextual?.status === 'claimed-disabled') return;
      const ordered = [...options.shortcuts, ...options.contributions.snapshot()].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      );
      for (const shortcut of ordered) {
        if (options.shouldSkipShortcut(event, shortcut)) continue;
        if (options.isTypingTarget(event) && !shortcut.allowInInput) continue;
        if (!shortcut.match(event)) continue;
        if (shortcut.run(event) !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
    },
  });
}
