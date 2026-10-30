import { useEffect, useState } from "react";
import * as api from "./api";
import type { Workspace } from "./api";
import "./App.css";
import { WorkspaceScreen } from "./workspace/WorkspaceScreen";

type State =
  | { status: "checking" }
  | { status: "choosing"; error?: string }
  | { status: "open"; workspace: Workspace };

function App() {
  const [state, setState] = useState<State>({ status: "checking" });
  const [recent, setRecent] = useState<Workspace[]>([]);

  useEffect(() => {
    api.getLastWorkspace().then(
      (workspace) => setState(workspace ? { status: "open", workspace } : { status: "choosing" }),
      () => setState({ status: "choosing" }),
    );
  }, []);

  useEffect(() => {
    const unlisten = api.onMenuAction((action) => {
      if (action === "close-workspace") closeWorkspace();
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, []);

  useEffect(() => {
    if (state.status !== "choosing") return;
    api.getRecentWorkspaces().then(setRecent, () => setRecent([]));
  }, [state.status]);

  async function openFolder(path: string) {
    try {
      setState({ status: "open", workspace: await api.openWorkspace(path) });
    } catch (error) {
      setState({ status: "choosing", error: String(error) });
    }
  }

  async function chooseFolder() {
    const path = await api.pickFolder();
    if (path) await openFolder(path);
  }

  async function closeWorkspace() {
    await api.closeWorkspace();
    setState({ status: "choosing" });
  }

  if (state.status === "checking") return null;

  if (state.status === "open") {
    return <WorkspaceScreen key={state.workspace.path} workspace={state.workspace} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      {/* No top bar here, so this strip lets the user drag the window. */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-10" />
      <h1 className="text-2xl font-semibold">Welcome to Marginalia</h1>
      <p className="max-w-sm text-neutral-500">
        Pick a folder on your computer. All your notes, PDFs and boards will be stored there.
      </p>
      <button
        onClick={chooseFolder}
        className="rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700"
      >
        Choose a folder
      </button>
      {state.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      {recent.length > 0 && (
        <section className="mt-4 w-full max-w-sm text-left">
          <h2 id="recent-heading" className="mb-2 text-sm font-medium text-neutral-500">
            Recent workspaces
          </h2>
          <ul aria-labelledby="recent-heading" className="flex flex-col gap-1">
            {recent.map((workspace) => (
              <li key={workspace.path}>
                <button
                  onClick={() => openFolder(workspace.path)}
                  className="w-full rounded-md px-3 py-2 text-left hover:bg-neutral-100"
                >
                  <span className="block font-medium">{workspace.name}</span>
                  <span className="block truncate text-xs text-neutral-500">{workspace.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;
