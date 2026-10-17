import { defineConfig } from 'vite';
import { decidePlugin } from './server/decide.js';

export default defineConfig({
  plugins: [decidePlugin()],
  server: { host: '127.0.0.1', port: Number(process.env.GAME_PORT || 5175), strictPort: true },
});
