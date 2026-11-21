const CACHE_PREFIX = 'koncentrator-static-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
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
const SHELL_URLS = new Set(SHELL_FILES.map(resolveScopedUrl).map((url) => url.href));

self.addEventListener('install', (event) => {
  event.waitUntil(installApplication());
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

async function installApplication() {
  await cacheApplication();
  await self.skipWaiting();
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
  const cache = await caches.open(CACHE_NAME);
  const isApplicationShell = SHELL_URLS.has(request.url);
  const cachedResponse = await cache.match(request);
  if (!isApplicationShell && cachedResponse) return cachedResponse;

  let response;
  try {
    response = await fetch(
      isApplicationShell ? new Request(request, { cache: 'no-cache' }) : request,
    );
  } catch (error) {
    if (cachedResponse) return cachedResponse;

    if (request.mode === 'navigate') {
      const cachedIndex = await cache.match(resolveScopedUrl('./'));
      if (cachedIndex) return cachedIndex;
    }
    throw error;
  }

  if (response.ok && response.type === 'basic') {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.error(`Could not update cached resource: ${request.url}`, error);
    }
  }
  return response;
}

function resolveScopedUrl(path) {
  const url = new URL(path, self.registration.scope);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) {
    throw new Error(`Configured asset is outside the app scope: ${path}`);
  }
  return url;
}
