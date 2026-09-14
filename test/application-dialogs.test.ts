import { describe, expect, it } from 'bun:test';
import {
  alertDialog,
  applicationDialogs,
  confirmDialog,
  createApplicationDialogService,
  unsavedChangesDialog,
} from '../src/application';

describe('application dialog service', () => {
  it('shares public callers with the host queue', async () => {
    const confirmation = confirmDialog({ body: 'Delete?' });
    const alert = alertDialog();
    const unsaved = unsavedChangesDialog();
    const [first, second, third] = applicationDialogs.getSnapshot();
    expect([first.kind, second.kind, third.kind]).toEqual(['confirm', 'alert', 'unsaved']);
    applicationDialogs.resolveConfirmAlert(first.id, false);
    applicationDialogs.resolveConfirmAlert(second.id, true);
    applicationDialogs.resolveUnsaved(third.id, 'save');
    expect(await confirmation).toBe(false);
    expect(await alert).toBeUndefined();
    expect(await unsaved).toBe('save');
    expect(applicationDialogs.getSnapshot()).toEqual([]);
  });

  it('keeps stable snapshots, FIFO ordering and caller-owned options', async () => {
    const dialogs = createApplicationDialogService();
    const empty = dialogs.getSnapshot();
    expect(dialogs.getSnapshot()).toBe(empty);
    const options = { title: 'Question', body: 'Body', confirmText: 'Proceed', danger: true };
    const first = dialogs.confirm(options);
    const snapshot = dialogs.getSnapshot();
    expect(snapshot[0].options).toBe(options);
    expect(dialogs.getSnapshot()).toBe(snapshot);
    const second = dialogs.alert({ body: 'Next' });
    expect(snapshot).toHaveLength(1);
    expect(dialogs.getSnapshot()).toHaveLength(2);
    dialogs.resolveConfirmAlert(snapshot[0].id, true);
    expect(await first).toBe(true);
    expect(dialogs.getSnapshot()[0].kind).toBe('alert');
    dialogs.resolveConfirmAlert(dialogs.getSnapshot()[0].id, false);
    expect(await second).toBeUndefined();
  });

  it('supports all unsaved outcomes and ignores stale or wrong-kind settlements', async () => {
    const dialogs = createApplicationDialogService();
    for (const decision of ['save', 'discard', 'cancel'] as const) {
      const pending = dialogs.unsaved();
      const head = dialogs.getSnapshot()[0];
      dialogs.resolveConfirmAlert(head.id, true);
      expect(dialogs.getSnapshot()[0]).toBe(head);
      dialogs.resolveUnsaved(head.id, decision);
      dialogs.resolveUnsaved(head.id, 'cancel');
      expect(await pending).toBe(decision);
    }
    const pending = dialogs.confirm({});
    const head = dialogs.getSnapshot()[0];
    dialogs.resolveUnsaved(head.id, 'discard');
    expect(dialogs.getSnapshot()[0]).toBe(head);
    dialogs.resolveConfirmAlert(head.id, false);
    expect(await pending).toBe(false);
  });

  it('balances host subscriptions without cancelling requests on host remount', async () => {
    const dialogs = createApplicationDialogService();
    let notifications = 0;
    const dispose = dialogs.subscribe(() => { notifications += 1; });
    const pending = dialogs.confirm({});
    expect(notifications).toBe(1);
    dispose();
    dispose();
    const head = dialogs.getSnapshot()[0];
    dialogs.resolveConfirmAlert(head.id, true);
    expect(await pending).toBe(true);
    expect(notifications).toBe(1);
  });

  it('cancels pending requests explicitly without reusing request identities', async () => {
    const dialogs = createApplicationDialogService();
    const confirm = dialogs.confirm({});
    const alert = dialogs.alert();
    const unsaved = dialogs.unsaved();
    const previousIds = dialogs.getSnapshot().map((request) => request.id);
    dialogs.cancelAll();
    expect(await confirm).toBe(false);
    expect(await alert).toBeUndefined();
    expect(await unsaved).toBe('cancel');
    dialogs.cancelAll();
    const next = dialogs.confirm({});
    expect(dialogs.getSnapshot()[0].id).toBeGreaterThan(Math.max(...previousIds));
    dialogs.resolveConfirmAlert(previousIds[0], true);
    expect(dialogs.getSnapshot()).toHaveLength(1);
    dialogs.cancelAll();
    expect(await next).toBe(false);
  });

  it('isolates host listener errors and independent service instances', async () => {
    const dialogs = createApplicationDialogService();
    const other = createApplicationDialogService();
    dialogs.subscribe(() => { throw new Error('detached renderer'); });
    let calls = 0;
    dialogs.subscribe(() => { calls += 1; });
    const pending = dialogs.confirm({});
    expect(other.getSnapshot()).toEqual([]);
    dialogs.resolveConfirmAlert(dialogs.getSnapshot()[0].id, true);
    expect(await pending).toBe(true);
    expect(calls).toBe(2);
  });
});
