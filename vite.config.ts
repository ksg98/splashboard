import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Set by `tauri dev` when developing on a device; unset on the desktop.
const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Where browser dev (`pnpm web`) sends /splash/* requests.
  const splashTarget = env.SPLASH_URL || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },

    // Keep Rust errors visible in `tauri dev`.
    clearScreen: false,
    // Expose TAURI_ENV_* (platform, debug) to the frontend as well as VITE_*.
    envPrefix: ['VITE_', 'TAURI_ENV_'],

    server: {
      // `tauri dev` loads this exact port (src-tauri/tauri.conf.json devUrl).
      port: 1420,
      strictPort: true,
      host: tauriDevHost || false,
      hmr: tauriDevHost ? { protocol: 'ws', host: tauriDevHost, port: 1421 } : undefined,
      watch: { ignored: ['**/src-tauri/**', '**/design/**', '**/fixtures/**'] },
      proxy: {
        // Browser-dev transport (src/lib/splash/transport-http.ts). Splash
        // refuses cross-origin requests, so the proxy forwards /splash/* to
        // the server as a same-origin request: Host is rewritten to the
        // target (changeOrigin) and the browser's Origin header is removed.
        '^/splash/.*': {
          target: splashTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/splash/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
            });
          },
        },
      },
    },

    build: {
      // WebKit on macOS 14+ (see bundle.macOS.minimumSystemVersion).
      target: 'safari17',
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },

    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});
