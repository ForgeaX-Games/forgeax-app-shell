import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SurfacePlaceholder } from '../src/react';

describe('SurfacePlaceholder', () => {
  it('owns the established wrapper and title hooks while callers own copy', () => {
    const html = renderToStaticMarkup(
      <SurfacePlaceholder title="No renderer configured" />,
    );

    expect(html).toBe(
      '<div class="surface-placeholder"><div class="surface-placeholder-title">No renderer configured</div></div>',
    );
  });

  it('composes a caller-owned modifier without inventing product kinds', () => {
    const html = renderToStaticMarkup(
      <SurfacePlaceholder
        title="No editor configured"
        className="surface-placeholder--viewport"
      />,
    );

    expect(html).toContain('class="surface-placeholder surface-placeholder--viewport"');
  });
});
