import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Multi-page build for separate windows
  build: {
    // Increase chunk size warning limit for desktop apps (local loading, no network impact)
    chunkSizeWarningLimit: 1000, // 1 MB
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
      output: {
        // Manual chunks for better code splitting
        manualChunks: (id) => {
          // Vendor libraries in separate chunks
          if (id.includes('node_modules')) {
            // React ecosystem + deps that cause circular chunk imports at init
            if (
              id.includes('react') ||
              id.includes('react-dom') ||
              id.includes('scheduler') ||
              id.includes('i18next') ||
              id.includes('zustand') ||
              id.includes('use-sync-external-store')
            ) {
              return 'vendor-react';
            }
            // Tauri APIs
            if (id.includes('@tauri-apps')) {
              return 'vendor-tauri';
            }
            // Heavy icon library - separate chunk
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            // Emoji data - large static data
            if (id.includes('emojibase')) {
              return 'vendor-emoji';
            }
            // Date utilities
            if (id.includes('date-fns')) {
              return 'vendor-date';
            }
            // Sucrase transpiler (for extensions)
            if (id.includes('sucrase')) {
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
