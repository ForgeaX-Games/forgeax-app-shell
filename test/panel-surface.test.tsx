import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelEmptyState, PanelSurface } from '../src/react';

describe('PanelSurface', () => {
  it('owns the semantic panel marker and stable registration metadata', () => {
    const html = renderToStaticMarkup(
      <PanelSurface id="viewport" registered singleTab="hideTitle">
        <span>Viewport</span>
      </PanelSurface>,
    );

    expect(html).toBe(
      '<section class="fx-panel" data-fx-panel-id="viewport" data-panel-registered="true" data-dock-single-tab="hideTitle" data-fx-slot="DockPanel:viewport"><div class="fx-panel-content" data-padding="none" data-scroll="auto" data-tone="default"><span>Viewport</span></div></section>',
    );
  });

  it('composes caller classes, header content and explicit content policy', () => {
    const html = renderToStaticMarkup(
      <PanelSurface
        id="files"
        className="product-panel"
        header={<header>Tools</header>}
        content={{ padding: 'md', scroll: 'none', tone: 'tool' }}
      >
        Files
      </PanelSurface>,
    );

    expect(html).toContain('class="fx-panel product-panel"');
    expect(html).toContain('data-panel-registered="false"');
    expect(html).toContain('<header>Tools</header>');
    expect(html).toContain('data-padding="md" data-scroll="none" data-tone="tool">Files</div>');
  });
});

describe('PanelEmptyState', () => {
  it('renders caller-owned title and detail with stable panel hooks', () => {
    expect(renderToStaticMarkup(
      <PanelEmptyState
        title="Panel not mounted"
        detail="viewport"
        data-panel="viewport"
        data-panel-unmounted="1"
      />,
    )).toBe(
      '<div data-panel="viewport" data-panel-unmounted="1" class="fx-panel-empty"><div class="fx-panel-empty-title">Panel not mounted</div><div class="fx-panel-empty-detail">viewport</div></div>',
    );
  });

  it('omits optional detail and composes a caller-owned modifier', () => {
    expect(renderToStaticMarkup(
      <PanelEmptyState title={<strong>Unavailable</strong>} className="product-empty" />,
    )).toBe(
      '<div class="fx-panel-empty product-empty"><div class="fx-panel-empty-title"><strong>Unavailable</strong></div></div>',
    );
  });
});
