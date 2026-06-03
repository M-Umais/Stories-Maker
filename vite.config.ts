import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Safe HMR configuration:
      // 1. If DISABLE_HMR is set to true (standard in AI Studio to prevent unnecessary browser flickering during active coding),
      //    we completely disable HMR to prevent repeated WebSocket connection attempts and error noise.
      // 2. If HMR is enabled and running in the Cloud Run hosted environment, configure secure WebSockets (wss) over port 443.
      // 3. Otherwise, fall back to standard local HMR options.
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : (process.env.K_SERVICE
            ? { protocol: 'wss', clientPort: 443 }
            : true
          ),
      // Disable file watching when DISABLE_HMR is true to save CPU and RAM during edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
