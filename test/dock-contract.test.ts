import { afterEach, describe, expect, it } from 'bun:test';
import {
  DOCK_REGIONS,
  createDockLayoutPanelControl,
  createDockLayoutControlState,
  createDockReadyActivation,
  createDockScopeTransition,
  createDockReadyCleanup,
  replaceDockReadyAdapters,
  createDockLayoutPersistence,
  createDockPanelCommands,
  designedDockPanelPosition,
  getDockRegions,
  hasMountedPanelPlacement,
  handleCrossInstanceDrop,
  installDockLayoutObservation,
  installDockLayoutControlToggle,
  installDockLayoutReset,
  installDockPanelCommandSubscriptions,
  installDockPanelVisibilityTracking,
  isDockPanelVisible,
  isDockRegion,
  isOnSideEdge,
  nearerSideEdge,
  pruneSerializedDockLayout,
  registerDockRegion,
  registerDockviewApi,
  resolveRegion,
  trackDockPanelVisibility,
  type AuthoredDockLayoutLike,
} from '../src/dock';

describe('dock ready cleanup lifecycle', () => {
  it('disposes in reverse registration order and only once', () => {
    const disposed: string[] = [];
    const cleanup = createDockReadyCleanup();

    expect(cleanup.add(() => disposed.push('first'))).toBe(true);
    expect(cleanup.add(() => { disposed.push('second'); throw new Error('dispose failed'); })).toBe(true);
    expect(cleanup.add(() => disposed.push('third'))).toBe(true);

    expect(() => cleanup.dispose()).not.toThrow();
    expect(() => cleanup.dispose()).not.toThrow();
    expect(disposed).toEqual(['third', 'second', 'first']);
  });

  it('fences late registration by disposing it immediately', () => {
    const disposed: string[] = [];
    const cleanup = createDockReadyCleanup();
    cleanup.dispose();

    expect(cleanup.add(() => disposed.push('late'))).toBe(false);
    expect(cleanup.add(() => { disposed.push('throwing late'); throw new Error('late dispose failed'); })).toBe(false);
    expect(disposed).toEqual(['late', 'throwing late']);
  });
});

describe('dock ready adapter transaction', () => {
  it('replaces the previous session before installing the next adapters in order', () => {
    const events: string[] = [];
    const previous = replaceDockReadyAdapters(null, [
      () => { events.push('old install'); return () => events.push('old dispose'); },
    ]);

    const next = replaceDockReadyAdapters(previous, [
      () => { events.push('first install'); return () => events.push('first dispose'); },
      () => { events.push('second install'); return () => events.push('second dispose'); },
    ]);

    expect(next.installed).toBe(true);
    expect(events).toEqual(['old install', 'old dispose', 'first install', 'second install']);
    next.dispose();
    next.dispose();
    expect(events).toEqual([
      'old install', 'old dispose', 'first install', 'second install',
      'second dispose', 'first dispose',
    ]);
  });

  it('rolls back a partial transaction in reverse order and isolates disposer failures', () => {
    const events: string[] = [];
    const session = replaceDockReadyAdapters(null, [
      () => { events.push('first install'); return () => { events.push('first dispose'); throw new Error('dispose'); }; },
      () => { events.push('second install'); return () => events.push('second dispose'); },
      () => { events.push('third install'); throw new Error('install'); },
      () => { events.push('must not install'); return () => {}; },
    ]);

    expect(session.installed).toBe(false);
    expect(events).toEqual([
      'first install', 'second install', 'third install',
      'second dispose', 'first dispose',
    ]);
    expect(() => session.dispose()).not.toThrow();
  });
});

describe('dock ready activation lifecycle', () => {
  it('publishes only a successfully installed current value and revokes it on replacement failure', () => {
    const activation = createDockReadyActivation<{ id: string }>();
    const first = { id: 'first' };
    const failed = { id: 'failed' };

    expect(activation.replace(first, [() => () => {}])).toBe(true);
    expect(activation.getCurrent()).toBe(first);
    expect(activation.replace(failed, [() => { throw new Error('install'); }])).toBe(false);
    expect(activation.getCurrent()).toBeNull();
  });

  it('keeps a synchronous reentrant replacement and disposes the stale outer session', () => {
    const events: string[] = [];
    const activation = createDockReadyActivation<{ id: string }>();
    const nested = { id: 'nested' };

    expect(activation.replace({ id: 'first' }, [
      () => () => {
        events.push('old dispose');
        activation.replace(nested, [() => () => events.push('nested dispose')]);
      },
    ])).toBe(true);

    expect(activation.replace({ id: 'stale outer' }, [
      () => { events.push('outer install'); return () => events.push('outer dispose'); },
    ])).toBe(false);
    expect(activation.getCurrent()).toBe(nested);
    expect(events).toEqual(['old dispose', 'outer install', 'outer dispose']);

    activation.dispose();
    activation.dispose();
    expect(activation.getCurrent()).toBeNull();
    expect(events).toEqual(['old dispose', 'outer install', 'outer dispose', 'nested dispose']);
  });
});

