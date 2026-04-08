import type { PlaybackStateSnapshot } from "@/types/playback";

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundToMilliseconds(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function createInitialPlaybackState(
  overrides: Partial<PlaybackStateSnapshot> = {},
): PlaybackStateSnapshot {
  return {
    status: "stopped",
    currentTime: 0,
    playbackRate: 1,
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function stepPlaybackTime(currentTime: number, deltaSeconds: number) {
  return roundToMilliseconds(Math.max(0, currentTime + deltaSeconds));
}

export function applyPlaybackPatch(
  currentState: PlaybackStateSnapshot,
  patch: Partial<PlaybackStateSnapshot>,
): PlaybackStateSnapshot {
  return {
    ...currentState,
    ...patch,
    currentTime: roundToMilliseconds(
      Math.max(0, patch.currentTime ?? currentState.currentTime),
    ),
    playbackRate: clampNumber(
      patch.playbackRate ?? currentState.playbackRate,
      0.25,
      3,
    ),
    version: currentState.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function syncObservedPlayback(
  currentState: PlaybackStateSnapshot,
  patch: Partial<PlaybackStateSnapshot>,
): PlaybackStateSnapshot {
  return {
    ...currentState,
    ...patch,
    currentTime: roundToMilliseconds(
      Math.max(0, patch.currentTime ?? currentState.currentTime),
    ),
    playbackRate: clampNumber(
      patch.playbackRate ?? currentState.playbackRate,
      0.25,
      3,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function resolveSynchronizedPlaybackTime(
  playback: PlaybackStateSnapshot,
  now = Date.now(),
) {
  if (playback.status !== "playing") {
    return roundToMilliseconds(Math.max(0, playback.currentTime));
  }

  const elapsedSeconds = Math.max(
    0,
    (now - new Date(playback.updatedAt).getTime()) / 1000,
  );

  return roundToMilliseconds(
    Math.max(0, playback.currentTime + elapsedSeconds * playback.playbackRate),
  );
}

export function formatPlaybackSeconds(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
