/** Desktop's statue backdrop — a faint difference-blended brand texture laid
 *  over the whole routed pane (same as upstream: the layer sits ABOVE the
 *  content at 2.5% opacity, pointer-transparent, so it reads as a texture
 *  rather than a background fill). Rendered once per shell. */
export default function Backdrop() {
  return (
    <div className="hms-backdrop" aria-hidden>
      <img src="/ds-assets/filler-bg0.jpg" alt="" fetchPriority="low" />
    </div>
  );
}
