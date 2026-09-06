/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * The released version, baked in by the Docker builder stage (`ARG APP_VERSION`) and shown on
   * the Settings screen. Undefined under `vite dev` and in tests, where the caller falls back
   * to "dev".
   */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
