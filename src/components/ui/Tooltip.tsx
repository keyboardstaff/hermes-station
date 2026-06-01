import { useRef, useState } from "react";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  /**
   * "right" (default) — tooltip appears to the right of the trigger using
   *   `position:fixed` + mouse coords; safe inside overflow:hidden containers
   *   such as the left nav rail.
   * "left" — tooltip appears to the left using `position:absolute`; suited for
   *   elements near the right edge of the viewport (e.g. CapabilityBadge).
   */
  placement?: "right" | "left";
}

/**
 * Lightweight tooltip that renders a small dark label near its trigger.
 *
 * Two placement strategies are supported to handle both overflow:hidden
 * containers (left nav rail → "right") and right-edge elements
 * (CapabilityBadge → "left").
 */
export default function Tooltip({ label, children, placement = "right" }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  const tooltipStyle: React.CSSProperties =
    placement === "right"
      ? {
          position: "fixed",
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          transform: "translateY(-50%)",
          background: "var(--hms-text)",
          color: "var(--hms-bg)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 'var(--hms-text-caption)',
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 9999,
        }
      : {
          position: "absolute",
          right: "calc(100% + 8px)",
          top: "50%",
          transform: "translateY(-50%)",
          background: "var(--hms-text)",
          color: "var(--hms-bg)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 'var(--hms-text-caption)',
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 100,
        };

  const visible = placement === "right" ? pos !== null : hovered;

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: placement === "left" ? "inline-block" : undefined }}
      onMouseEnter={() => {
        if (placement === "right") {
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setPos({ x: rect.right + 8, y: rect.top + rect.height / 2 });
        } else {
          setHovered(true);
        }
      }}
      onMouseLeave={() => {
        setPos(null);
        setHovered(false);
      }}
    >
      {children}
      {visible && <div style={tooltipStyle}>{label}</div>}
    </div>
  );
}
