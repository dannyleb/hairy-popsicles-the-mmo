import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The art and fonts aren't in the build's precache (too big, and the
        // art isn't hashed), so cache them as they're used: repeat visits
        // load from the phone, and changed art is picked up in the background.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(characters|world|icons)\/.+\.(webp|png)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'art', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
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
