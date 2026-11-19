import { createPlaybackController } from './playback.js';

const LISTENING_STORAGE_KEY = 'koncentrator-listening-minutes';
const LISTENING_UPDATE_INTERVAL_MS = 60 * 1000;
const categoriesContainer = document.querySelector('#categories');
const status = document.querySelector('.status');
const statusText = document.querySelector('#statusText');

let activeTile = null;
let isPlaybackPaused = false;
let playbackRequest = 0;
let listeningSession = null;
let listeningUpdateTimer = null;
const listenedMinutesByKey = loadListeningMinutes();
const listeningRemainderMsByKey = new Map();
const playback = createPlaybackController((error, audioPath) => {
  if (activeTile?.dataset.audio !== audioPath) return;

  stopActiveTile();
  statusText.textContent = 'Playback unavailable';
  console.error(`Could not play ${audioPath}`, error);
});

async function loadTiles() {
  try {
    const response = await fetch('config.json');
    if (!response.ok) throw new Error('Could not load audio configuration');

    const tiles = await response.json();
    renderTiles(tiles);
  } catch (error) {
    categoriesContainer.innerHTML = `<p class="error-message">${error.message}. Please serve the app over HTTP.</p>`;
  }
}

function renderTiles(tiles) {
  const categories = tiles.reduce((groups, tile) => {
    (groups[tile.category] ??= []).push(tile);
    return groups;
  }, {});

  categoriesContainer.innerHTML = Object.entries(categories)
    .map(([category, categoryTiles]) => `
      <section class="category">
        <h2 class="category-title">${category}</h2>
        <div class="tile-grid">
          ${categoryTiles.map(createTile).join('')}
        </div>
      </section>
    `)
    .join('');

  categoriesContainer.querySelectorAll('.audio-tile').forEach((tile) => {
    tile.addEventListener('click', () => toggleTile(tile));
  });
}

function createTile(tile) {
  const listenedMinutes = listenedMinutesByKey[tile.key] ?? 0;

  return `
    <button class="audio-tile" type="button" aria-pressed="false"
      aria-label="Play ${tile.title}" style="--tile-accent: ${tile.accent}"
      data-key="${tile.key}" data-audio="${tile.audio}"
      data-crossfade-seconds="${tile.crossfadeSeconds}">
      <img class="tile-image" src="${tile.image}" alt="${tile.title} ambient texture" />
      <span class="tile-shade" aria-hidden="true"></span>
      <span class="tile-duration">${formatListeningDuration(listenedMinutes)}</span>
      <span class="tile-details">
        <span class="tile-name">${tile.title}</span>
        <span class="play-button" aria-hidden="true"><span class="play-icon"></span></span>
      </span>
    </button>
  `;
}

async function toggleTile(tile) {
  if (activeTile === tile) {
    stopActiveTile();
    return;
  }

  stopActiveTile();

  const title = tile.querySelector('.tile-name').textContent;
  const request = ++playbackRequest;
  activeTile = tile;
  tile.setAttribute('aria-pressed', 'true');
  tile.setAttribute('aria-label', `Stop ${title}`);
  status.classList.add('is-playing');
  statusText.textContent = `Loading ${title}`;

  try {
    const configuredFade = Number(tile.dataset.crossfadeSeconds);
    if (!Number.isFinite(configuredFade) || configuredFade < 0) {
      throw new Error(`Invalid crossfade duration for ${title}`);
    }

    await playback.play(tile.dataset.audio, configuredFade);
    if (request !== playbackRequest) return;
    startListening(tile.dataset.key);
    setMediaMetadata(tile);
    setMediaPlaybackState('playing');
    statusText.textContent = `Playing ${title}`;
  } catch (error) {
    if (request !== playbackRequest) return;

    stopActiveTile();
    statusText.textContent = 'Playback unavailable';
    console.error(`Could not play ${title}`, error);
  }
}

function stopActiveTile() {
  stopListening();
  playbackRequest++;
  playback.stop();
  isPlaybackPaused = false;

  if (activeTile) {
    activeTile.setAttribute('aria-pressed', 'false');
    const title = activeTile.querySelector('.tile-name').textContent;
    activeTile.setAttribute('aria-label', `Play ${title}`);
  }
  activeTile = null;
  status.classList.remove('is-playing');
  statusText.textContent = 'Nothing playing';
  clearMediaSession();
}

async function pauseActiveTile() {
  if (!activeTile || isPlaybackPaused) return;

  const tile = activeTile;
  const title = tile.querySelector('.tile-name').textContent;
  const request = playbackRequest;

  try {
    await playback.pause();
    if (activeTile !== tile || request !== playbackRequest) return;

    stopListening();
    isPlaybackPaused = true;
    statusText.textContent = `Paused ${title}`;
    setMediaPlaybackState('paused');
  } catch (error) {
    console.error(`Could not pause ${title}`, error);
  }
}

