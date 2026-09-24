import React from 'react';

interface Props {
  children: React.ReactNode;
  // Changing this value (e.g. the current page) clears a previous error, so
  // navigating away from a broken screen recovers without a full reload.
  resetKey?: string;
}

interface State {
  hasError: boolean;
}

// Without a boundary, one render-time exception anywhere in the tree unmounts
// the WHOLE app and leaves a blank white page. This keeps the header/footer
// alive and shows a recoverable message for just the broken view.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[UI error]', error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Đã có lỗi hiển thị / Something went wrong</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Vui lòng tải lại trang. / Please reload the page.</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition"
        >
          Reload
        </button>
      </div>
    );
  }
}
