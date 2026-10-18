import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({mode}) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/platform': loadEnv(mode,'.','LEDGERLINE_').LEDGERLINE_GATEWAY_URL || 'http://127.0.0.1:8088', '/api': loadEnv(mode,'.','LEDGERLINE_').LEDGERLINE_GATEWAY_URL || 'http://127.0.0.1:8088' },
    watch: {
      ignored: ['**/services/**', '**/.npm-cache/**', '**/test-results/**', '**/artifacts/**'],
    },
  },
}));
