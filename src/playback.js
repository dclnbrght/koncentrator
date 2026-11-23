const FADE_CURVE_STEPS = 64;
const STOP_FADE_SECONDS = 0.025;

const FADE_IN_CURVE = Float32Array.from(
  { length: FADE_CURVE_STEPS },
  (_, index) => Math.sin((index / (FADE_CURVE_STEPS - 1)) * Math.PI / 2),
);
const FADE_OUT_CURVE = Float32Array.from(
  { length: FADE_CURVE_STEPS },
  (_, index) => Math.cos((index / (FADE_CURVE_STEPS - 1)) * Math.PI / 2),
);

export function createPlaybackController(onError = () => {}, onPause = () => {}) {
  let audioContext = null;
  let activePlayback = null;

  async function play(audioPath, crossfadeSeconds) {
    stop();

    const playback = {
      audioPath,
      sources: new Set(),
      timer: null,
      nextStartDelayMs: null,
      nextPrepared: null,
      nextBoundarySource: null,
      nextBoundaryTime: 0,
      isPaused: false,
      stopped: false,
    };
    activePlayback = playback;

    try {
      audioContext ??= new AudioContext();
      await audioContext.resume();
      if (activePlayback !== playback) return;
      if (!Number.isFinite(crossfadeSeconds) || crossfadeSeconds < 0) {
        throw new Error(`Invalid crossfade duration for ${audioPath}`);
      }

      if (crossfadeSeconds === 0) {
        await startMediaElementLoop(playback);
        return;
      }

      const firstElement = await createMediaElement(playback);
      if (activePlayback !== playback) {
        releaseMediaElement(playback, firstElement);
        return;
      }

      const fadeDuration = Math.min(crossfadeSeconds, firstElement.duration / 4);
      await startCrossfadedElement(playback, firstElement, fadeDuration);
    } catch (error) {
      stopPlayback(playback);
      throw error;
    }
  }

  function stop() {
    if (activePlayback) stopPlayback(activePlayback);
  }

  async function pause() {
    const playback = activePlayback;
    if (!playback || playback.isPaused) return;

    await pausePlayback(playback);
  }

  async function resume() {
    const playback = activePlayback;
    if (!playback || !playback.isPaused) return;

    if (audioContext?.state === 'suspended') await audioContext.resume();
    await Promise.all(
      [...playback.sources]
        .filter((scheduledSource) => scheduledSource.started)
        .map((scheduledSource) => scheduledSource.mediaElement.play()),
    );
    if (activePlayback !== playback) return;

    playback.isPaused = false;
    if (playback.nextPrepared) {
      scheduleNextElement(playback, getNextStartDelay(playback));
    }
  }

  async function pausePlayback(playback) {
    playback.isPaused = true;
    clearTimeout(playback.timer);
    playback.timer = null;
    playback.nextStartDelayMs = getNextStartDelay(playback);

    for (const scheduledSource of playback.sources) {
      if (scheduledSource.started) scheduledSource.mediaElement.pause();
    }
    if (audioContext?.state === 'running') {
      await audioContext.suspend();
      if (activePlayback !== playback && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
    }
  }

  function handleMediaPause(playback, scheduledSource) {
    if (
      playback !== activePlayback
      || playback.isPaused
      || playback.stopped
      || scheduledSource.isBeingReleased
      || scheduledSource.mediaElement.ended
    ) return;

    void pausePlayback(playback)
      .then(() => {
        if (activePlayback === playback) onPause();
      })
      .catch((error) => {
        if (activePlayback !== playback) return;
        onError(error, playback.audioPath);
        console.error(`Could not pause audio: ${playback.audioPath}`, error);
      });
  }

  function getNextStartDelay(playback) {
    if (!playback.nextBoundarySource) return playback.nextStartDelayMs ?? 0;
    const remainingSeconds = playback.nextBoundaryTime
      - playback.nextBoundarySource.mediaElement.currentTime;
    return Math.max(0, remainingSeconds * 1000);
  }

  function stopPlayback(playback) {
    if (playback.stopped) return;
    playback.stopped = true;
    if (activePlayback === playback) activePlayback = null;

    clearTimeout(playback.timer);
    for (const scheduledSource of playback.sources) {
      if (!scheduledSource.started || audioContext?.state !== 'running') {
        releaseMediaElement(playback, scheduledSource);
        continue;
      }

      const stopTime = audioContext.currentTime;
      scheduledSource.stopGain.gain.setValueAtTime(1, stopTime);
      scheduledSource.stopGain.gain.linearRampToValueAtTime(0, stopTime + STOP_FADE_SECONDS);
      setTimeout(() => releaseMediaElement(playback, scheduledSource), STOP_FADE_SECONDS * 1000);
    }
    playback.nextPrepared = null;
  }

  async function startMediaElementLoop(playback) {
    const scheduledSource = await createMediaElement(playback);
    if (activePlayback !== playback) {
      releaseMediaElement(playback, scheduledSource);
      return;
    }

    scheduledSource.mediaElement.loop = true;
    await startMediaElement(playback, scheduledSource, 0);
  }

  async function createMediaElement(playback) {
    const mediaElement = new Audio();
    mediaElement.preload = 'auto';
    const source = audioContext.createMediaElementSource(mediaElement);
    const gain = audioContext.createGain();
    const stopGain = audioContext.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(stopGain);
    stopGain.connect(audioContext.destination);

    const scheduledSource = { source, gain, stopGain, mediaElement, duration: 0, started: false };
    playback.sources.add(scheduledSource);
    mediaElement.src = playback.audioPath;

    try {
      if (mediaElement.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise((resolve, reject) => {
          mediaElement.addEventListener('loadedmetadata', resolve, { once: true });
          mediaElement.addEventListener(
            'error',
            () => reject(new Error(`Could not load audio file: ${playback.audioPath}`)),
            { once: true },
          );
        });
      }
      if (!Number.isFinite(mediaElement.duration) || mediaElement.duration <= 0) {
        throw new Error(`Invalid audio duration for ${playback.audioPath}`);
      }
      scheduledSource.duration = mediaElement.duration;
      mediaElement.addEventListener('pause', () => handleMediaPause(playback, scheduledSource));
      mediaElement.addEventListener('ended', () => releaseMediaElement(playback, scheduledSource), { once: true });
      return scheduledSource;
    } catch (error) {
      releaseMediaElement(playback, scheduledSource);
      throw error;
    }
  }

  async function startCrossfadedElement(playback, scheduledSource, fadeDuration) {
    await startMediaElement(playback, scheduledSource, fadeDuration);
    if (activePlayback !== playback || !scheduledSource.started) return;

    playback.nextBoundarySource = scheduledSource;
    playback.nextBoundaryTime = scheduledSource.duration - fadeDuration;
    void prepareNextElement(playback, fadeDuration);
  }

  async function startMediaElement(playback, scheduledSource, fadeDuration) {
    const { mediaElement, gain } = scheduledSource;
    scheduledSource.started = true;
    await mediaElement.play();
    if (activePlayback !== playback) {
      releaseMediaElement(playback, scheduledSource);
      return;
    }
    if (playback.isPaused) {
      mediaElement.pause();
      return;
    }

    const startTime = audioContext.currentTime;
    if (fadeDuration > 0) {
      const fadeOutStart = startTime + scheduledSource.duration - fadeDuration;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.setValueCurveAtTime(FADE_IN_CURVE, startTime, fadeDuration);
      gain.gain.setValueAtTime(1, fadeOutStart);
      gain.gain.setValueCurveAtTime(FADE_OUT_CURVE, fadeOutStart, fadeDuration);
    } else {
      gain.gain.setValueAtTime(1, startTime);
    }
  }

  async function prepareNextElement(playback, fadeDuration) {
    try {
      const scheduledSource = await createMediaElement(playback);
      if (activePlayback !== playback) {
        releaseMediaElement(playback, scheduledSource);
        return;
      }

      playback.nextPrepared = scheduledSource;
      playback.nextStartDelayMs = getNextStartDelay(playback);
      playback.nextFadeDuration = Math.min(fadeDuration, scheduledSource.duration / 4);
      if (!playback.isPaused) {
        scheduleNextElement(playback, playback.nextStartDelayMs);
      }
    } catch (error) {
      if (activePlayback !== playback) return;
      stopPlayback(playback);
      onError(error, playback.audioPath);
      console.error(`Could not prepare audio: ${playback.audioPath}`, error);
    }
  }

  function scheduleNextElement(playback, delayMs) {
    clearTimeout(playback.timer);
    playback.nextStartDelayMs = delayMs;
    playback.timer = setTimeout(() => {
      playback.timer = null;
      const scheduledSource = playback.nextPrepared;
      playback.nextPrepared = null;
      playback.nextStartDelayMs = null;
      if (!scheduledSource || activePlayback !== playback) return;

      startCrossfadedElement(playback, scheduledSource, playback.nextFadeDuration)
        .catch((error) => {
          if (activePlayback !== playback) return;
          stopPlayback(playback);
          onError(error, playback.audioPath);
          console.error(`Could not play audio: ${playback.audioPath}`, error);
        });
    }, delayMs);
  }

  function releaseMediaElement(playback, scheduledSource) {
    if (!playback.sources.has(scheduledSource)) return;
    scheduledSource.isBeingReleased = true;
    scheduledSource.mediaElement.pause();
    scheduledSource.mediaElement.removeAttribute('src');
    scheduledSource.source.disconnect();
    scheduledSource.gain.disconnect();
    scheduledSource.stopGain.disconnect();
    playback.sources.delete(scheduledSource);
  }

  return { play, pause, resume, stop };
}
