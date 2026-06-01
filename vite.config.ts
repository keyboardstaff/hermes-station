import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// NOTE: the PWA / service worker was removed deliberately. A cached SW kept
// serving stale builds (developers tested old code after a rebuild) and had
// previously buffered SSE/WS frames. For a self-hosted tool the offline/
// installable benefit didn't justify the recurring "why is my fix not live"
// confusion. main.tsx unregisters any residual SW so existing clients heal.

// Vite dev port — 3131 (HMR + reverse-proxy to Python). Production
// serves the built SPA directly from the Python backend on HMS_PORT.
const VITE_DEV_PORT = 3131;

// Dev backend transport. By default the backend binds a Unix socket (no TCP
// port at all), so the only open dev port is Vite's 3131 and there's never a
// clash with the production gateway (TCP :1313). `scripts/dev.sh` exports
// HMS_DEV_SOCK; an explicit HMS_PORT (`hms dev --port N`) switches the proxy to
// TCP; a bare `vite` with neither falls back to the production port. There is
// intentionally no project ``.env`` autoload: that would let one side (Vite)
// silently disagree with the other (Python) about where the backend is.
const DEV_SOCK = process.env.HMS_DEV_SOCK;
const BACKEND_TARGET = DEV_SOCK
  ? { socketPath: DEV_SOCK }
  : `http://127.0.0.1:${Number(process.env.HMS_PORT ?? 1313)}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    // Match the station API server's bind. When the operator sets
    // HMS_HOST=0.0.0.0 the Vite dev server also needs to be
    // reachable on the LAN — otherwise the Python backend binds publicly
    // but the SPA on :1313 stays localhost-only.
    host: process.env.HMS_HOST === "0.0.0.0" ? true : "127.0.0.1",
    port: VITE_DEV_PORT,
    strictPort: true,
    proxy: {
      // REST + everything under /api/ → Python backend.
      "/api": {
        target: BACKEND_TARGET,
        // Forward X-Forwarded-* so the Python backend's auth check sees
        // the real LAN client IP and requires login instead of treating
        // the (localhost) Vite proxy hop as an unauthenticated local
        // session.
        xfwd: true,
        // Force a loopback Host so Python's ``host_guard_middleware`` accepts
        // the request. Needed because remote LAN access to Vite on :3131 would
        // otherwise forward Host=lan-ip:3131 (rejected). NOT `changeOrigin` —
        // that derives Host from the target, which a Unix-socket target lacks
        // (→ "undefined" host error). is_localhost() is unaffected — it keys
        // off the socket peer / transport + X-Forwarded-For, not Host.
        headers: { host: "127.0.0.1" },
      },
      // WebSocket — same target, ws upgrade flag flipped.
      "/ws": {
        target: BACKEND_TARGET,
        ws: true,
        xfwd: true,
        headers: { host: "127.0.0.1" },
      },
    },
  },
});