describe('dock scope transition lifecycle', () => {
  it('saves the previous scope before publishing and applying the next scope', () => {
    const events: string[] = [];
    const live = { id: 'dock' };
    const transition = createDockScopeTransition<string, typeof live>({
      getLive: () => live,
      save: (value, scope) => events.push(`save:${scope}:${value.id}`),
      apply: (value, scope) => events.push(`apply:${scope ?? 'none'}:${value.id}`),
    }, 'scene');

    expect(transition.getCurrent()).toBe('scene');
    expect(transition.transition('assets')).toBe(true);
    expect(transition.getCurrent()).toBe('assets');
    expect(events).toEqual(['save:scene:dock', 'apply:assets:dock']);
  });

  it('keeps a reentrant transition current and isolates adapter failures', () => {
    const events: string[] = [];
    const live = { id: 'dock' };
    let transition: ReturnType<typeof createDockScopeTransition<string, typeof live>>;
    transition = createDockScopeTransition({
      getLive: () => live,
      save: (_value, scope) => {
        events.push(`save:${scope}`);
        if (scope === 'scene') transition.transition('nested');
      },
      apply: (_value, scope) => {
        events.push(`apply:${scope ?? 'none'}`);
        if (scope === 'throwing') throw new Error('apply failed');
      },
    }, 'scene');

    expect(transition.transition('stale')).toBe(false);
    expect(transition.getCurrent()).toBe('nested');
    expect(events).toEqual(['save:scene', 'apply:nested']);
    expect(transition.transition('throwing')).toBe(false);
    expect(transition.getCurrent()).toBe('throwing');
    expect(events).toEqual([
      'save:scene', 'apply:nested',
      'save:nested', 'apply:throwing',
    ]);
  });

  it('publishes without a live dock and can reapply the stable current scope later', () => {
    const events: string[] = [];
    let live: { id: string } | null = null;
    const transition = createDockScopeTransition<string, { id: string }>({
      getLive: () => live,
      save: () => { throw new Error('must stay lazy without a live value'); },
      apply: (value, scope) => events.push(`apply:${scope ?? 'none'}:${value.id}`),
    });

    expect(transition.transition('scene')).toBe(true);
    expect(transition.getCurrent()).toBe('scene');
    live = { id: 'dock' };
    expect(transition.applyCurrent()).toBe(true);
    expect(events).toEqual(['apply:scene:dock']);
  });

  it('drops a stale request when live resolution synchronously transitions', () => {
    const events: string[] = [];
    const live = { id: 'dock' };
    let reentered = false;
    let transition: ReturnType<typeof createDockScopeTransition<string, typeof live>>;
    transition = createDockScopeTransition({
      getLive: () => {
        events.push('get');
        if (!reentered) {
          reentered = true;
          transition.transition('nested');
        }
        return live;
      },
      save: (_value, scope) => events.push(`save:${scope}`),
      apply: (_value, scope) => events.push(`apply:${scope ?? 'none'}`),
    }, 'scene');

    expect(transition.transition('stale')).toBe(false);
    expect(transition.getCurrent()).toBe('nested');
    expect(events).toEqual(['get', 'get', 'save:scene', 'apply:nested']);
  });

  it('serializes apply reentry so the newest scope is applied last', () => {
    const events: string[] = [];
    const live = { id: 'dock' };
    let transition: ReturnType<typeof createDockScopeTransition<string, typeof live>>;
    transition = createDockScopeTransition({
      getLive: () => live,
      save: (_value, scope) => events.push(`save:${scope}`),
      apply: (_value, scope) => {
        events.push(`apply-start:${scope ?? 'none'}`);
        if (scope === 'outer') transition.transition('nested');
        events.push(`apply-end:${scope ?? 'none'}`);
      },
    }, 'scene');

    expect(transition.transition('outer')).toBe(false);
    expect(transition.getCurrent()).toBe('nested');
    expect(events).toEqual([
      'save:scene',
      'apply-start:outer', 'apply-end:outer',
      'save:outer',
      'apply-start:nested', 'apply-end:nested',
    ]);
  });
});

