import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";

/**
 * Search field with a leading magnifier — replaces the bespoke search inputs
 * in Sessions / Skills / Cron / Files / GlobalSearch. Token-only.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder,
  size = "md",
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "4px 8px 4px 26px" : "6px 10px 6px 30px";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", ...style }}>
      <Search
        size={size === "sm" ? 12 : 14}
        style={{ position: "absolute", left: size === "sm" ? 8 : 10, color: "var(--hms-text-muted)", pointerEvents: "none" }}
      />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: pad,
          fontSize: "var(--hms-text-sm)",
          background: "var(--hms-input-bg)",
          border: "1px solid var(--hms-input-border, var(--hms-border))",
          borderRadius: "var(--hms-input-radius, var(--hms-radius-md))",
          color: "var(--hms-text)",
          outline: "none",
          boxSizing: "border-box",
        }}
        {...rest}
      />
    </div>
  );
}
