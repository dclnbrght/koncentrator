# Koncentrator

Koncentrator is an ambient sound player for focus. Choose a sound tile to play it, and choose it again to stop. Only one sound plays at a time. Sounds loop continuously, with optional crossfades between loops.

Live version here: [Koncentrator](https://dclnbrght.github.io/koncentrator/)

![koncentrator](/docs/koncentrator-screenshot.webp)

## Configure audio tiles

Edit [`src/config.json`](src/config.json).

Each entry defines a sound tile:

| Property | Description |
| --- | --- |
| `title` | Tile label |
| `category` | Category heading used to group the tile |
| `audio` | Audio file path, relative to `src/` |
| `image` | Tile artwork path, relative to `src/` |
| `accent` | Tile accent color |
| `crossfadeSeconds` | Crossfade duration at each loop boundary, in seconds; use `0` when the audio is already seamless |

For example, `0.5` crossfades the last half-second of a sound into its next loop. Use `0` for audio with a mathematically wrapped waveform, prepared to loop without an audible boundary.

## Install and use offline

Serve the app over HTTPS (or localhost during development). After the service worker installs and caches the app and its configured sounds and artwork, the app is available offline. You can install it on devices using browsers that support progressive web apps.

Browsers and operating systems that support media controls can show the current sound and provide play, pause, and stop actions.