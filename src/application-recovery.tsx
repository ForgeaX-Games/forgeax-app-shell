import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ApplicationRecoveryMessages {
  readonly title: ReactNode;
  readonly hint: ReactNode;
  readonly retry: ReactNode;
  readonly remount: ReactNode;
  readonly reloadApplication: ReactNode;
}

export interface ApplicationRecoveryBoundaryProps {
  readonly children: ReactNode;
  /** Product-owned, non-throwing copy captured before this boundary renders. */
  readonly messages: ApplicationRecoveryMessages;
  /** Optional product-owned label identifying the failed application subtree. */
  readonly scope?: string;
  /** Product reporting stays injected; the boundary never selects telemetry. */
  readonly onError?: (error: Error, info: ErrorInfo, scope: string | undefined) => void;
  /** Product boot presentation can reveal the fallback without becoming shell policy. */
  readonly onRevealError?: () => void;
  /** Defaults to reloading the current browser window when one exists. */
  readonly reloadApplication?: () => void;
}

interface ApplicationRecoveryState {
  readonly error: Error | null;
  readonly info: ErrorInfo | null;
  readonly remountKey: number;
}

const buttonStyle: CSSProperties = {
  font: '12px/1.4 ui-sans-serif, system-ui, sans-serif',
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--fx-border, #333)',
  background: 'var(--fx-bg-elev2, #1d1d1d)',
  color: 'var(--fx-fg, #eee)',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--fx-accent, #4f7cff)',
  color: '#fff',
};

function isolateProductCallback(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Recovery presentation must survive product reporting and host failures.
  }
}

function reloadCurrentApplication(): void {
  if (typeof window === 'undefined') return;
  window.location.reload();
}

/**
 * Product-neutral root recovery for an application render failure.
 *
 * The boundary owns React error capture and the three stable recovery exits.
 * Callers retain all copy, reporting, boot presentation and reload policy.
 */
export class ApplicationRecoveryBoundary extends Component<
  ApplicationRecoveryBoundaryProps,
  ApplicationRecoveryState
> {
  state: ApplicationRecoveryState = {
    error: null,
    info: null,
    remountKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ApplicationRecoveryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    isolateProductCallback(() => this.props.onError?.(error, info, this.props.scope));
    isolateProductCallback(this.props.onRevealError);
    // Keep a local diagnostic even when the caller does not install telemetry.
    // eslint-disable-next-line no-console
    console.error(
      `[RecoveryBoundary${this.props.scope ? ` · ${this.props.scope}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  private retry = (): void => {
    this.setState({ error: null, info: null });
  };

  private remount = (): void => {
    this.setState((state) => ({
      error: null,
      info: null,
      remountKey: state.remountKey + 1,
    }));
  };

  private reload = (): void => {
    isolateProductCallback(this.props.reloadApplication ?? reloadCurrentApplication);
  };

  render(): ReactNode {
    const { error, info, remountKey } = this.state;
    if (error === null) {
      return <ApplicationRemountScope key={remountKey}>{this.props.children}</ApplicationRemountScope>;
    }

    const { messages, scope } = this.props;
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 'var(--z-toplevel)',
          overflow: 'auto',
          padding: 32,
          background: 'var(--fx-bg, #0d0d0d)',
          color: 'var(--fx-fg, #fff)',
          font: '13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--fx-danger, #f87171)' }}>
          {messages.title}{scope ? ` · ${scope}` : ''}
        </h1>
        <p style={{ margin: '0 0 16px', color: 'var(--fx-fg-muted, #aaa)' }}>
          {messages.hint}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 16px' }}>
          <button type="button" onClick={this.retry} style={primaryButtonStyle}>
            {messages.retry}
          </button>
          <button type="button" onClick={this.remount} style={buttonStyle}>
            {messages.remount}
          </button>
          <button type="button" onClick={this.reload} style={buttonStyle}>
            {messages.reloadApplication}
          </button>
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--fx-border, #333)',
            background: 'var(--fx-bg-elev2, #161616)',
            color: 'var(--fx-danger, #f87171)',
          }}
        >
          {error.message}
          {'\n\n'}
          {error.stack}
          {info?.componentStack ? `\n\n--- component stack ---${info.componentStack}` : ''}
        </pre>
      </div>
    );
  }
}

function ApplicationRemountScope({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
