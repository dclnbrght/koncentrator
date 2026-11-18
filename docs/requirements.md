# Koncentrator Requirements

## Overview

Koncentrator is a simple, responsive single-page web app that helps users concentrate by playing ambient audio.

## Functional Requirements

- Display each available audio option as a clickable tile.
- Group and display tiles by category.
- Each tile must include an image that clearly represents its audio content.
- Clicking an inactive tile starts its audio and changes the tile to the on state.
- Clicking the active tile stops its audio and changes the tile to the off state.
- Only one tile may be active at a time:
  - Starting a different tile stops the currently playing tile.
  - The previously active tile changes to the off state.
- Audio clips stored in `src/audio/` must loop seamlessly, using a configurable crossfade between the end and start of each loop.
- Tile content must be configurable in JSON, including:
  - Audio file path
  - Image file path
  - Category
  - Crossfade duration in seconds
- Keep track of how many minutes each audio file is listened to
  - persist the minute values in local storage
  - display the duration in X hrs Y mins format, at the top left of each tile, in grey font
  - update the duration dynamically

## Visual and Technical Requirements

- Use fresh, modern visual styling with a clean, polished layout.
- Implement the app with HTML, CSS, and vanilla JavaScript.
- Do not use a frontend framework or additional JavaScript libraries.
- Keep configuration separate from the application logic.
- Use responsive layouts that work on mobile and laptop devices.