describe('dock panel command lifecycle', () => {
  const authored = {
    grid: {
      orientation: 'HORIZONTAL' as const,
      root: { type: 'branch' as const, data: [
        { type: 'leaf' as const, data: { views: ['assets', 'history'] } },
        { type: 'leaf' as const, data: { views: ['viewport'] } },
      ] },
    },
  };

  it('opens once at the authored position and reveal focuses the resulting panel', () => {
    const panels = new Map<string, { close(): void; setActive(): void }>();
    const added: unknown[] = [];
    const focused: string[] = [];
    panels.set('assets', { close() {}, setActive() {} });
    const commands = createDockPanelCommands({
      getPanel: (id) => panels.get(id),
      addPanel: (options) => {
        added.push(options);
        panels.set(options.id, { close() {}, setActive: () => focused.push(options.id) });
      },
      canOpen: (id) => id === 'history',
      titleFor: () => 'History',
      authoredLayout: () => authored,
    });

    expect(commands.open('history')).toBe(true);
    expect(commands.open('history')).toBe(false);
    expect(added).toEqual([{ id: 'history', component: 'history', title: 'History', position: { referencePanel: 'assets', direction: 'within' } }]);
    expect(commands.reveal('history')).toBe(true);
    expect(focused).toEqual(['history']);
  });

  it('fails soft for unavailable, missing, and throwing adapters', () => {
    const commands = createDockPanelCommands({
      getPanel: () => undefined,
      addPanel: () => { throw new Error('dock unavailable'); },
      canOpen: (id) => id === 'known',
      titleFor: () => { throw new Error('translation unavailable'); },
    });

    expect(commands.open('unknown')).toBe(false);
    expect(commands.open('known')).toBe(false);
    expect(commands.close('known')).toBe(false);
    expect(commands.focus('known')).toBe(false);
    expect(commands.reveal('known')).toBe(false);
  });

  it('opens an authored edge without evaluating the unused fallback', () => {
    const added: unknown[] = [];
    const edgeLayout = {
      grid: {
        orientation: 'HORIZONTAL' as const,
        root: { type: 'branch' as const, data: [
          { type: 'leaf' as const, data: { views: ['history'] } },
          { type: 'leaf' as const, data: { views: ['viewport'] } },
        ] },
      },
    };
    const commands = createDockPanelCommands({
      getPanel: (id) => id === 'viewport' ? { close() {}, setActive() {} } : undefined,
      addPanel: (options) => added.push(options),
      canOpen: () => true,
      titleFor: () => 'History',
      authoredLayout: () => edgeLayout,
      fallbackPanelId: () => { throw new Error('fallback must stay lazy'); },
    });

    expect(commands.open('history')).toBe(true);
    expect(added).toEqual([{ id: 'history', component: 'history', title: 'History', position: { direction: 'left' } }]);
  });
});

describe('dock panel command subscription lifecycle', () => {
  it('routes every command and fences retained listeners after reverse-order cleanup', () => {
    const listeners = new Map<string, (id: string) => void>();
    const disposed: string[] = [];
    const calls: string[] = [];
    const subscribe = (name: string) => (listener: (id: string) => void) => {
      listeners.set(name, listener);
      return { dispose: () => disposed.push(name) };
    };
    const cleanup = installDockPanelCommandSubscriptions({
      onOpen: subscribe('open'),
      onClose: subscribe('close'),
      onFocus: subscribe('focus'),
      onReveal: subscribe('reveal'),
    }, {
      open: (id) => { calls.push(`open:${id}`); return true; },
      close: (id) => { calls.push(`close:${id}`); return true; },
      focus: (id) => { calls.push(`focus:${id}`); return true; },
      reveal: (id) => { calls.push(`reveal:${id}`); return true; },
    });

    listeners.get('open')?.('assets');
    listeners.get('close')?.('history');
    listeners.get('focus')?.('viewport');
    listeners.get('reveal')?.('chat');
    cleanup();
    cleanup();
    listeners.get('open')?.('stale');

    expect(calls).toEqual(['open:assets', 'close:history', 'focus:viewport', 'reveal:chat']);
    expect(disposed).toEqual(['reveal', 'focus', 'close', 'open']);
  });

  it('rolls back partial registration and isolates disposer failures', () => {
    const disposed: string[] = [];

    expect(() => installDockPanelCommandSubscriptions({
      onOpen: () => ({ dispose: () => disposed.push('open') }),
      onClose: () => ({ dispose: () => { disposed.push('close'); throw new Error('dispose failed'); } }),
      onFocus: () => { throw new Error('registration failed'); },
      onReveal: () => ({ dispose: () => disposed.push('reveal') }),
    }, {
      open: () => true,
      close: () => true,
      focus: () => true,
      reveal: () => true,
    })).toThrow('registration failed');

    expect(disposed).toEqual(['close', 'open']);
  });

  it('isolates command handler failures from source dispatch', () => {
    let open: ((id: string) => void) | undefined;
    const cleanup = installDockPanelCommandSubscriptions({
      onOpen: (listener) => { open = listener; return { dispose() {} }; },
      onClose: () => ({ dispose() {} }),
      onFocus: () => ({ dispose() {} }),
      onReveal: () => ({ dispose() {} }),
    }, {
      open: () => { throw new Error('handler failed'); },
      close: () => true,
      focus: () => true,
      reveal: () => true,
    });

    expect(() => open?.('assets')).not.toThrow();
    cleanup();
  });
});

