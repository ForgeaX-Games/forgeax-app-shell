import { describe, expect, it } from 'bun:test';
import {
  AppShellRegistry,
  createShellContribution,
  deriveShellSnapshot,
} from '../src';

function contribution(id: string, slot: 'dock' | 'window' | 'panel' = 'panel') {
  return createShellContribution({
    id,
    slot,
    title: id,
    contribution: {
      id: `ui.${id}`,
      type: 'panel',
      title: id,
      activation: 'eager',
    },
  });
}

describe('AppShellRegistry', () => {
  it('lists generic contributions by shell slot', () => {
    const registry = new AppShellRegistry();
    registry.register(contribution('project-tree', 'dock'));
    registry.register(contribution('command-panel'));

    expect(registry.list().map((entry) => entry.id)).toEqual([
      'project-tree',
      'command-panel',
    ]);
    expect(registry.list('dock').map((entry) => entry.id)).toEqual([
      'project-tree',
    ]);
  });

  it('rejects duplicate contribution identities', () => {
    const registry = new AppShellRegistry();
    registry.register(contribution('project-tree'));

    expect(() => registry.register(contribution('project-tree'))).toThrow(
      'Duplicate shell contribution: project-tree',
    );
  });
});

describe('deriveShellSnapshot', () => {
  it('merges object fields one level while replacing arrays and scalars', () => {
    interface TestShellSnapshot extends Record<string, unknown> {
      panels: Record<string, string>;
      slots: Record<string, string>;
      panelIds: string[];
      theme: string;
    }
    const base: TestShellSnapshot = {
      panels: { project: 'base', console: 'base' },
      slots: { sidebar: 'base' },
      panelIds: ['project'],
      theme: 'dark',
    };
    const first = {
      panels: { project: 'first' },
      panelIds: ['console'],
    };
    const second = {
      panels: { inspector: 'second' },
      slots: undefined,
      theme: 'light',
    };

    expect(deriveShellSnapshot(base, [first, second])).toEqual({
      panels: { project: 'first', console: 'base', inspector: 'second' },
      slots: { sidebar: 'base' },
      panelIds: ['console'],
      theme: 'light',
    });
    expect(base).toEqual({
      panels: { project: 'base', console: 'base' },
      slots: { sidebar: 'base' },
      panelIds: ['project'],
      theme: 'dark',
    });
    expect(first).toEqual({
      panels: { project: 'first' },
      panelIds: ['console'],
    });
  });

  it('lets later patches win without recursively merging nested values', () => {
    interface ChromeSnapshot extends Record<string, unknown> {
      chrome: Record<string, Record<string, string | boolean>>;
    }
    const base: ChromeSnapshot = {
      chrome: { status: { color: 'green', text: 'ready' } },
    };
    const result = deriveShellSnapshot(
      base,
      [
        { chrome: { status: { color: 'yellow' } } },
        { chrome: { menu: { visible: true } } },
      ],
    );

    expect(result).toEqual({
      chrome: {
        status: { color: 'yellow' },
        menu: { visible: true },
      },
    });
  });
});
