import { Component, type ReactNode } from "react";

type State = { error: Error | null };

/** If anything below crashes, shows the error instead of leaving a blank, frozen window. */
export class CrashScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-10" />
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p role="alert" className="max-w-md font-mono text-sm text-red-600">
          {this.state.error.message}
        </p>
        <button
          onClick={() => location.reload()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Reload
        </button>
      </main>
    );
  }
}
