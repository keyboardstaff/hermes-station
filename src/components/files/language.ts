/**
 * Map a file extension to a Monaco language id. Shared by FileEditor
 * and FileVersionHistory so the editor and the history preview pick
 * the same syntax highlighting for the same file.
 */
export function guessLanguage(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", go: "go", rs: "rust",
    json: "json", yaml: "yaml", yml: "yaml",
    toml: "ini", ini: "ini",
    md: "markdown", markdown: "markdown",
    sh: "shell", bash: "shell", zsh: "shell",
    sql: "sql",
    html: "html", css: "css", scss: "scss",
    xml: "xml",
    log: "plaintext", txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}
