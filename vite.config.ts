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
        // Manual chunks for better code splitting.
        // IMPORTANT: anchor matches to /node_modules/<pkg>/ to avoid substring
        // collisions (e.g. 'react' would otherwise match 'react-snowfall',
        // 'react-i18next', 'unreact-foo', etc.).
        manualChunks: (id) => {
          // Normalize Windows backslashes so '/node_modules/<pkg>/' matches.
          const nid = id.replace(/\\/g, '/');

          // Vendor libraries in separate chunks
          if (nid.includes('/node_modules/')) {
            // React ecosystem + deps that cause circular chunk imports at init.
            // Each match is anchored to the package directory boundary.
            if (
              nid.includes('/node_modules/react/') ||
              nid.includes('/node_modules/react-dom/') ||
              nid.includes('/node_modules/scheduler/') ||
              nid.includes('/node_modules/i18next/') ||
              nid.includes('/node_modules/react-i18next/') ||
              nid.includes('/node_modules/zustand/') ||
              nid.includes('/node_modules/use-sync-external-store/')
            ) {
              return 'vendor-react';
            }
            // Tauri APIs (scoped @tauri-apps/*)
            if (nid.includes('/node_modules/@tauri-apps/')) {
              return 'vendor-tauri';
            }
            // Heavy icon library - separate chunk
            if (nid.includes('/node_modules/lucide-react/')) {
              return 'vendor-icons';
            }
            // Emoji data - large static data (emojibase, emojibase-data)
            if (
              nid.includes('/node_modules/emojibase/') ||
              nid.includes('/node_modules/emojibase-data/')
            ) {
              return 'vendor-emoji';
            }
            // Date utilities
            if (
              nid.includes('/node_modules/date-fns/') ||
              nid.includes('/node_modules/date-fns-tz/')
            ) {
              return 'vendor-date';
            }
            // Sucrase transpiler (for extensions)
            if (nid.includes('/node_modules/sucrase/')) {
              return 'vendor-sucrase';
            }
            // Other smaller vendor libs
            return 'vendor';
          }

          // Emoji data in separate chunk (large static data)
          if (id.includes('emojiData')) {
            return 'emoji-data';
          }

          // Plugin builtin components
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
