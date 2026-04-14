import type { PlaybackStateSnapshot, PlaybackStatus } from "@/types/playback";

type SharedPlaybackCommandType = "play" | "pause" | "stop" | "seek";

export type BuildAuthoritativePlaybackStateInput = {
  clientEventId: string | null;
  currentTime: number;
  nowWallClockMs: number;
  playbackRate: number;
  status: PlaybackStatus;
  type: SharedPlaybackCommandType;
  version: number;
};

export type PlaybackDriftCorrection =
  | {
      kind: "none";
      driftSeconds: number;
      targetPlaybackRate: number;
      targetTime: null;
    }
  | {
      kind: "smooth";
      driftSeconds: number;
      targetPlaybackRate: number;
      targetTime: null;
    }
  | {
      kind: "hard_seek";
      driftSeconds: number;
      targetPlaybackRate: number;
      targetTime: number;
    };

export const playbackSynchronizationConfig = {
  scheduledStartLeadTimeMs: 1000,
  roomReconciliationIntervalMs: 500,
  roomDriftIgnoreThresholdSeconds: 0.08,
  roomDriftHardSeekThresholdSeconds: 0.25,
  roomSmoothCorrectionRateDelta: 0.03,
  pauseConvergenceThresholdSeconds: 0.05,
  localMediaSyncThresholdSeconds: 0.08,
  localMediaCorrectionThresholdSeconds: 0.12,
  localMediaCorrectionThrottleMs: 250,
} as const;

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampPlaybackRate(playbackRate: number) {
  return clampNumber(playbackRate, 0.25, 3);
}

export function roundPlaybackSeconds(value: number) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

export function roundWallClockMs(value: number) {
  return Math.round(Math.max(0, value));
}

function normalizeScheduledStartWallClockMs(
  status: PlaybackStatus,
  anchorWallClockMs: number,
  scheduledStartWallClockMs: number | null,
) {
  if (status !== "playing") {
    return null;
  }

  return roundWallClockMs(scheduledStartWallClockMs ?? anchorWallClockMs);
}

function resolveNormalizedAnchorWallClockMs(
  playback: PlaybackStateSnapshot,
  fallbackNow = Date.now(),
) {
  if (
    typeof playback.anchorWallClockMs === "number" &&
    Number.isFinite(playback.anchorWallClockMs)
  ) {
    return roundWallClockMs(playback.anchorWallClockMs);
  }

  const updatedAtWallClockMs = new Date(playback.updatedAt).getTime();

  if (Number.isFinite(updatedAtWallClockMs)) {
    return roundWallClockMs(updatedAtWallClockMs);
  }

  return roundWallClockMs(fallbackNow);
}

export function createInitialPlaybackState(
  overrides: Partial<PlaybackStateSnapshot> = {},
): PlaybackStateSnapshot {
  const nowWallClockMs = roundWallClockMs(Date.now());
  const nextState: PlaybackStateSnapshot = {
    status: "stopped",
    currentTime: 0,
    anchorMediaTime: 0,
    anchorWallClockMs: nowWallClockMs,
    scheduledStartWallClockMs: null,
    playbackRate: 1,
    version: 1,
    updatedAt: new Date(nowWallClockMs).toISOString(),
    sourceClientEventId: null,
    ...overrides,
  };

  nextState.playbackRate = clampPlaybackRate(nextState.playbackRate);
  nextState.anchorMediaTime = roundPlaybackSeconds(
    overrides.anchorMediaTime ?? nextState.currentTime,
  );
  nextState.anchorWallClockMs = resolveNormalizedAnchorWallClockMs(
    nextState,
    nowWallClockMs,
  );
  nextState.scheduledStartWallClockMs = normalizeScheduledStartWallClockMs(
    nextState.status,
    nextState.anchorWallClockMs,
    nextState.scheduledStartWallClockMs,
  );
  nextState.currentTime = roundPlaybackSeconds(
    overrides.currentTime ?? resolveSynchronizedPlaybackTime(nextState, nowWallClockMs),
  );

  return nextState;
}

export function stepPlaybackTime(currentTime: number, deltaSeconds: number) {
  return roundPlaybackSeconds(currentTime + deltaSeconds);
}

export function resolvePlaybackAnchorWallClockMs(
  playback: PlaybackStateSnapshot,
  fallbackNow = Date.now(),
) {
  return resolveNormalizedAnchorWallClockMs(playback, fallbackNow);
}

export function isPlaybackActivelyRunning(
  playback: PlaybackStateSnapshot,
  nowWallClockMs = Date.now(),
) {
  return (
    playback.status === "playing" &&
    nowWallClockMs >= resolvePlaybackAnchorWallClockMs(playback, nowWallClockMs)
  );
}

export function resolvePlaybackStartDelayMs(
  playback: PlaybackStateSnapshot,
  nowWallClockMs = Date.now(),
) {
  if (playback.status !== "playing") {
    return 0;
  }

  return Math.max(
    0,
    resolvePlaybackAnchorWallClockMs(playback, nowWallClockMs) - nowWallClockMs,
  );
}

