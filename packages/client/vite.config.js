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
        theme_color: '#0e0608',
        background_color: '#0e0608',
        display: 'standalone',
        // From tools/icons.py.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
});
