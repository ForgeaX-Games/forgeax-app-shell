import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetachedSurfaceFrame, DetachedSurfaceStatus } from '../src/react';

describe('DetachedSurfaceFrame', () => {
  it('renders ordinary detached content in a fixed full-window frame', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceFrame><iframe title="Extension" /></DetachedSurfaceFrame>,
    );

    expect(html).toContain('class="fx-detached-surface"');
    expect(html).toContain('style="position:fixed;inset:0"');
    expect(html).toContain('<iframe title="Extension"></iframe>');
  });

  it('adds the established panel and main-area hooks only for panel content', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceFrame panel><main>Panel</main></DetachedSurfaceFrame>,
    );

    expect(html).toContain('class="fx-detached-surface fx-detached-panel main-area"');
  });

  it('centers injected status content without owning message or tone', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceFrame centered>
        <span style={{ color: '#c44' }}>Missing extension</span>
      </DetachedSurfaceFrame>,
    );

    expect(html).toContain('class="fx-detached-surface" style="position:fixed;inset:0"');
    expect(html).toContain('<div class="fx-detached-surface-status" style="display:flex;align-items:center;justify-content:center">');
    expect(html).toContain('<span style="color:#c44">Missing extension</span></div>');
  });

  it('isolates status content from existing direct-child fill selectors', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceFrame centered><span>Status</span></DetachedSurfaceFrame>,
    );

    expect(html).toContain('fx-detached-surface-status');
    expect(html).not.toContain('<div class="fx-detached-surface" style="position:fixed;inset:0"><span>Status</span>');
  });
});

describe('DetachedSurfaceStatus', () => {
  it('renders caller-owned copy with the neutral public tone by default', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceStatus>Loading extension</DetachedSurfaceStatus>,
    );

    expect(html).toBe(
      '<span class="fx-detached-surface-status-text" data-tone="neutral">Loading extension</span>',
    );
  });

  it('exposes an error tone without owning the message', () => {
    const html = renderToStaticMarkup(
      <DetachedSurfaceStatus tone="error">Missing extension</DetachedSurfaceStatus>,
    );

    expect(html).toContain('data-tone="error"');
    expect(html).toContain('>Missing extension</span>');
  });
});
