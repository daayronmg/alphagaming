import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ESTRELLA',
        short_name: 'ESTRELLA',
        description: 'Sistema operativo de la Banda de Cornetas y Tambores Estrella de Málaga',
        lang: 'es',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            // partituras, audios e imágenes: inmutables → disponibles sin conexión una vez abiertas o descargadas
            urlPattern: ({ url }) => url.pathname.startsWith('/api/files/'),
            handler: 'CacheFirst',
            options: { cacheName: 'estrella-archivos', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180 }, cacheableResponse: { statuses: [200] }, rangeRequests: true },
          },
          {
            // datos de consulta: red primero, copia local si no hay conexión
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET' && !url.pathname.startsWith('/api/files/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'estrella-datos', networkTimeoutSeconds: 6, expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
