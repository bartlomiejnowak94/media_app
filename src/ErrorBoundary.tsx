import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Without this, one unexpected value in a note turns the whole page white.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="empty-state" role="alert" style={{ padding: 24 }}>
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <button className="primary-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
