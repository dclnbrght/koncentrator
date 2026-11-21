const CACHE_PREFIX = 'koncentrator-static-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
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
  const rangeHeader = request.headers.get('range');
  const cachedResponse = await cache.match(rangeHeader ? request.url : request);
  if (!isApplicationShell && cachedResponse) {
    return rangeHeader ? createRangeResponse(cachedResponse, rangeHeader) : cachedResponse;
  }

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

  if (!rangeHeader && response.ok && response.status === 200 && response.type === 'basic') {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.error(`Could not update cached resource: ${request.url}`, error);
    }
  }
  return response;
}

async function createRangeResponse(response, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return response;

  const data = await response.arrayBuffer();
  const size = data.byteLength;
  const requestedStart = match[1] === '' ? null : Number(match[1]);
  const requestedEnd = match[2] === '' ? null : Number(match[2]);
  if (
    (requestedStart !== null && !Number.isSafeInteger(requestedStart))
    || (requestedEnd !== null && !Number.isSafeInteger(requestedEnd))
    || (requestedStart === null && (!requestedEnd || requestedEnd <= 0))
  ) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }
  const start = requestedStart ?? Math.max(0, size - requestedEnd);
  const end = requestedStart === null
    ? size - 1
    : Math.min(requestedEnd ?? size - 1, size - 1);

  if (!size || start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.delete('Content-Encoding');

  return new Response(data.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

function resolveScopedUrl(path) {
  const url = new URL(path, self.registration.scope);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) {
    throw new Error(`Configured asset is outside the app scope: ${path}`);
  }
  return url;
}
