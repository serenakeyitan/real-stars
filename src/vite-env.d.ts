/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID: string;
  readonly VITE_OAUTH_EXCHANGE_URL: string;
  readonly VITE_EXTENSION_NAME: string;
  readonly VITE_EXTENSION_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