async function resumeActiveTile() {
  if (!activeTile || !isPlaybackPaused) return;

  const tile = activeTile;
  const title = tile.querySelector('.tile-name').textContent;
  const request = playbackRequest;

  try {
    await playback.resume();
    if (activeTile !== tile || request !== playbackRequest) return;

    isPlaybackPaused = false;
    startListening(tile.dataset.key);
    statusText.textContent = `Playing ${title}`;
    setMediaPlaybackState('playing');
  } catch (error) {
    console.error(`Could not resume ${title}`, error);
  }
}

function configureMediaSession() {
  if (!('mediaSession' in navigator)) return;

  for (const [action, handler] of [
    ['play', resumeActiveTile],
    ['pause', pauseActiveTile],
    ['stop', stopActiveTile],
  ]) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      console.warn(`Media session action is not supported: ${action}`, error);
    }
  }
}

function setMediaMetadata(tile) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: tile.querySelector('.tile-name').textContent,
    artist: 'Koncentrator',
    album: tile.closest('.category')?.querySelector('.category-title')?.textContent ?? '',
    artwork: [
      {
        src: new URL(tile.querySelector('.tile-image').getAttribute('src'), document.baseURI).href,
        type: 'image/svg+xml',
      },
      {
        src: new URL('icons/icon-512.png', document.baseURI).href,
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  });
}

function setMediaPlaybackState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = null;
  setMediaPlaybackState('none');
}

function loadListeningMinutes() {
  try {
    const storedMinutes = localStorage.getItem(LISTENING_STORAGE_KEY);
    if (storedMinutes === null) return {};

    const parsedMinutes = JSON.parse(storedMinutes);
    if (!parsedMinutes || typeof parsedMinutes !== 'object' || Array.isArray(parsedMinutes)) {
      throw new Error('Listening history must be an object');
    }

    const wholeMinutesByKey = {};
    for (const [key, minutes] of Object.entries(parsedMinutes)) {
      if (!key || !Number.isFinite(minutes) || minutes < 0) {
        throw new Error('Listening history contains an invalid duration');
      }
      wholeMinutesByKey[key] = Math.floor(minutes);
    }

    if (Object.entries(parsedMinutes).some(
      ([key, minutes]) => minutes !== wholeMinutesByKey[key],
    )) {
      try {
        localStorage.setItem(LISTENING_STORAGE_KEY, JSON.stringify(wholeMinutesByKey));
      } catch (error) {
        console.error('Could not normalize listening history in local storage', error);
      }
    }

    return wholeMinutesByKey;
  } catch (error) {
    console.error('Could not load listening history from local storage', error);
    return {};
  }
}

function saveListeningMinutes() {
  try {
    localStorage.setItem(LISTENING_STORAGE_KEY, JSON.stringify(listenedMinutesByKey));
  } catch (error) {
    console.error('Could not save listening history to local storage', error);
  }
}

function formatListeningDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours} hrs ${minutes} mins`;
}

function updateListeningDuration() {
  if (!listeningSession) return;

  const elapsedMs = listeningSession.remainderMs
    + performance.now()
    - listeningSession.startedAt;
  const completedMinutes = Math.floor(elapsedMs / LISTENING_UPDATE_INTERVAL_MS);
  const totalMinutes = listeningSession.baseMinutes + completedMinutes;
  listeningRemainderMsByKey.set(
    listeningSession.key,
    elapsedMs % LISTENING_UPDATE_INTERVAL_MS,
  );

  if (activeTile?.dataset.key === listeningSession.key) {
    activeTile.querySelector('.tile-duration').textContent =
      formatListeningDuration(totalMinutes);
  }

  if (totalMinutes > (listenedMinutesByKey[listeningSession.key] ?? 0)) {
    listenedMinutesByKey[listeningSession.key] = totalMinutes;
    saveListeningMinutes();
  }
}

function startListening(key) {
  listeningSession = {
    key,
    baseMinutes: listenedMinutesByKey[key] ?? 0,
    remainderMs: listeningRemainderMsByKey.get(key) ?? 0,
    startedAt: performance.now(),
  };
  updateListeningDuration();
  listeningUpdateTimer = setInterval(
    updateListeningDuration,
    LISTENING_UPDATE_INTERVAL_MS,
  );
}

function stopListening() {
  if (listeningUpdateTimer !== null) {
    clearInterval(listeningUpdateTimer);
    listeningUpdateTimer = null;
  }
  updateListeningDuration();
  listeningSession = null;
}

window.addEventListener('pagehide', stopListening);
configureMediaSession();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch((error) => console.error('Could not register service worker', error));
}

loadTiles();
