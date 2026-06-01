/**
 * ImageLightbox — modal image viewer with prev/next navigation.
 *
 * Usage:
 *   <ImageLightbox
 *     images={[{ src, alt }, ...]}
 *     initialIndex={0}
 *     onClose={() => setOpen(false)}
 *   />
 */
import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface LightboxImage {
  src: string;
  alt?: string;
}

interface Props {
  images: LightboxImage[];
  initialIndex: number;
  currentIndex: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

export default function ImageLightbox({
  images, initialIndex: _initialIndex, currentIndex, onIndexChange, onClose,
}: Props) {
  const total = images.length;
  const img = images[currentIndex];

  const prev = useCallback(() => {
    onIndexChange((currentIndex - 1 + total) % total);
  }, [currentIndex, total, onIndexChange]);

  const next = useCallback(() => {
    onIndexChange((currentIndex + 1) % total);
  }, [currentIndex, total, onIndexChange]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") { prev(); return; }
      if (e.key === "ArrowRight") { next(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, prev, next]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          background: "rgba(255,255,255,0.12)", border: "none", cursor: "pointer",
          borderRadius: "50%", width: 36, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}
      >
        <X size={18} />
      </button>

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          style={{
            position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.12)", border: "none", cursor: "pointer",
            borderRadius: "50%", width: 40, height: 40,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {/* Image */}
      <img
        src={img?.src}
        alt={img?.alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "min(90vw, 1200px)",
          maxHeight: "85vh",
          objectFit: "contain",
          borderRadius: 8,
          userSelect: "none",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      />

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          style={{
            position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.12)", border: "none", cursor: "pointer",
            borderRadius: "50%", width: 40, height: 40,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}
        >
          <ChevronRight size={22} />
        </button>
      )}

      {/* Counter */}
      {total > 1 && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          color: "rgba(255,255,255,0.6)", fontSize: 'var(--hms-text-sm)',
        }}>
          {currentIndex + 1} / {total}
        </div>
      )}
    </div>,
    document.body,
  );
}
