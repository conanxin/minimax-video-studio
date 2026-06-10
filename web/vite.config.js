import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8789',
        changeOrigin: true,
      },
    },
  },
});
