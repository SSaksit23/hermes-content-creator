import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// LLM API keys (OpenAI / Gemini) are never inlined into the browser bundle.
// All LLM traffic goes through the backend proxy (see `server/`), so the keys
// stay on the server. In dev mode, Vite proxies `/api/*` to the backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:8787';

  return {
    server: {
      port: 3001,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
