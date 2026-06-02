import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DesktopShell from "@/components/layout/DesktopShell";
import MobileShell from "@/components/layout/MobileShell";
import CommandPalette from "@/components/search/CommandPalette";
import { useIsMobile } from "@/hooks/useBreakpoint";
import { useChatStore } from "@/store/chat";

// Responsive shell: picks Desktop/Mobile by viewport and owns the global ⌘K
// command palette (search + navigate + actions). Single mount-point for
// cross-shell concerns so neither shell has to know about the palette or
// breakpoints.
export default function AppShell() {
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "k") {
      e.preventDefault();
      setPaletteOpen(true);
    }
    const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
    if (isMac ? (e.ctrlKey && e.metaKey && e.key === "n") : (e.ctrlKey && e.shiftKey && e.key === "n")) {
      e.preventDefault();
      setActiveSession(null);
      navigate("/chat");
    }
  }, [navigate, setActiveSession]);

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <>
      {isMobile
        ? <MobileShell onOpenPalette={() => setPaletteOpen(true)} />
        : <DesktopShell />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
