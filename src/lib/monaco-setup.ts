// Self-host Monaco — without this, @monaco-editor/react fetches the editor from
// a CDN (jsdelivr) at runtime, which fails in Station's offline / gateway-served
// (CSP-restricted) production, leaving every editor stuck on "Loading…". We
// bundle Monaco from the installed package and point the loader at it.
//
// Only the base editor worker is wired: Monarch syntax highlighting + editing
// work without language workers (those add IntelliSense/diagnostics we don't
// need for markdown / yaml / config / file editing). Vite bundles the worker
// via the `?worker` import.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: () => Worker };
  }
}

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
