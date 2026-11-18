import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadTypstParser } from "./editor/typstSyntax";
import parserUrl from "./editor/typst-parser.wasm?url";
import { CrashScreen } from "./ui/CrashScreen";

function show() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <CrashScreen>
        <App />
      </CrashScreen>
    </React.StrictMode>,
  );
}

// Typst's parser first: the editor reads notes with it.
loadTypstParser(fetch(parserUrl).then((response) => response.arrayBuffer())).then(show, (error) => {
  console.error("Couldn't load Typst's parser:", error);
  show();
});
