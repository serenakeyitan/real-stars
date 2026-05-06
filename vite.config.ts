import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

/**
 * Custom plugin to:
 *   1. Copy public/manifest.json + public/icons to dist
 *   2. Move dist/src/popup/index.html to dist/popup.html
 *   3. Rewrite asset paths in popup.html to be relative to dist root
 */
function chromeExtensionPlugin(): Plugin {
  return {
    name: 'chrome-extension',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // 1. manifest + icons
      copyFileSync(resolve(__dirname, 'public/manifest.json'), resolve(distDir, 'manifest.json'));
      mkdirSync(resolve(distDir, 'icons'), { recursive: true });
      cpSync(resolve(__dirname, 'public/icons'), resolve(distDir, 'icons'), { recursive: true });

      // 2. relocate popup.html and clean up the nested src/ tree
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

export default defineConfig({
  publicDir: false, // we handle manifest/icons via the plugin to avoid Vite touching them
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
          // Keep popup.css predictable for manifest references
          if (assetInfo.name?.endsWith('.css')) return 'assets/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    target: 'es2022',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [chromeExtensionPlugin()],
});
