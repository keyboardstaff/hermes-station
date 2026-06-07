import { useState } from "react";
import { Plus, Trash2, Globe, Terminal } from "lucide-react";
import {
  useMcpServers,
  useSetMcpServer,
  useRemoveMcpServer,
  type McpServer,
} from "@/hooks/useMcp";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";

// MCP server management — single column: a server list on top, and a
// "Server JSON" editor below that edits the selected server's full config block
// (any field — command/args/url/env/headers/enabled), mirroring upstream
// desktop. Catalog git-install stays in the CLI; this is the config layer.

const NEW_TEMPLATE = JSON.stringify({ command: "npx", args: [], enabled: true }, null, 2);

export default function McpServersView() {
  const { t } = useI18n();
  const m = t.mcp;
  const { data, isLoading, isError } = useMcpServers();
  const setServer = useSetMcpServer();
  const remove = useRemoveMcpServer();
  const servers = data?.servers ?? [];

  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [json, setJson] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectServer = (srv: McpServer) => {
    setSelected(srv.name);
    setName(srv.name);
    setJson(JSON.stringify(srv.config, null, 2));
    setOpen(true);
    setError(null);
  };

  const startNew = () => {
    setSelected(null);
    setName("");
    setJson(NEW_TEMPLATE);
    setOpen(true);
    setError(null);
  };

  const save = () => {
    const n = name.trim();
    if (!n) { setError(m?.nameRequired ?? "A name is required."); return; }
    let config: unknown;
    try { config = JSON.parse(json); } catch { setError(m?.invalidJson ?? "Invalid JSON."); return; }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      setError(m?.invalidJson ?? "Invalid JSON.");
      return;
    }
    setError(null);
    setServer.mutate(
      { name: n, config: config as Record<string, unknown> },
      { onSuccess: () => setSelected(n) },
    );
  };

  const removeSelected = () => {
    if (!selected) return;
    if (!confirm((m?.confirmRemove ?? "Remove MCP server") + ` "${selected}"?`)) return;
    remove.mutate(selected, { onSuccess: () => { setOpen(false); setSelected(null); } });
  };

  return (
    <div className="hms-mcp">
      <div className="hms-mcp-head">
        <span className="hms-mcp-intro">{m?.intro ?? "Configured MCP servers (config.yaml)."}</span>
        <Button size="sm" variant="primary" onClick={startNew}>
          <Plus size={12} /> {m?.add ?? "Add server"}
        </Button>
      </div>

      {isLoading && <Empty text={m?.loading ?? "Loading…"} />}
      {isError && <Empty text={m?.error ?? "Failed to load MCP servers."} />}
      {!isLoading && !isError && servers.length === 0 && (
        <Empty text={m?.empty ?? "No MCP servers configured."} />
      )}

      {servers.length > 0 && (
        <div className="hms-mcp-list">
          {servers.map((srv) => {
            const Icon = srv.transport === "http" ? Globe : Terminal;
            return (
              <button
                key={srv.name}
                type="button"
                className="hms-mcp-row"
                data-active={selected === srv.name || undefined}
                onClick={() => selectServer(srv)}
              >
                <Icon size={13} className="hms-mcp-row-icon" />
                <span className="hms-mcp-row-name">{srv.name}</span>
                <StatusBadge tone="muted">{srv.transport}</StatusBadge>
                <StatusBadge tone={srv.enabled ? "success" : "muted"}>
                  {srv.enabled ? (m?.enabled ?? "enabled") : (m?.disabled ?? "disabled")}
                </StatusBadge>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div className="hms-mcp-editor">
          <div className="hms-mcp-editor-title">{selected ?? (m?.addTitle ?? "Add MCP server")}</div>
          <input
            className="hms-mcp-name"
            placeholder={m?.namePlaceholder ?? "name (e.g. linear)"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!selected}
          />
          <label className="hms-mcp-json-label">{m?.serverJson ?? "Server JSON"}</label>
          <textarea
            className="hms-mcp-json"
            spellCheck={false}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          {error && <div className="hms-mcp-error">{error}</div>}
          <div className="hms-mcp-actions">
            <Button size="sm" variant="primary" disabled={setServer.isPending} onClick={save}>
              {setServer.isPending ? (m?.saving ?? "Saving…") : (m?.save ?? "Save")}
            </Button>
            {selected && (
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={removeSelected}>
                <Trash2 size={12} /> {m?.remove ?? "Remove"}
              </Button>
            )}
            <Button size="sm" onClick={() => { setOpen(false); setSelected(null); }}>
              {m?.cancel ?? "Cancel"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="hms-mcp-empty">{text}</div>;
}
