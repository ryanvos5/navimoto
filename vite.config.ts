/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Navimoto',
        short_name: 'Navimoto',
        description: 'Navigatie-app voor motorrijders op basis van OpenStreetMap',
        lang: 'nl',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: base + 'index.html',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'osm-tiles', expiration: { maxEntries: 1500, maxAgeSeconds: 7 * 24 * 3600 } },
          },
          {
            urlPattern: /^https:\/\/[a-c]\.tile\.opentopomap\.org\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'topo-tiles', expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 24 * 3600 } },
          },
          {
            urlPattern: /^https:\/\/[a-c]\.tile-cyclosm\.openstreetmap\.fr\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'cyclosm-tiles', expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
