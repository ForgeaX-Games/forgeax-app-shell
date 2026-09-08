import { describe, expect, it } from 'bun:test';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SurfaceRegion } from '../src/react';

describe('SurfaceRegion', () => {
  it('separates caller-owned overlay content from the fill body', () => {
    const html = renderToStaticMarkup(
      <SurfaceRegion
        className="product-region"
        bodyClassName="product-body"
        overlay={<aside data-alert>Failure</aside>}
        data-surface-kind="preview"
      >
        <main>Surface body</main>
      </SurfaceRegion>,
    );

    expect(html).toBe(
      '<div data-surface-kind="preview" class="fx-surface-region product-region">'
      + '<div class="fx-surface-region-overlay"><aside data-alert="true">Failure</aside></div>'
      + '<div class="fx-surface-region-body product-body"><main>Surface body</main></div>'
      + '</div>',
    );
  });

  it('omits the overlay hook when no overlay is supplied', () => {
    expect(renderToStaticMarkup(
      <SurfaceRegion><div>Body</div></SurfaceRegion>,
    )).toBe(
      '<div class="fx-surface-region"><div class="fx-surface-region-body"><div>Body</div></div></div>',
    );
  });

  it('accepts a ref for keep-alive positioning ownership', () => {
    const ref = createRef<HTMLDivElement>();
    expect(renderToStaticMarkup(
      <SurfaceRegion ref={ref} style={{ position: 'fixed' }}>Body</SurfaceRegion>,
    )).toContain('style="position:fixed"');
  });
});