describe('dock layout-control state lifecycle', () => {
  it('publishes a fresh stable snapshot when the live layout projection refreshes', () => {
    const state = createDockLayoutControlState<{ top: number }>();
    const snapshots: unknown[] = [];
    state.subscribe(() => snapshots.push(state.getSnapshot()));
    const initial = state.getSnapshot();

    state.refresh();
    const refreshed = state.getSnapshot();

    expect(refreshed).not.toBe(initial);
    expect(refreshed).toEqual(initial);
    expect(state.getSnapshot()).toBe(refreshed);
    expect(snapshots).toEqual([refreshed]);
  });

  it('publishes stable snapshots for toggle and idempotent close operations', () => {
    const state = createDockLayoutControlState<{ top: number; left: number }>();
    const notifications: Array<{ open: boolean; top?: number }> = [];
    const unsubscribe = state.subscribe(() => {
      const snapshot = state.getSnapshot();
      notifications.push({ open: snapshot.open, top: snapshot.anchor?.top });
    });
    const initial = state.getSnapshot();

    state.close();
    expect(state.getSnapshot()).toBe(initial);
    expect(notifications).toEqual([]);

    const anchor = { top: 12, left: 24 };
    state.toggle(anchor);
    const opened = state.getSnapshot();
    expect(opened).toEqual({ open: true, anchor });
    expect(state.getSnapshot()).toBe(opened);

    state.toggle();
    expect(state.getSnapshot()).toEqual({ open: false, anchor });
    state.close();
    expect(notifications).toEqual([
      { open: true, top: 12 },
      { open: false, top: 12 },
    ]);

    unsubscribe();
    unsubscribe();
    state.toggle();
    expect(notifications).toHaveLength(2);
  });

  it('balances the toggle source, fences retained listeners, and isolates failures', () => {
    const state = createDockLayoutControlState<{ top: number }>();
    let retained: ((anchor?: { top: number }) => void) | undefined;
    let disposed = 0;
    let observed = 0;
    state.subscribe(() => { throw new Error('subscriber failed'); });
    state.subscribe(() => { observed += 1; });

    const cleanup = installDockLayoutControlToggle({
      onToggle: (listener) => {
        retained = listener;
        return { dispose: () => { disposed += 1; throw new Error('dispose failed'); } };
      },
    }, state);

    expect(() => retained?.({ top: 8 })).not.toThrow();
    expect(state.getSnapshot()).toEqual({ open: true, anchor: { top: 8 } });
    expect(observed).toBe(1);

    expect(() => cleanup()).not.toThrow();
    expect(() => cleanup()).not.toThrow();
    expect(disposed).toBe(1);
    retained?.({ top: 16 });
    expect(state.getSnapshot()).toEqual({ open: true, anchor: { top: 8 } });
    expect(observed).toBe(1);
  });
});

