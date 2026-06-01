import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, RotateCcw, AlertCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n";

// Schema-driven config FORM (owner-review D7 Stage 2). The schema + defaults
// are static (DEFAULT_CONFIG-derived), served by the Dashboard at
// /api/dashboard/config/{schema,defaults}; the VALUES are profile-scoped and
// read/written via Station's /api/profiles/{name}/config/values. Scalar fields
// (boolean / number / select / string) render here; list/object defer to YAML.

interface FieldSchema {
  type: string; // boolean | number | string | select | list | object
  description?: string;
  category?: string;
  options?: string[];
}
interface SchemaResp {
  fields: Record<string, FieldSchema>;
  category_order: string[];
}
interface ValuesResp {
  values: Record<string, unknown>;
  sha256: string;
}

const STATIC = { staleTime: 5 * 60_000, retry: 1 } as const;

function getNested(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return (o as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--hms-bg)",
  color: "var(--hms-text)",
  border: "1px solid var(--hms-border)",
  borderRadius: 4,
  fontSize: 'var(--hms-text-sm)',
};

export function ConfigForm({ profile }: { profile: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState("");

  const schemaQ = useQuery<SchemaResp>({
    queryKey: ["config-schema"],
    queryFn: () => api.get<SchemaResp>("/api/dashboard/config/schema"),
    ...STATIC,
  });
  const defaultsQ = useQuery<Record<string, unknown>>({
    queryKey: ["config-defaults"],
    queryFn: () => api.get<Record<string, unknown>>("/api/dashboard/config/defaults"),
    ...STATIC,
  });
  const valuesKey = ["profile-config-values", profile] as const;
  const valuesQ = useQuery<ValuesResp>({
    queryKey: valuesKey,
    queryFn: () => api.get<ValuesResp>(`/api/profiles/${encodeURIComponent(profile)}/config/values`),
  });

  const save = useMutation({
    mutationFn: () =>
      api.json<{ ok: boolean; sha256: string }>(
        `/api/profiles/${encodeURIComponent(profile)}/config/values`,
        "PUT",
        { updates: edits, expected_sha256: valuesQ.data?.sha256 },
      ),
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries({ queryKey: valuesKey });
    },
  });

  const grouped = useMemo(() => {
    const fields = schemaQ.data?.fields ?? {};
    const order = schemaQ.data?.category_order ?? [];
    const q = search.trim().toLowerCase();
    const byCat = new Map<string, string[]>();
    for (const [path, fs] of Object.entries(fields)) {
      if (q && !path.toLowerCase().includes(q) && !(fs.description ?? "").toLowerCase().includes(q)) {
        continue;
      }
      const cat = fs.category ?? "other";
      const arr = byCat.get(cat);
      if (arr) arr.push(path);
      else byCat.set(cat, [path]);
    }
    const ordered = order.filter((c) => byCat.has(c));
    const extra = [...byCat.keys()].filter((c) => !order.includes(c)).sort();
    return [...ordered, ...extra].map((cat) => ({ cat, paths: byCat.get(cat) ?? [] }));
  }, [schemaQ.data, search]);

  if (schemaQ.isError) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', padding: 'var(--hms-space-4)', fontSize: 'var(--hms-text-sm)', color: "var(--hms-text-muted)" }}>
        <AlertCircle size={16} /> {t.config.needsDashboard}
      </div>
    );
  }
  if (schemaQ.isLoading || defaultsQ.isLoading || valuesQ.isLoading) {
    return <div style={{ padding: 'var(--hms-space-4)', color: "var(--hms-text-muted)", fontFamily: "monospace" }}>…</div>;
  }

  const fields = schemaQ.data?.fields ?? {};
  const values = valuesQ.data?.values ?? {};
  const defaults = defaultsQ.data ?? {};
  const dirty = Object.keys(edits).length > 0;

  const effective = (path: string): unknown => {
    if (path in edits) return edits[path];
    const v = getNested(values, path);
    return v !== undefined ? v : getNested(defaults, path);
  };
  const setField = (path: string, v: unknown) => setEdits((e) => ({ ...e, [path]: v }));
  const resetField = (path: string) => setField(path, getNested(defaults, path));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
      {/* Search + save bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--hms-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.config.searchFields}
            style={{ ...inputStyle, width: "100%", paddingLeft: 26, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          style={{
            padding: "5px 16px", borderRadius: 6, border: "none",
            background: !dirty || save.isPending ? "var(--hms-border)" : "var(--hms-text)",
            color: !dirty || save.isPending ? "var(--hms-text-muted)" : "var(--hms-bg)",
            fontSize: 'var(--hms-text-sm)', cursor: !dirty || save.isPending ? "not-allowed" : "pointer",
          }}
        >
          {save.isPending ? t.config.saving : t.config.save}
        </button>
      </div>

      {save.isError && (
        <div style={{ padding: "6px 10px", borderRadius: 6, background: "var(--hms-error-bg)", border: "1px solid #ef4444", fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)" }}>
          {save.error instanceof ApiError && save.error.status === 409 ? t.config.conflict : (save.error as Error).message}
        </div>
      )}

      {grouped.map(({ cat, paths }) => (
        <section key={cat} style={{ border: "1px solid var(--hms-border)", borderRadius: 10, padding: "12px 16px", background: "var(--hms-surface)" }}>
          <div style={{ fontSize: 'var(--hms-text-xs)', fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--hms-text-muted)", marginBottom: 10 }}>
            {titleCase(cat)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
            {paths.map((path) => (
              <AutoField
                key={path}
                path={path}
                schema={fields[path]}
                value={effective(path)}
                changed={path in edits}
                onChange={(v) => setField(path, v)}
                onReset={() => resetField(path)}
                editInYaml={t.config.editInYaml}
                resetLabel={t.config.resetDefault}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AutoField({
  path, schema, value, changed, onChange, onReset, editInYaml, resetLabel,
}: {
  path: string;
  schema: FieldSchema;
  value: unknown;
  changed: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
  editInYaml: string;
  resetLabel: string;
}) {
  const label = path.split(".").pop() ?? path;
  let control: React.ReactNode;
  if (schema.type === "boolean") {
    control = (
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
    );
  } else if (schema.type === "select") {
    control = (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {(schema.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (schema.type === "number") {
    control = (
      <input
        type="number"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={{ ...inputStyle, width: 160 }}
      />
    );
  } else if (schema.type === "list" || schema.type === "object") {
    control = (
      <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", fontStyle: "italic" }}>
        {editInYaml}
      </span>
    );
  } else {
    control = (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: "100%", maxWidth: 360, boxSizing: "border-box" }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <label style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 500, fontFamily: "monospace" }}>
          {label}{changed && <span style={{ color: "var(--hms-accent)" }}> •</span>}
        </label>
        <div style={{ flex: 1 }} />
        {changed && (
          <button type="button" onClick={onReset} title={resetLabel} style={{ display: "inline-flex", border: "none", background: "transparent", color: "var(--hms-text-muted)", cursor: "pointer" }}>
            <RotateCcw size={12} />
          </button>
        )}
        {control}
      </div>
      {schema.description && (
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>{schema.description}</div>
      )}
    </div>
  );
}
