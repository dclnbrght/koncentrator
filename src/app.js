import { createPlaybackController } from './playback.js';

const categoriesContainer = document.querySelector('#categories');
const status = document.querySelector('.status');
const statusText = document.querySelector('#statusText');

let activeTile = null;
let playbackRequest = 0;
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
  return `
    <button class="audio-tile" type="button" aria-pressed="false"
      aria-label="Play ${tile.title}" style="--tile-accent: ${tile.accent}"
      data-audio="${tile.audio}" data-crossfade-seconds="${tile.crossfadeSeconds}">
      <img class="tile-image" src="${tile.image}" alt="${tile.title} ambient texture" />
      <span class="tile-shade" aria-hidden="true"></span>
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
    statusText.textContent = `Playing ${title}`;
  } catch (error) {
    if (request !== playbackRequest) return;

    stopActiveTile();
    statusText.textContent = 'Playback unavailable';
    console.error(`Could not play ${title}`, error);
  }
}

function stopActiveTile() {
  playbackRequest++;
  playback.stop();

  if (activeTile) {
    activeTile.setAttribute('aria-pressed', 'false');
    const title = activeTile.querySelector('.tile-name').textContent;
    activeTile.setAttribute('aria-label', `Play ${title}`);
  }
  activeTile = null;
  activeTile = null;
  status.classList.remove('is-playing');
  statusText.textContent = 'Nothing playing';
}

loadTiles();
