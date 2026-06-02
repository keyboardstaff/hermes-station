/** Render a mermaid SVG at its natural size, centered + horizontally scrollable
 *  — not shrunk to the container. mermaid (useMaxWidth:true) emits width="100%"
 *  + style="max-width:Npx" where N is the natural width; promote N to the actual
 *  width and drop the cap so wide diagrams scroll instead of scaling down. */
export function naturalSizeSvg(svg: string): string {
  try {
    const el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    if (el.nodeName.toLowerCase() !== "svg") return svg;
    const m = /max-width:\s*([\d.]+)px/.exec(el.getAttribute("style") ?? "");
    if (m) {
      el.setAttribute("width", `${m[1]}px`);
      (el as unknown as SVGSVGElement).style.maxWidth = "none";
      el.removeAttribute("height"); // let the viewBox aspect drive height
    }
    return el.outerHTML;
  } catch {
    return svg;
  }
}
