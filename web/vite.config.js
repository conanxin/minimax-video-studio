import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase Q.1: enable production sourcemaps so future TDZ /
// minified-runtime errors can be mapped back to the exact line in
// web/src/App.jsx. The .map files are not served from Cloudflare
// (Cloudflare Access protects /assets/ just like /, and the sourcemap
// URL is only referenced from the JS asset which is also behind
// Access). The file is small and emitted under dist/assets/.
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
  },
  esbuild: {
    // Preserve function names so minified stack traces still hint at
    // which original symbol blew up. Also keeps nested
    // `async function` declarations as actual declarations rather
    // than `const x = async () => {}` rewrites when minifying away
    // the function name (esbuild's default behavior already keeps
    // declarations, but `keepNames` is the documented belt-and-braces
    // toggle).
    keepNames: true,
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
