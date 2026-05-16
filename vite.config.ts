import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

/**
 * Custom plugin to:
 *   1. Read mode-specific env (.env.production / .env.development)
 *   2. Template public/manifest.json with the right name + key + host_permissions
 *      (so prod and dev builds carry their respective OAuth worker URL,
 *      can be installed side-by-side, and the dev install has a stable ID)
 *   3. Move dist/src/popup/index.html to dist/popup.html
 *   4. Rewrite asset paths in popup.html to be relative to dist root
 */
interface BuildEnv {
  VITE_GITHUB_CLIENT_ID?: string;
  VITE_OAUTH_EXCHANGE_URL?: string;
  VITE_EXTENSION_NAME?: string;
  VITE_EXTENSION_KEY?: string;
  MODE: string;
}

function chromeExtensionPlugin(env: BuildEnv): Plugin {
  return {
    name: 'chrome-extension',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // 1. Read manifest, template values, write to dist
      const manifestSrc = resolve(__dirname, 'public/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestSrc, 'utf8')) as {
        name: string;
        version: string;
        host_permissions: string[];
        key?: string;
      };

      // Extension name — dev installs get "real-stars (dev)" so both can
      // coexist in chrome://extensions
      if (env.VITE_EXTENSION_NAME) {
        manifest.name = env.VITE_EXTENSION_NAME;
      }

      // Append "-dev" to version for dev builds so chrome://extensions
      // surfaces which build is installed at a glance
      if (env.MODE === 'development') {
        manifest.version = `${manifest.version}.99`; // Chrome rejects "-dev" suffix; bump build number instead
      }

      // Pin a stable dev extension ID. Empty in prod (Web Store assigns).
      // Manifest "key" with a public key derives the extension ID
      // deterministically — same key everywhere = same ID every reload.
      if (env.VITE_EXTENSION_KEY && env.MODE === 'development') {
        manifest.key = env.VITE_EXTENSION_KEY;
      } else {
        delete manifest.key;
      }

      // Rewrite host_permissions to use the env-supplied worker URL
      // (replaces only the old prod worker URL; leaves github.com etc alone)
      if (env.VITE_OAUTH_EXCHANGE_URL) {
        const workerHost = new URL(env.VITE_OAUTH_EXCHANGE_URL).origin + '/*';
        manifest.host_permissions = manifest.host_permissions.map((p) =>
          p.includes('workers.dev') ? workerHost : p,
        );
      }

      writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // 2. Copy icons
      mkdirSync(resolve(distDir, 'icons'), { recursive: true });
      cpSync(resolve(__dirname, 'public/icons'), resolve(distDir, 'icons'), { recursive: true });

      // 3. Relocate popup.html and clean up the nested src/ tree
      const popupSrc = resolve(distDir, 'src/popup/index.html');
      const popupDst = resolve(distDir, 'popup.html');
      if (existsSync(popupSrc)) {
        let html = readFileSync(popupSrc, 'utf8');
        // Strip leading slash on absolute-rooted paths (Chrome extension context
        // resolves "/popup.js" relative to the extension root, but using a bare
        // path makes the file work in any embed context).
        html = html.replace(/(href|src)="\/(?!\/)/g, '$1="');
        // Drop crossorigin attribute that Vite emits — it breaks file:// loads
        // and is not needed for chrome-extension:// origins
        html = html.replace(/\s+crossorigin/g, '');
        writeFileSync(popupDst, html);
        rmSync(resolve(distDir, 'src'), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env.production / .env.development based on --mode flag.
  // Vite filters to VITE_* prefix by default; we expose all so the plugin can
  // see MODE itself for branch logic.
  const env: BuildEnv = { ...loadEnv(mode, __dirname, ['VITE_']), MODE: mode };

  return {
    publicDir: false,
    define: {
      // Inline at compile time — saves a runtime lookup and gives TypeScript
      // narrowing through the vite-env.d.ts declaration
      'import.meta.env.VITE_GITHUB_CLIENT_ID': JSON.stringify(env.VITE_GITHUB_CLIENT_ID),
      'import.meta.env.VITE_OAUTH_EXCHANGE_URL': JSON.stringify(env.VITE_OAUTH_EXCHANGE_URL),
      'import.meta.env.VITE_EXTENSION_NAME': JSON.stringify(env.VITE_EXTENSION_NAME),
      'import.meta.env.VITE_EXTENSION_KEY': JSON.stringify(env.VITE_EXTENSION_KEY),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background/index.ts'),
          content: resolve(__dirname, 'src/content/index.ts'),
          popup: resolve(__dirname, 'src/popup/index.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) return 'assets/[name][extname]';
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
      target: 'es2022',
      // Prod minifies + drops sourcemaps for Chrome Web Store reviewer
      // friendliness (smaller bundle, no inadvertent source leak).
      minify: mode === 'production' ? 'esbuild' : false,
      sourcemap: mode === 'production' ? false : true,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    plugins: [chromeExtensionPlugin(env)],
  };
});
