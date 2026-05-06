import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // We will connect directly to ws://localhost:2567, relying on CORS on the server
  },
});
