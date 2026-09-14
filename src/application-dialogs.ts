import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface AlertOptions {
  title?: string;
  body?: ReactNode;
  okText?: string;
}

export type UnsavedChangesDecision = 'save' | 'discard' | 'cancel';

export interface UnsavedChangesOptions {
  title?: string;
  body?: ReactNode;
  saveText?: string;
  discardText?: string;
  cancelText?: string;
}

export type ApplicationDialogRequest =
  | { readonly id: number; readonly kind: 'confirm' | 'alert'; readonly options: ConfirmOptions & AlertOptions }
  | { readonly id: number; readonly kind: 'unsaved'; readonly options: UnsavedChangesOptions };

export interface ApplicationDialogService {
  readonly getSnapshot: () => readonly ApplicationDialogRequest[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly alert: (options?: AlertOptions) => Promise<void>;
  readonly unsaved: (options?: UnsavedChangesOptions) => Promise<UnsavedChangesDecision>;
  readonly resolveConfirmAlert: (id: number, value: boolean) => void;
  readonly resolveUnsaved: (id: number, value: UnsavedChangesDecision) => void;
  /** Explicit teardown only; a temporary renderer unmount must not cancel requests. */
  readonly cancelAll: () => void;
}

/** Non-blocking dialog delivery. Hosts retain rendering, focus management and copy. */
export function createApplicationDialogService(): ApplicationDialogService {
  let queue: readonly ApplicationDialogRequest[] = [];
  let sequence = 0;
  const resolvers = new Map<number, (value: boolean | UnsavedChangesDecision) => void>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(); } catch { /* One failed host cannot block delivery or settlement. */ }
    }
  };
  const settle = (id: number, value: boolean | UnsavedChangesDecision) => {
    const request = queue.find((item) => item.id === id);
    if (!request || (request.kind === 'unsaved') !== (typeof value === 'string')) return;
    const resolve = resolvers.get(id);
    resolvers.delete(id);
    queue = queue.filter((item) => item.id !== id);
    emit();
    resolve?.(value);
  };
  return {
    getSnapshot: () => queue,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    confirm(options) {
      return new Promise<boolean>((resolve) => {
        const id = ++sequence;
        resolvers.set(id, (value) => resolve(value as boolean));
        queue = [...queue, { id, kind: 'confirm', options }];
        emit();
      });
    },
    alert(options = {}) {
      return new Promise<void>((resolve) => {
        const id = ++sequence;
        resolvers.set(id, () => resolve());
        queue = [...queue, { id, kind: 'alert', options }];
        emit();
      });
    },
    unsaved(options = {}) {
      return new Promise<UnsavedChangesDecision>((resolve) => {
        const id = ++sequence;
        resolvers.set(id, (value) => resolve(value as UnsavedChangesDecision));
        queue = [...queue, { id, kind: 'unsaved', options }];
        emit();
      });
    },
    resolveConfirmAlert: (id, value) => settle(id, value),
    resolveUnsaved: (id, value) => settle(id, value),
    cancelAll() {
      const pending = queue;
      const pendingResolvers = new Map(resolvers);
      queue = [];
      resolvers.clear();
      emit();
      for (const request of pending) {
        pendingResolvers.get(request.id)?.(request.kind === 'unsaved' ? 'cancel' : false);
      }
    },
  };
}

// All callers and renderers in an application import this same installed package.
// Products needing isolated dialog hosts can inject a separately created service.
export const applicationDialogs = createApplicationDialogService();
export const confirmDialog = applicationDialogs.confirm;
export const alertDialog = applicationDialogs.alert;
export const unsavedChangesDialog = applicationDialogs.unsaved;
