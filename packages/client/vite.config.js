import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The built page may run only its own files and talk only to its own game
// server: a backstop, should player text ever end up somewhere it could run.
function contentSecurityPolicy() {
  let server;
  let home;
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(config) {
      server = new URL(config.env.VITE_SERVER_URL || 'ws://localhost:2567');
      // A copy at the old address asks the new home whether it's up (net/home.js).
      home = new URL(config.env.VITE_HOME_URL || 'https://hairypopsicles.com/the-mmo/').origin;
    },
    transformIndexHtml(html) {
      // The client joins over HTTP(S) to the same host, then opens the socket.
      const web = `${server.protocol === 'wss:' ? 'https:' : 'http:'}//${server.host}`;
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "media-src 'self' blob:",
        `connect-src 'self' ${server.protocol}//${server.host} ${web} ${home}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />', `$&\n  <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

// What a chat app shows when the link (or an invite link) is pasted in: the
// card is public/og.jpg, from tools/preview.py. Crawlers need its full address.
const PITCH = 'Grow gross little characters. Collect them all. Play as any of them, together. Free, on your phone.';
function linkPreview() {
  let site = '';
  return {
    name: 'link-preview',
    configResolved(config) {
      site = config.env.VITE_SITE_URL || config.base;
    },
    transformIndexHtml(html) {
      const tags = [
        `<meta name="description" content="${PITCH}" />`,
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Hairy Popsicles: The MMO" />',
        '<meta property="og:title" content="Hairy Popsicles: The MMO" />',
        `<meta property="og:description" content="${PITCH}" />`,
        `<meta property="og:image" content="${site}og.jpg" />`,
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        '<meta property="og:image:alt" content="Hairy Popsicles: a lineup of gross little characters" />',
        '<meta name="twitter:card" content="summary_large_image" />',
      ];
      return html.replace('</title>', `</title>\n  ${tags.join('\n  ')}`);
    },
  };
}

// home.json: which game this is and the path it's built to be served from.
// A copy at the old address moves to the new home only once the new home
// serves this game from the path it expects (net/home.js).
function homeMarker() {
  let base = '/';
  return {
    name: 'home-marker',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'home.json', source: JSON.stringify({ game: 'hairy-popsicles-mmo', base }) });
    },
  };
}

export default defineConfig({
  server: { port: 5173 },
  plugins: [
    contentSecurityPolicy(),
    linkPreview(),
    homeMarker(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The art and fonts aren't in the build's precache (too big, and the
        // art isn't hashed), so cache them as they're used: repeat visits
        // load from the phone, and changed art is picked up in the background.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/(characters|world|icons)\/.+\.(webp|png)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'art', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('.woff2'),
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
