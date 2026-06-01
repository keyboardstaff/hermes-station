import { useState } from "react";
import { Plus, Trash2, Server, Globe, Terminal } from "lucide-react";
import {
  useMcpServers,
  useToggleMcpServer,
  useAddMcpServer,
  useRemoveMcpServer,
  type McpServer,
  type AddMcpServer,
} from "@/hooks/useMcp";
import { useI18n } from "@/i18n";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import IconButton from "@/components/ui/IconButton";
import { ApiError } from "@/lib/api";

// MCP server management — the configured ``mcp_servers`` block.
// Lists servers with enable/disable + remove, plus a manual add form (stdio or
// http). Catalog git-install stays in the CLI; this is the config layer.

export default function McpServersView() {
  const { t } = useI18n();
  const m = t.mcp;
  const { data, isLoading, isError } = useMcpServers();
  const [adding, setAdding] = useState(false);

  const servers = data?.servers ?? [];

  return (
    <div style={{ padding: "var(--hms-space-6)", display: "flex", flexDirection: "column", gap: "var(--hms-space-3)", maxWidth: "var(--hms-content-max-w)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)" }}>
        <div style={{ flex: 1, fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
          {m?.intro ?? "Configured MCP servers (config.yaml). Install new ones from the catalog via the CLI."}
        </div>
        <Button size="sm" variant="primary" onClick={() => setAdding((a) => !a)}>
          <Plus size={12} /> {m?.add ?? "Add server"}
        </Button>
      </div>

      {adding && <AddForm onDone={() => setAdding(false)} />}

      {isLoading && <Empty text={m?.loading ?? "Loading…"} />}
      {isError && <Empty text={m?.error ?? "Failed to load MCP servers."} />}
      {!isLoading && !isError && servers.length === 0 && !adding && (
        <Empty text={m?.empty ?? "No MCP servers configured."} />
      )}

      {servers.map((srv) => <ServerCard key={srv.name} srv={srv} />)}
    </div>
  );
}

function ServerCard({ srv }: { srv: McpServer }) {
  const { t } = useI18n();
  const m = t.mcp;
  const toggle = useToggleMcpServer();
  const remove = useRemoveMcpServer();
  const Icon = srv.transport === "http" ? Globe : Terminal;

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)" }}>
        <Icon size={14} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
        <span style={{ flex: 1, fontSize: "var(--hms-text-sm)", fontWeight: 600 }}>{srv.name}</span>
        <StatusBadge tone={srv.enabled ? "success" : "muted"}>
          {srv.enabled ? (m?.enabled ?? "enabled") : (m?.disabled ?? "disabled")}
        </StatusBadge>
        <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }} title={m?.toggleHint ?? "Enable / disable"}>
          <input
            type="checkbox"
            checked={srv.enabled}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate({ name: srv.name, enabled: e.target.checked })}
          />
        </label>
        <IconButton
          size="sm"
          danger
          title={m?.remove ?? "Remove"}
          disabled={remove.isPending}
          onClick={() => {
            if (confirm((m?.confirmRemove ?? "Remove MCP server") + ` "${srv.name}"?`)) {
              remove.mutate(srv.name);
            }
          }}
        >
          <Trash2 size={12} />
        </IconButton>
      </div>
      <code style={{ fontSize: "0.625rem", fontFamily: "monospace", color: "var(--hms-text-muted)", wordBreak: "break-all" }}>
        {srv.transport === "http"
          ? srv.url + (srv.auth ? `  · ${srv.auth}` : "")
          : [srv.command, ...(srv.args ?? [])].join(" ")}
      </code>
    </Card>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: "var(--hms-text-sm)",
  background: "var(--hms-input-bg)",
  border: "1px solid var(--hms-input-border, var(--hms-border))",
  borderRadius: "var(--hms-input-radius, var(--hms-radius-md))",
  color: "var(--hms-text)",
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};

function AddForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const m = t.mcp;
  const add = useAddMcpServer();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [argsRaw, setArgsRaw] = useState("");
  const [url, setUrl] = useState("");
  const [oauth, setOauth] = useState(false);

  const submit = () => {
    const body: AddMcpServer = { name: name.trim(), transport };
    if (transport === "stdio") {
      body.command = command.trim();
      const args = argsRaw.split(/\s+/).filter(Boolean);
      if (args.length) body.args = args;
    } else {
      body.url = url.trim();
      if (oauth) body.auth = "oauth";
    }
    add.mutate(body, { onSuccess: onDone });
  };

  const valid = name.trim() && (transport === "stdio" ? command.trim() : url.trim());

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)", borderColor: "var(--hms-accent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "var(--hms-text-sm)", fontWeight: 600 }}>
        <Server size={13} /> {m?.addTitle ?? "Add MCP server"}
      </div>
      <input style={inputStyle} placeholder={m?.namePlaceholder ?? "name (e.g. linear)"} value={name} onChange={(e) => setName(e.target.value)} />
      <div style={{ display: "inline-flex", border: "1px solid var(--hms-border)", borderRadius: "var(--hms-radius-md)", overflow: "hidden", width: "fit-content" }}>
        {(["stdio", "http"] as const).map((tt) => (
          <button
            key={tt}
            type="button"
            onClick={() => setTransport(tt)}
            style={{
              padding: "4px 12px", border: "none", cursor: "pointer", fontSize: "var(--hms-text-caption)",
              background: transport === tt ? "var(--hms-selected-bg)" : "transparent",
              color: transport === tt ? "var(--hms-text)" : "var(--hms-text-muted)",
              fontWeight: transport === tt ? 600 : 400,
            }}
          >
            {tt}
          </button>
        ))}
      </div>
      {transport === "stdio" ? (
        <>
          <input style={inputStyle} placeholder={m?.commandPlaceholder ?? "command (e.g. npx)"} value={command} onChange={(e) => setCommand(e.target.value)} />
          <input style={inputStyle} placeholder={m?.argsPlaceholder ?? "args (space-separated)"} value={argsRaw} onChange={(e) => setArgsRaw(e.target.value)} />
        </>
      ) : (
        <>
          <input style={inputStyle} placeholder={m?.urlPlaceholder ?? "url (https://…)"} value={url} onChange={(e) => setUrl(e.target.value)} />
          <label style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "var(--hms-text-caption)", color: "var(--hms-text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={oauth} onChange={(e) => setOauth(e.target.checked)} /> {m?.oauth ?? "OAuth auth"}
          </label>
        </>
      )}
      {add.isError && (
        <div style={{ fontSize: "var(--hms-text-caption)", color: "var(--hms-error-text)" }}>
          {add.error instanceof ApiError && add.error.status === 409
            ? (m?.alreadyExists ?? "A server with that name already exists.")
            : (add.error as Error).message}
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--hms-space-2)" }}>
        <Button size="sm" variant="primary" disabled={!valid || add.isPending} onClick={submit}>
          {add.isPending ? (m?.adding ?? "Adding…") : (m?.addConfirm ?? "Add")}
        </Button>
        <Button size="sm" onClick={onDone}>{m?.cancel ?? "Cancel"}</Button>
      </div>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: 32, border: "1px dashed var(--hms-border)", borderRadius: "var(--hms-radius-lg)", textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
      {text}
    </div>
  );
}
