const ROOT = new URL('./', import.meta.url);
const CACHE_PREFIX = `dither-shell-${encodeURIComponent(ROOT.pathname)}-`;
const CACHE = `${CACHE_PREFIX}v39`;
const FILES = [
  './', 'index.html', 'css/app.css', 'css/fonts.css', 'manifest.webmanifest',
  'icons/app-icon.svg', 'icons/app-192.png', 'icons/app-512.png', 'icons/app-maskable-512.png',
  'icons/ui.svg',
  'fonts/Noto Sans/noto-sans-latin-100.woff2',
  'fonts/Noto Sans/noto-sans-latin-100italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-200.woff2',
  'fonts/Noto Sans/noto-sans-latin-200italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-300.woff2',
  'fonts/Noto Sans/noto-sans-latin-300italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-500.woff2',
  'fonts/Noto Sans/noto-sans-latin-500italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-600.woff2',
  'fonts/Noto Sans/noto-sans-latin-600italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-700.woff2',
  'fonts/Noto Sans/noto-sans-latin-700italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-800.woff2',
  'fonts/Noto Sans/noto-sans-latin-800italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-900.woff2',
  'fonts/Noto Sans/noto-sans-latin-900italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-italic.woff2',
  'fonts/Noto Sans/noto-sans-latin-regular.woff2',
  'fonts/Inter/inter-latin-100.woff2',
  'fonts/Inter/inter-latin-100italic.woff2',
  'fonts/Inter/inter-latin-200.woff2',
  'fonts/Inter/inter-latin-200italic.woff2',
  'fonts/Inter/inter-latin-300.woff2',
  'fonts/Inter/inter-latin-300italic.woff2',
  'fonts/Inter/inter-latin-500.woff2',
  'fonts/Inter/inter-latin-500italic.woff2',
  'fonts/Inter/inter-latin-600.woff2',
  'fonts/Inter/inter-latin-600italic.woff2',
  'fonts/Inter/inter-latin-700.woff2',
  'fonts/Inter/inter-latin-700italic.woff2',
  'fonts/Inter/inter-latin-800.woff2',
  'fonts/Inter/inter-latin-800italic.woff2',
  'fonts/Inter/inter-latin-900.woff2',
  'fonts/Inter/inter-latin-900italic.woff2',
  'fonts/Inter/inter-latin-italic.woff2',
  'fonts/Inter/inter-latin-regular.woff2',
  'fonts/Noto Emoji/noto-emoji-300.woff2',
  'fonts/Noto Emoji/noto-emoji-500.woff2',
  'fonts/Noto Emoji/noto-emoji-600.woff2',
  'fonts/Noto Emoji/noto-emoji-700.woff2',
  'fonts/Noto Emoji/noto-emoji-regular.woff2',
  'js/interaction/tools.js', 'js/model/vector.js', 'js/rendering/paint.js', 'js/rendering/flood-fill.js', 'js/rendering/fill-worker.js',
  'js/app.js', 'js/model/document.js', 'js/model/effects.js', 'js/model/line.js',
  'js/model/pixel-region.js', 'js/interaction/pixel-selection.js', 'js/rendering/image-pixels.js',
  'js/history/history.js', 'js/storage/assets.js', 'js/storage/projects.js',
  'js/interaction/geometry.js', 'js/interaction/workspace.js', 'js/components/panels.js', 'js/components/panel-resizer.js',
  'js/components/context-menu.js',
  'js/components/document-presets.js', 'js/model/document-presets.js',
  'js/rendering/renderer.js', 'js/rendering/effects.js', 'js/rendering/dither.js',
  'js/rendering/pixels.js', 'js/rendering/pixel-worker.js'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new URL(file, ROOT).href)))); });
self.addEventListener('activate', event => { event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()); });
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) { if (event.request.mode === 'navigate') return (await cache.match(ROOT.href)) || Response.error(); throw error; }
  })());
});
