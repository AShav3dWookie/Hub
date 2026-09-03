// Stub for the `virtual:pwa-register` module, which only exists during a real Vite build.
// Aliased in vitest.config.ts.
export function registerSW(): () => Promise<void> {
  return () => Promise.resolve();
}
