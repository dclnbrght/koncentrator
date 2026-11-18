const CACHE_PREFIX = 'koncentrator-static-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './playback.js',
  './styles.css',
  './config.json',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplication());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateApplication());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(serveFromCache(event.request));
});

async function cacheApplication() {
  const cache = await caches.open(CACHE_NAME);
  const shellUrls = SHELL_FILES.map(resolveScopedUrl);
  await cache.addAll(shellUrls);

  const configResponse = await cache.match(resolveScopedUrl('./config.json'));
  if (!configResponse?.ok) throw new Error('Could not cache audio configuration');

  const tiles = await configResponse.json();
  const assetUrls = tiles.flatMap(({ audio, image }) => [audio, image]).map(resolveScopedUrl);
  await cache.addAll([...new Set(assetUrls)]);
}

async function activateApplication() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
  await self.clients.claim();
}

async function serveFromCache(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === 'navigate') {
      const cachedIndex = await caches.match(resolveScopedUrl('./'));
      if (cachedIndex) return cachedIndex;
    }
    throw error;
  }
}

function resolveScopedUrl(path) {
  const url = new URL(path, self.registration.scope);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) {
    throw new Error(`Configured asset is outside the app scope: ${path}`);
  }
  return url;
}
