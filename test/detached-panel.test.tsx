import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetachedPanelBoundary } from '../src/react';
import { surfaceKey, type DetachedWindowCapability } from '../src/window';

const surface = { kind: 'plugin' as const, id: '@demo/tool', instance: 'page-a::main' };

function capability(dockBehavior: 'close' | 'keep-anchor'): DetachedWindowCapability {
  return {
    createTarget: () => ({ surface, title: 'Demo', width: 900, height: 700, dockBehavior }),
  };
}

describe('DetachedPanelBoundary', () => {
  it('renders injected placeholder content for the exact floating keep-anchor surface', () => {
    const html = renderToStaticMarkup(
      <DetachedPanelBoundary
        capability={capability('keep-anchor')}
        floatingSurfaces={{ [surfaceKey(surface)]: true }}
        placeholder={<div data-placeholder>Detached</div>}
      >
        <main>Panel body</main>
      </DetachedPanelBoundary>,
    );
    expect(html).toBe('<div data-placeholder="true">Detached</div>');
  });

  it('keeps children for non-floating, close-behavior and absent capabilities', () => {
    const body = <main>Panel body</main>;
    expect(renderToStaticMarkup(
      <DetachedPanelBoundary capability={capability('keep-anchor')} floatingSurfaces={{}} placeholder="Detached">
        {body}
      </DetachedPanelBoundary>,
    )).toBe('<main>Panel body</main>');
    expect(renderToStaticMarkup(
      <DetachedPanelBoundary capability={capability('close')} floatingSurfaces={{ [surfaceKey(surface)]: true }} placeholder="Detached">
        {body}
      </DetachedPanelBoundary>,
    )).toBe('<main>Panel body</main>');
    expect(renderToStaticMarkup(
      <DetachedPanelBoundary floatingSurfaces={{ [surfaceKey(surface)]: true }} placeholder="Detached">
        {body}
      </DetachedPanelBoundary>,
    )).toBe('<main>Panel body</main>');
  });

  it('fails open to children when a product declaration throws', () => {
    const invalid: DetachedWindowCapability = { createTarget: () => { throw new Error('invalid'); } };
    expect(renderToStaticMarkup(
      <DetachedPanelBoundary capability={invalid} floatingSurfaces={{}} placeholder="Detached">
        <main>Panel body</main>
      </DetachedPanelBoundary>,
    )).toBe('<main>Panel body</main>');
  });
});
