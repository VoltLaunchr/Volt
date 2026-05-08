import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    // Increase chunk size warning limit for desktop apps (local loading, no network impact)
    chunkSizeWarningLimit: 1000, // 1 MB
    rollupOptions: {
      output: {
        // Manual chunking is intentionally minimal.
        //
        // History: a previous attempt grouped React, react-i18next, motion,
        // @radix-ui, @base-ui and friends into a `vendor-react` chunk and
        // dumped everything else into a `vendor` catchall. That created a
        // `vendor → vendor-react → vendor` cycle (Rollup splits transitive
        // utility re-exports across both sides), and at boot the catchall
        // executed while React's exports were still in the TDZ — throwing
        // `Cannot read properties of undefined (reading 'createContext')`.
        // v0.1.8 shipped that broken bundle.
        //
        // Rule of thumb: only chunk LEAF libraries (no React deps, no
        // cross-references back into the rest of the bundle). Anything that
        // touches React stays unchunked so Vite can route it through the
        // automatic dependency-graph split, which is cycle-free by
        // construction.
        manualChunks: (id) => {
          // Normalize Windows backslashes so '/node_modules/<pkg>/' matches.
          const nid = id.replace(/\\/g, '/');

          if (nid.includes('/node_modules/')) {
            // Tauri APIs — leaf, no React.
            if (nid.includes('/node_modules/@tauri-apps/')) {
              return 'vendor-tauri';
            }
            // Emoji data — large static data, leaf.
            if (
              nid.includes('/node_modules/emojibase/') ||
              nid.includes('/node_modules/emojibase-data/')
            ) {
              return 'vendor-emoji';
            }
            // Sucrase transpiler — leaf, only used by the extension loader.
            if (nid.includes('/node_modules/sucrase/')) {
              return 'vendor-sucrase';
            }
            // Anything else: let Vite/Rollup decide. Splitting more here
            // is what re-introduces the `createContext` cycle.
            return undefined;
          }

          // Emoji data (app-side) — large static JSON.
          if (id.includes('emojiData')) {
            return 'emoji-data';
          }

          // Plugin builtin components.
          if (id.includes('features/plugins/builtin') && !id.includes('emojiData')) {
            return 'plugins-builtin';
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
