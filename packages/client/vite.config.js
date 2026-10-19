import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Hairy Popsicles: The MMO',
        short_name: 'HP MMO',
        description: 'Tend a patch in a shared, hairy, pus-soaked little world.',
        theme_color: '#5b2a3a',
        background_color: '#1a0f14',
        display: 'standalone',
        // TODO: add real icons (192x192, 512x512) before this is worth installing.
        icons: [],
      },
    }),
  ],
});
