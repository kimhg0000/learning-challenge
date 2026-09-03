import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['robots.txt', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '15주 학습 챌린지',
        short_name: '15주 챌린지',
        description: '주 1회, 15주 동안 행동 목표를 실천하고 인증하는 모바일 학습 챌린지',
        lang: 'ko-KR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070911',
        theme_color: '#08090f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell (HTML/JS/CSS/icons) is cached for offline start-up.
        // Firestore/Storage calls go through the Firebase SDK, not fetch(),
        // and are never intercepted by this service worker, so student
        // data is never cached or served stale by the PWA layer.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
