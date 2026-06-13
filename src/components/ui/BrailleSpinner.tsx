import { useState, useEffect } from "react";

// Braille spinner frames — mirrors desktop's BrailleSpinner (which mirrors the
// Ink TUI) so the running state reads the same across surfaces.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function BrailleSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span role="status" aria-label="Running" className={className ?? "hms-tool-spinner"}>
      {SPINNER_FRAMES[frame]}
    </span>
  );
}
