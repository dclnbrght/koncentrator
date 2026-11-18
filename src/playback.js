const SCHEDULER_INTERVAL_MS = 250;
const SCHEDULER_AHEAD_SECONDS = 1;
const FADE_CURVE_STEPS = 64;

const FADE_IN_CURVE = Float32Array.from(
  { length: FADE_CURVE_STEPS },
  (_, index) => Math.sin((index / (FADE_CURVE_STEPS - 1)) * Math.PI / 2),
);
const FADE_OUT_CURVE = Float32Array.from(
  { length: FADE_CURVE_STEPS },
  (_, index) => Math.cos((index / (FADE_CURVE_STEPS - 1)) * Math.PI / 2),
);

export function createPlaybackController(onError = () => {}) {
  let audioContext = null;
  let activePlayback = null;
  const audioBuffers = new Map();

  async function play(audioPath, crossfadeSeconds) {
    stop();

    const playback = {
      audioPath,
      sources: new Set(),
      timer: null,
      nextStartTime: 0,
      buffer: null,
      fadeDuration: 0,
    };
    activePlayback = playback;

    try {
      audioContext ??= new AudioContext();
      await audioContext.resume();
      playback.buffer = await loadAudioBuffer(audioPath);

      if (activePlayback !== playback) return;
      if (!Number.isFinite(crossfadeSeconds) || crossfadeSeconds < 0) {
        throw new Error(`Invalid crossfade duration for ${audioPath}`);
      }

      playback.fadeDuration = Math.min(crossfadeSeconds, playback.buffer.duration / 4);
      playback.nextStartTime = audioContext.currentTime + 0.05;
      if (playback.fadeDuration === 0) {
        startSeamlessLoop(playback);
        return;
      }

      scheduleLoopSources(playback);
      playback.timer = setInterval(() => {
        try {
          scheduleLoopSources(playback);
        } catch (error) {
          stopPlayback(playback);
          onError(error, audioPath);
          console.error(`Could not schedule audio: ${audioPath}`, error);
        }
      }, SCHEDULER_INTERVAL_MS);
    } catch (error) {
      stopPlayback(playback);
      throw error;
    }
  }

  function stop() {
    if (activePlayback) stopPlayback(activePlayback);
  }

  function stopPlayback(playback) {
    if (activePlayback === playback) activePlayback = null;

    clearInterval(playback.timer);
    if (!audioContext) return;

    const stopTime = audioContext.currentTime;
    for (const { source, gain } of playback.sources) {
      gain.gain.cancelScheduledValues(stopTime);
      gain.gain.setTargetAtTime(0, stopTime, 0.015);
      source.stop(stopTime + 0.06);
    }
  }

  async function loadAudioBuffer(audioPath) {
    if (!audioBuffers.has(audioPath)) {
      const bufferPromise = fetch(audioPath)
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load audio file: ${audioPath}`);
          return response.arrayBuffer();
        })
        .then((data) => audioContext.decodeAudioData(data))
        .catch((error) => {
          audioBuffers.delete(audioPath);
          throw error;
        });

      audioBuffers.set(audioPath, bufferPromise);
    }

    return audioBuffers.get(audioPath);
  }

  function startSeamlessLoop(playback) {
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();

    source.buffer = playback.buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(audioContext.destination);

    const scheduledSource = { source, gain };
    playback.sources.add(scheduledSource);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      playback.sources.delete(scheduledSource);
    };

    source.start(playback.nextStartTime);
  }

  function scheduleLoopSources(playback) {
    const currentTime = audioContext.currentTime;
    const horizon = currentTime + SCHEDULER_AHEAD_SECONDS;
    const loopDuration = playback.buffer.duration - playback.fadeDuration;

    if (playback.nextStartTime < currentTime) {
      playback.nextStartTime = currentTime + 0.05;
    }

    while (playback.nextStartTime < horizon) {
      const startTime = playback.nextStartTime;
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();

      source.buffer = playback.buffer;
      source.connect(gain);
      gain.connect(audioContext.destination);

      if (playback.fadeDuration > 0) {
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.setValueCurveAtTime(FADE_IN_CURVE, startTime, playback.fadeDuration);
        gain.gain.setValueAtTime(1, startTime + playback.buffer.duration - playback.fadeDuration);
        gain.gain.setValueCurveAtTime(
          FADE_OUT_CURVE,
          startTime + playback.buffer.duration - playback.fadeDuration,
          playback.fadeDuration,
        );
      } else {
        gain.gain.setValueAtTime(1, startTime);
      }

      const scheduledSource = { source, gain };
      playback.sources.add(scheduledSource);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        playback.sources.delete(scheduledSource);
      };

      source.start(startTime);
      source.stop(startTime + playback.buffer.duration);
      playback.nextStartTime += loopDuration;
    }
  }

  return { play, stop };
}