describe('dock layout panel-control projection', () => {
  it('closes an open panel and reopens a closed panel from one stable projection read', () => {
    const calls: string[] = [];
    let open = true;
    const control = createDockLayoutPanelControl({
      isOpen: (panelId) => {
        calls.push(`read:${panelId}`);
        return open;
      },
      close: (panelId) => {
        calls.push(`close:${panelId}`);
        open = false;
      },
      reopen: (panelId) => {
        calls.push(`reopen:${panelId}`);
        open = true;
      },
    });

    expect(control.isOpen('chat')).toBe(true);
    expect(control.toggle('chat')).toBe(true);
    expect(control.toggle('chat')).toBe(true);
    expect(calls).toEqual([
      'read:chat',
      'read:chat',
      'close:chat',
      'read:chat',
      'reopen:chat',
    ]);
  });

  it('fails closed without mutating when projection or selected actions throw', () => {
    const calls: string[] = [];
    const unreadable = createDockLayoutPanelControl({
      isOpen: () => { throw new Error('read failed'); },
      close: () => calls.push('close'),
      reopen: () => calls.push('reopen'),
    });

    expect(unreadable.isOpen('chat')).toBe(false);
    expect(unreadable.toggle('chat')).toBe(false);
    expect(calls).toEqual([]);

    const closeFailure = createDockLayoutPanelControl({
      isOpen: () => true,
      close: () => { throw new Error('close failed'); },
      reopen: () => calls.push('unexpected reopen'),
    });
    const reopenFailure = createDockLayoutPanelControl({
      isOpen: () => false,
      close: () => calls.push('unexpected close'),
      reopen: () => { throw new Error('reopen failed'); },
    });

    expect(closeFailure.toggle('chat')).toBe(false);
    expect(reopenFailure.toggle('chat')).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('dock layout persistence lifecycle', () => {
  const scope = { key: 'project:one:page:scene:DockShell', identity: { page: 'scene', version: 2 } };

  it('loads before restore, suppresses reentrant saves, then persists the live snapshot', () => {
    const calls: string[] = [];
    const persistence = createDockLayoutPersistence<{ value: string }, typeof scope.identity>({
      load: (key, identity) => {
        calls.push(`load:${key}:${identity.version}`);
        return { value: 'saved' };
      },
      save: (key, identity, layout) => calls.push(`save:${key}:${identity.version}:${layout.value}`),
      remove: () => { throw new Error('remove must not run'); },
    });

    persistence.restore(scope, (saved) => {
      calls.push(`restore:${saved?.value}`);
      expect(persistence.save(scope, { value: 'empty' })).toBe(false);
      expect(persistence.captureAndSave(scope, () => { throw new Error('snapshot must stay lazy'); })).toBe(false);
    });
    expect(persistence.captureAndSave(scope, () => ({ value: 'captured' }))).toBe(true);
    expect(persistence.save(scope, { value: 'live' })).toBe(true);
    expect(calls).toEqual([
      'load:project:one:page:scene:DockShell:2',
      'restore:saved',
      'save:project:one:page:scene:DockShell:2:captured',
      'save:project:one:page:scene:DockShell:2:live',
    ]);
  });

  it('clears the exact product-owned key and restores save availability after a throw', () => {
    const removed: string[] = [];
    const persistence = createDockLayoutPersistence<{ value: string }, typeof scope.identity>({
      load: () => null,
      save: () => undefined,
      remove: (key) => removed.push(key),
    });

    expect(() => persistence.restore(scope, () => { throw new Error('invalid layout'); })).toThrow('invalid layout');
    expect(persistence.save(scope, { value: 'live' })).toBe(true);
    persistence.clear(scope);
    expect(removed).toEqual(['project:one:page:scene:DockShell']);
  });
});

describe('dock layout-change observation lifecycle', () => {
  function layoutEvents() {
    const listeners = new Set<() => void>();
    return {
      source: {
        onDidLayoutChange(listener: () => void) {
          listeners.add(listener);
          return { dispose: () => { listeners.delete(listener); } };
        },
      },
      emit: () => { [...listeners].forEach((listener) => listener()); },
      listenerCount: () => listeners.size,
    };
  }

  it('captures the current scope before publishing one committed notification', () => {
    const events: string[] = [];
    const source = layoutEvents();
    const dispose = installDockLayoutObservation(source.source, {
      getCurrentScope: () => 'scene',
      captureAndSave: (scope) => { events.push(`capture:${scope}`); return true; },
      onCommitted: () => events.push('committed'),
    });

    source.emit();
    expect(events).toEqual(['capture:scene', 'committed']);
    expect(source.listenerCount()).toBe(1);
    dispose();
    dispose();
    expect(source.listenerCount()).toBe(0);
  });

  it('filters suppressed captures while scope-free observations still commit', () => {
    const events: string[] = [];
    const source = layoutEvents();
    let scope: string | null = 'restoring';
    installDockLayoutObservation(source.source, {
      getCurrentScope: () => scope,
      captureAndSave: (value) => { events.push(`capture:${value}`); return false; },
      onCommitted: () => events.push('committed'),
    });

    source.emit();
    scope = null;
    source.emit();
    expect(events).toEqual(['capture:restoring', 'committed']);
  });

  it('isolates product hooks and ignores events after disposal', () => {
    const source = layoutEvents();
    const committed: string[] = [];
    let failScope = true;
    let failCapture = true;
    const dispose = installDockLayoutObservation(source.source, {
      getCurrentScope: () => {
        if (failScope) throw new Error('scope unavailable');
        return 'scene';
      },
      captureAndSave: () => {
        if (failCapture) throw new Error('capture unavailable');
        return true;
      },
      onCommitted: () => { committed.push('committed'); throw new Error('notification failed'); },
    });

    expect(() => source.emit()).not.toThrow();
    failScope = false;
    expect(() => source.emit()).not.toThrow();
    expect(committed).toEqual([]);
    failCapture = false;
    expect(() => source.emit()).not.toThrow();
    expect(committed).toEqual(['committed']);
    dispose();
    expect(() => source.emit()).not.toThrow();
  });

  it('fences a stale event when scope resolution disposes the observation', () => {
    const events: string[] = [];
    const source = layoutEvents();
    let dispose = () => {};
    dispose = installDockLayoutObservation(source.source, {
      getCurrentScope: () => {
        events.push('scope');
        dispose();
        events.push('disposed');
        return 'scene';
      },
      captureAndSave: (scope) => { events.push(`capture:${scope}`); return true; },
      onCommitted: () => events.push('committed'),
    });

    source.emit();
    expect(events).toEqual(['scope', 'disposed']);
  });

  it('fences a stale notification when capture disposes the observation', () => {
    const events: string[] = [];
    const source = layoutEvents();
    let dispose = () => {};
    dispose = installDockLayoutObservation(source.source, {
      getCurrentScope: () => 'scene',
      captureAndSave: (scope) => {
        events.push(`capture:${scope}`);
        dispose();
        events.push('disposed');
        return true;
      },
      onCommitted: () => events.push('committed'),
    });

    source.emit();
    expect(events).toEqual(['capture:scene', 'disposed']);
  });

  it('isolates subscription failure and fences a listener retained before throw', () => {
    let listener: (() => void) | undefined;
    let committed = 0;
    let dispose = () => {};

    expect(() => {
      dispose = installDockLayoutObservation({
        onDidLayoutChange(next) {
          listener = next;
          throw new Error('subscribed then failed');
        },
      }, {
        getCurrentScope: () => null,
        onCommitted: () => { committed++; },
      });
    }).not.toThrow();

    listener?.();
    dispose();
    expect(committed).toBe(0);
  });
});

describe('dock layout reset lifecycle', () => {
  function resetEvents() {
    const listeners = new Set<() => void>();
    return {
      source: {
        onReset(listener: () => void) {
          listeners.add(listener);
          return { dispose: () => { listeners.delete(listener); } };
        },
      },
      emit: () => { [...listeners].forEach((listener) => listener()); },
      listenerCount: () => listeners.size,
    };
  }

  it('clears the current scope before reapplying it to the live dock', () => {
    const events: string[] = [];
    const source = resetEvents();
    let scope: string | null = 'scene';
    const live = { id: 'dock' };
    const dispose = installDockLayoutReset(source.source, {
      getCurrentScope: () => { events.push('scope'); return scope; },
      clear: (value) => events.push(`clear:${value}`),
      getLive: () => { events.push('live'); return live; },
      apply: (value, valueScope) => events.push(`apply:${valueScope ?? 'none'}:${value.id}`),
    });

    source.emit();
    scope = null;
    source.emit();
    expect(events).toEqual([
      'scope', 'clear:scene', 'live', 'apply:scene:dock',
      'scope', 'live', 'apply:none:dock',
    ]);
    expect(source.listenerCount()).toBe(1);
    dispose();
    dispose();
    expect(source.listenerCount()).toBe(0);
  });

  it('fails closed before apply when scope or clear fails and isolates apply errors', () => {
    const events: string[] = [];
    const source = resetEvents();
    let failure: 'scope' | 'clear' | 'apply' | null = 'scope';
    installDockLayoutReset(source.source, {
      getCurrentScope: () => {
        events.push('scope');
        if (failure === 'scope') throw new Error('scope unavailable');
        return 'scene';
      },
      clear: (scope) => {
        events.push(`clear:${scope}`);
        if (failure === 'clear') throw new Error('storage unavailable');
      },
      getLive: () => ({ id: 'dock' }),
      apply: (_live, scope) => {
        events.push(`apply:${scope}`);
        if (failure === 'apply') throw new Error('dock unavailable');
      },
    });

    expect(() => source.emit()).not.toThrow();
    failure = 'clear';
    expect(() => source.emit()).not.toThrow();
    failure = 'apply';
    expect(() => source.emit()).not.toThrow();
    failure = null;
    expect(() => source.emit()).not.toThrow();
    expect(events).toEqual([
      'scope',
      'scope', 'clear:scene',
      'scope', 'clear:scene', 'apply:scene',
      'scope', 'clear:scene', 'apply:scene',
    ]);
  });

  it('drops a stale reset when scope resolution synchronously requests a newer reset', () => {
    const events: string[] = [];
    const source = resetEvents();
    let scope = 'scene';
    let reentered = false;
    installDockLayoutReset(source.source, {
      getCurrentScope: () => {
        events.push(`scope:${scope}`);
        if (!reentered) {
          reentered = true;
          scope = 'assets';
          source.emit();
        }
        return scope;
      },
      clear: (value) => events.push(`clear:${value}`),
      getLive: () => ({ id: 'dock' }),
      apply: (_live, value) => events.push(`apply:${value}`),
    });

    source.emit();
    expect(events).toEqual(['scope:scene', 'scope:assets', 'clear:assets', 'apply:assets']);
  });

  it('fences the current reset when cleanup occurs during clear', () => {
    const events: string[] = [];
    const source = resetEvents();
    let dispose = () => {};
    dispose = installDockLayoutReset(source.source, {
      getCurrentScope: () => 'scene',
      clear: (scope) => {
        events.push(`clear:${scope}`);
        dispose();
        events.push('disposed');
      },
      getLive: () => { events.push('live'); return { id: 'dock' }; },
      apply: () => events.push('apply'),
    });

    source.emit();
    source.emit();
    expect(events).toEqual(['clear:scene', 'disposed']);
  });
});

function dockApi(id: string) {
  const closed: string[] = [];
  const added: Array<{ id: string; component: string; title?: string; position?: unknown }> = [];
  return {
    api: {
      id,
      getPanel: (panelId: string) => ({ api: { close: () => closed.push(panelId) } }),
      addPanel: (options: { id: string; component: string; title?: string; position?: unknown }) => added.push(options),
    },
    added,
    closed,
  };
}

describe('dock regions', () => {
  it('keeps the stable movable-region contract and resolution precedence', () => {
    expect(DOCK_REGIONS).toEqual(['DockShell', 'AuxBar', 'ChatDock']);
    expect(isDockRegion('ChatDock')).toBe(true);
    expect(isDockRegion('StatusBar')).toBe(false);
    expect(resolveRegion('chat', { defaultRegion: 'ChatDock' }, { chat: 'AuxBar' })).toBe('AuxBar');
    expect(resolveRegion('chat', { defaultRegion: 'ChatDock' }, {})).toBe('ChatDock');
    expect(resolveRegion('unknown', {}, {})).toBe('DockShell');
  });

  it('derives side-edge state without a Dockview dependency', () => {
    expect(isOnSideEdge({ type: 'edge', position: 'left' })).toBe(true);
    expect(isOnSideEdge({ type: 'edge', position: 'bottom' })).toBe(false);
    expect(nearerSideEdge({ left: 80, right: 120 }, { left: 0, right: 500 })).toBe('left');
    expect(nearerSideEdge({ left: 380, right: 420 }, { left: 0, right: 500 })).toBe('right');
  });
});

describe('dock registries and cross-instance drops', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

  it('registers one live region entry and removes it by identity', () => {
    const entry = { viewId: 'primary', region: 'DockShell', api: {}, wrapEl: {} as HTMLElement };
    cleanups.push(registerDockRegion(entry));
    expect(getDockRegions()).toEqual([entry]);
    cleanups.pop()?.();
    expect(getDockRegions()).toEqual([]);
  });

  it('moves a foreign panel to the exact hovered group and closes its source', () => {
    const source = dockApi('source');
    const target = dockApi('target');
    const group = { id: 'group' };
    const moves: Array<[string, string]> = [];
    cleanups.push(registerDockviewApi(source.api));

    handleCrossInstanceDrop(
      {
        api: target.api,
        position: 'center',
        group,
        getData: () => ({ viewId: 'source', panelId: 'chat' }),
      },
      'DockShell',
      (panelId, region) => moves.push([panelId, region]),
    );

    expect(source.closed).toEqual(['chat']);
    expect(target.added).toEqual([{
      id: 'chat',
      component: 'chat',
      title: undefined,
      position: { referenceGroup: group, direction: 'within' },
    }]);
    expect(moves).toEqual([['chat', 'DockShell']]);
  });

  it('leaves same-instance drops to Dockview', () => {
    const target = dockApi('target');
    handleCrossInstanceDrop(
      { api: target.api, getData: () => ({ viewId: 'target', panelId: 'chat' }) },
      'AuxBar',
      () => { throw new Error('moveTo must not run'); },
    );
    expect(target.added).toEqual([]);
  });
});

describe('dock visibility and serialized layout adapters', () => {
  it('balances panel visibility subscriptions, duplicate ids, and cleanup', () => {
    let addListener: ((panel: { id: string }) => void) | undefined;
    let removeListener: ((panel: { id: string }) => void) | undefined;
    const disposed: string[] = [];
    const events: string[] = [];
    const cleanup = installDockPanelVisibilityTracking({
      onDidAddPanel(listener) {
        addListener = listener;
        return { dispose: () => disposed.push('add') };
      },
      onDidRemovePanel(listener) {
        removeListener = listener;
        return { dispose: () => disposed.push('remove') };
      },
    }, {
      onAdded: (id) => events.push(`added:${id}`),
      onRemoved: (id) => events.push(`removed:${id}`),
    });

    addListener?.({ id: 'chat' });
    addListener?.({ id: 'chat' });
    expect(isDockPanelVisible('chat')).toBe(true);
    removeListener?.({ id: 'chat' });
    expect(isDockPanelVisible('chat')).toBe(false);
    addListener?.({ id: 'viewport' });
    cleanup();
    cleanup();

    expect(isDockPanelVisible('viewport')).toBe(false);
    expect(events).toEqual(['added:chat', 'added:chat', 'removed:chat', 'added:viewport']);
    expect(disposed).toEqual(['add', 'remove']);
  });

  it('restores every invariant when registration, hooks, disposers, or releases throw', () => {
    let addListener: ((panel: { id: string }) => void) | undefined;
    let removeListener: ((panel: { id: string }) => void) | undefined;
    const disposed: string[] = [];
    const cleanup = installDockPanelVisibilityTracking({
      onDidAddPanel(listener) {
        addListener = listener;
        return { dispose: () => { disposed.push('add'); throw new Error('add dispose'); } };
      },
      onDidRemovePanel(listener) {
        removeListener = listener;
        return { dispose: () => { disposed.push('remove'); throw new Error('remove dispose'); } };
      },
    }, {
      onAdded: () => { throw new Error('added hook'); },
      onRemoved: () => { throw new Error('removed hook'); },
    });

    expect(() => addListener?.({ id: 'leak' })).not.toThrow();
    expect(() => removeListener?.({ id: 'missing' })).not.toThrow();
    expect(isDockPanelVisible('leak')).toBe(true);
    expect(() => cleanup()).not.toThrow();
    expect(isDockPanelVisible('leak')).toBe(false);
    addListener?.({ id: 'post-cleanup' });
    removeListener?.({ id: 'post-cleanup' });
    expect(isDockPanelVisible('post-cleanup')).toBe(false);
    expect(disposed).toEqual(['add', 'remove']);

    let rolledBack = false;
    let rolledBackListener: ((panel: { id: string }) => void) | undefined;
    expect(() => installDockPanelVisibilityTracking({
      onDidAddPanel: (listener) => {
        rolledBackListener = listener;
        return { dispose: () => { rolledBack = true; throw new Error('rollback dispose'); } };
      },
      onDidRemovePanel: () => { throw new Error('remove registration'); },
    })).toThrow('remove registration');
    expect(rolledBack).toBe(true);
    rolledBackListener?.({ id: 'post-rollback' });
    expect(isDockPanelVisible('post-rollback')).toBe(false);
  });

  it('tracks repeated panel mounts by reference and balances idempotent cleanup', () => {
    const releaseFirst = trackDockPanelVisibility('chat');
    const releaseSecond = trackDockPanelVisibility('chat');

    expect(isDockPanelVisible('chat')).toBe(true);
    releaseFirst();
    releaseFirst();
    expect(isDockPanelVisible('chat')).toBe(true);
    releaseSecond();
    expect(isDockPanelVisible('chat')).toBe(false);
  });

  it('detects whether any authored placement remains mounted', () => {
    expect(hasMountedPanelPlacement(['content'], new Set())).toBe(false);
    expect(hasMountedPanelPlacement(['content'], new Set(['tools']))).toBe(false);
    expect(hasMountedPanelPlacement(['content', 'details'], new Set(['details']))).toBe(true);
  });

  it('prunes unknown and disallowed panels without mutating the input', () => {
    const layout = {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'leaf', data: { views: ['viewport'], activeView: 'viewport' }, size: 700 },
            { type: 'leaf', data: { views: ['chat'], activeView: 'chat' }, size: 300 },
          ],
          size: 1000,
        },
      },
      panels: {
        viewport: { id: 'viewport', contentComponent: 'ViewportPanel' },
        chat: { id: 'chat', contentComponent: 'ChatPanel' },
      },
    };
    const before = structuredClone(layout);

    const pruned = pruneSerializedDockLayout(
      layout,
      new Set(['ViewportPanel', 'ChatPanel']),
      new Set(['viewport']),
    );

    expect(layout).toEqual(before);
    expect(Object.keys(pruned?.panels ?? {})).toEqual(['viewport']);
    expect(JSON.stringify(pruned?.grid)).not.toContain('chat');
  });

  it('returns null when pruning removes every panel and leaf', () => {
    expect(pruneSerializedDockLayout(
      {
        panels: { chat: { contentComponent: 'ChatPanel' } },
        grid: { root: { type: 'leaf', data: { views: ['chat'], activeView: 'chat' } } },
      },
      new Set(['ViewportPanel']),
    )).toBeNull();
  });
});

