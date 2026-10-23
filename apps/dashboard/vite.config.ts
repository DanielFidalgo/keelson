import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Only used by `vite dev`: the built dashboard is served by the api itself, on the same origin.
const API_URL = process.env['KEELSON_API_URL'] ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/v1': API_URL } },
});