export function resolveSynchronizedPlaybackTime(
  playback: PlaybackStateSnapshot,
  nowWallClockMs = Date.now(),
) {
  if (playback.status !== "playing") {
    return roundPlaybackSeconds(playback.anchorMediaTime);
  }

  const anchorWallClockMs = resolvePlaybackAnchorWallClockMs(
    playback,
    nowWallClockMs,
  );
  const elapsedSeconds = Math.max(0, (nowWallClockMs - anchorWallClockMs) / 1000);

  return roundPlaybackSeconds(
    playback.anchorMediaTime + elapsedSeconds * playback.playbackRate,
  );
}

export function applyPlaybackPatch(
  currentState: PlaybackStateSnapshot,
  patch: Partial<PlaybackStateSnapshot>,
) {
  const nowWallClockMs = Date.now();
  const anchorMediaTime = roundPlaybackSeconds(
    patch.anchorMediaTime ?? patch.currentTime ?? currentState.anchorMediaTime,
  );
  const anchorWallClockMs = roundWallClockMs(
    patch.anchorWallClockMs ?? currentState.anchorWallClockMs,
  );
  const nextState = createInitialPlaybackState({
    ...currentState,
    ...patch,
    anchorMediaTime,
    anchorWallClockMs,
    scheduledStartWallClockMs: normalizeScheduledStartWallClockMs(
      patch.status ?? currentState.status,
      anchorWallClockMs,
      patch.scheduledStartWallClockMs ?? currentState.scheduledStartWallClockMs,
    ),
    playbackRate: clampPlaybackRate(
      patch.playbackRate ?? currentState.playbackRate,
    ),
    version: currentState.version + 1,
    updatedAt: new Date(nowWallClockMs).toISOString(),
  });

  return {
    ...nextState,
    currentTime: resolveSynchronizedPlaybackTime(nextState, nowWallClockMs),
  };
}

export function syncObservedPlayback(
  currentState: PlaybackStateSnapshot,
  patch: Partial<PlaybackStateSnapshot>,
) {
  return createInitialPlaybackState({
    ...currentState,
    ...patch,
    currentTime: roundPlaybackSeconds(
      patch.currentTime ?? currentState.currentTime,
    ),
    updatedAt: new Date().toISOString(),
  });
}

export function buildAuthoritativePlaybackState(
  input: BuildAuthoritativePlaybackStateInput,
) {
  const nextStatus =
    input.type === "stop"
      ? "stopped"
      : input.type === "play"
        ? "playing"
        : input.type === "pause"
          ? "paused"
          : input.status;
  const nextAnchorMediaTime =
    input.type === "stop" ? 0 : roundPlaybackSeconds(input.currentTime);
  const nextPlaybackRate = clampPlaybackRate(input.playbackRate);
  const nextAnchorWallClockMs =
    nextStatus === "playing"
      ? roundWallClockMs(
          input.nowWallClockMs +
            playbackSynchronizationConfig.scheduledStartLeadTimeMs,
        )
      : roundWallClockMs(input.nowWallClockMs);

  return createInitialPlaybackState({
    status: nextStatus,
    currentTime: nextAnchorMediaTime,
    anchorMediaTime: nextAnchorMediaTime,
    anchorWallClockMs: nextAnchorWallClockMs,
    scheduledStartWallClockMs:
      nextStatus === "playing" ? nextAnchorWallClockMs : null,
    playbackRate: nextPlaybackRate,
    version: input.version,
    updatedAt: new Date(input.nowWallClockMs).toISOString(),
    sourceClientEventId: input.clientEventId,
  });
}

export function resolvePlaybackDriftCorrection(input: {
  actualTime: number;
  basePlaybackRate: number;
  expectedTime: number;
}) {
  const driftSeconds = roundPlaybackSeconds(input.expectedTime - input.actualTime);
  const absoluteDriftSeconds = Math.abs(driftSeconds);
  const normalizedPlaybackRate = clampPlaybackRate(input.basePlaybackRate);

  if (
    absoluteDriftSeconds < playbackSynchronizationConfig.roomDriftIgnoreThresholdSeconds
  ) {
    return {
      kind: "none" as const,
      driftSeconds,
      targetPlaybackRate: normalizedPlaybackRate,
      targetTime: null,
    };
  }

  if (
    absoluteDriftSeconds >=
    playbackSynchronizationConfig.roomDriftHardSeekThresholdSeconds
  ) {
    return {
      kind: "hard_seek" as const,
      driftSeconds,
      targetPlaybackRate: normalizedPlaybackRate,
      targetTime: roundPlaybackSeconds(input.expectedTime),
    };
  }

  const correctedPlaybackRate = clampPlaybackRate(
    normalizedPlaybackRate +
      (driftSeconds > 0
        ? playbackSynchronizationConfig.roomSmoothCorrectionRateDelta
        : -playbackSynchronizationConfig.roomSmoothCorrectionRateDelta),
  );

  return {
    kind: "smooth" as const,
    driftSeconds,
    targetPlaybackRate: correctedPlaybackRate,
    targetTime: null,
  };
}

export function formatPlaybackSeconds(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