describe('authored dock panel reopen placement', () => {
  type ConcreteDockNode = {
    readonly type: 'leaf' | 'branch';
    readonly data: { readonly views?: readonly string[] } | readonly ConcreteDockNode[];
  };
  type ConcreteDockLayout = {
    readonly grid: { readonly orientation: 'HORIZONTAL'; readonly root: ConcreteDockNode };
  };

  const leaf = (...views: string[]) => ({
    type: 'leaf' as const,
    data: { views, activeView: views[0] },
  });
  const branch = (...data: ReturnType<typeof leaf>[]) => ({ type: 'branch' as const, data });
  const layout = (root: ReturnType<typeof branch>) => ({
    grid: { orientation: 'HORIZONTAL' as const, root },
  });
  const opener = (...open: string[]) => (id: string) => open.includes(id);

  it('rejoins an open tab mate before creating another split', () => {
    expect(designedDockPanelPosition(
      layout(branch(leaf('assets', 'history'), leaf('viewport'))),
      'history',
      opener('assets', 'viewport'),
    )).toEqual({ kind: 'relative', referencePanel: 'assets', direction: 'within' });
  });

  it('accepts the non-discriminated concrete node union used by Dockview snapshots', () => {
    const concrete: ConcreteDockLayout = layout(branch(leaf('assets', 'history'), leaf('viewport')));
    const publicInput: AuthoredDockLayoutLike = concrete;
    expect(designedDockPanelPosition(publicInput, 'history', opener('assets')))
      .toEqual({ kind: 'relative', referencePanel: 'assets', direction: 'within' });
  });

  it('restores direct root leaves to their authored outer edge', () => {
    const authored = layout(branch(leaf('preview'), leaf('properties'), leaf('chat')));
    expect(designedDockPanelPosition(authored, 'preview', opener('properties')))
      .toEqual({ kind: 'edge', direction: 'left' });
    expect(designedDockPanelPosition(authored, 'chat', opener('properties')))
      .toEqual({ kind: 'edge', direction: 'right' });
  });

  it('alternates orientation while climbing nested branches', () => {
    const authored = {
      grid: {
        orientation: 'HORIZONTAL' as const,
        root: {
          type: 'branch' as const,
          data: [
            { type: 'branch' as const, data: [leaf('hierarchy'), leaf('inspector')] },
            leaf('viewport'),
          ],
        },
      },
    };
    expect(designedDockPanelPosition(authored, 'hierarchy', opener('inspector', 'viewport')))
      .toEqual({ kind: 'relative', referencePanel: 'inspector', direction: 'above' });
    expect(designedDockPanelPosition(authored, 'hierarchy', opener('viewport')))
      .toEqual({ kind: 'relative', referencePanel: 'viewport', direction: 'left' });
  });

  it('returns undefined for an unknown panel or when no live anchor survives', () => {
    const authored = layout(branch(leaf('preview'), leaf('properties')));
    expect(designedDockPanelPosition(authored, 'unknown', opener('properties'))).toBeUndefined();
    const nested = {
      grid: {
        orientation: 'HORIZONTAL' as const,
        root: {
          type: 'branch' as const,
          data: [
            { type: 'branch' as const, data: [leaf('hierarchy'), leaf('inspector')] },
            leaf('viewport'),
          ],
        },
      },
    };
    expect(designedDockPanelPosition(nested, 'hierarchy', opener())).toBeUndefined();
  });
});
