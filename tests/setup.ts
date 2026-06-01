// Force an in-memory localStorage shim before any store module loads.
// jsdom+vitest+zustand persist races: jsdom installs Storage lazily on first access,
// while persist grabs window.localStorage synchronously during module init → undefined setItem.

let store: Record<string, string> = {};
const shim = {
  getItem: (k: string): string | null => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = String(v);
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    store = {};
  },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() {
    return Object.keys(store).length;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: shim,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: shim,
  writable: true,
  configurable: true,
});
