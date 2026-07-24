import React from 'react';

/**
 * App-wide error boundary. Catches uncaught render errors anywhere below it so a
 * single broken page shows a recoverable fallback instead of a blank screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surface it for debugging; wire to an error tracker (Sentry, etc.) here.
    // eslint-disable-next-line no-console
    console.error('Uncaught UI error:', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50 p-6">
        <div className="max-w-md w-full rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-ink-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-500">
            The page hit an unexpected error. You can reload to try again.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-ink-100 p-3 text-left text-[11px] text-ink-600">
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
