import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";
import App from "./App";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/skin-bridge.css";

// The PWA / service worker was removed (see vite.config.ts). Any SW still
// installed in a browser is from an old build and will keep serving stale,
// cached bundles — the exact "my fix isn't live" bug. Unconditionally evict
// it: unregister every registration, drop all caches, then hard-reload once
// to fetch fresh assets.
//
// This is loop-safe: builds no longer register a SW, so after the reload
// getRegistrations() is empty and this block is a no-op. No sessionStorage
// guard is needed (and the old one-time guard was the reason a re-registered
// SW could never be cleared again).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (regs.length === 0) return;
    console.warn(`[hms] Evicting ${regs.length} stale Service Worker(s) + caches; reloading`);
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    window.location.reload();
  }).catch(() => { /* ignore */ });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
