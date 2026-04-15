import type { PlaybackStateSnapshot, PlaybackStatus } from "@/types/playback";

type SharedPlaybackCommandType = "play" | "pause" | "stop" | "seek";

export type PlaybackLeadershipMode =
  | "local_leader"
  | "local_follower"
  | "local_external_audio_follower"
  | "cast_handoff"
  | "cast_leader_stabilizing"
  | "cast_leader_stable"
  | "cast_driven_local_follower"
  | "cast_driven_external_audio_follower"
  | "mobile_external_audio_follower";

export type PlaybackReconciliationProfileKey =
  | "local_leader"
  | "local_follower"
  | "local_external_audio_follower"
  | "cast_driven_local_follower"
  | "cast_driven_external_audio_follower"
  | "mobile_external_audio_follower";

export type LocalPlaybackSyncMode =
  | "embedded_audio_mode"
  | "external_audio_mode";

export type BuildAuthoritativePlaybackStateInput = {
  clientEventId: string | null;
  currentTime: number;
  nowWallClockMs: number;
  playbackRate: number;
  status: PlaybackStatus;
  type: SharedPlaybackCommandType;
  version: number;
};

export type PlaybackReconciliationProfile = {
  ignoreDriftThresholdSeconds: number;
  hardSeekThresholdSeconds: number;
  smoothCorrectionRateDelta: number;
  hardSeekCooldownMs: number;
  postSeekHardSeekSuppressionMs: number;
  postCanPlayHardSeekSuppressionMs: number;
};

export type PlaybackSuppressionCause =
  | "authoritative_reposition"
  | "local_user_seek"
  | "room_hard_seek"
  | "media_recovery"
  | "stall_recovery";

export type PlaybackSuppressionState = {
  cause: PlaybackSuppressionCause;
  generation: number;
  startedAtMs: number;
  suppressUntilMs: number;
  lastRenewedAtMs: number;
  lastTargetTime: number | null;
};

export type PlaybackProgressSample = {
  currentTime: number;
  observedAtMs: number;
};

export type PlaybackStallAssessment = {
  advancedSeconds: number;
  elapsedMs: number;
  isStalled: boolean;
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
  reconciliationProfiles: {
    local_leader: {
      ignoreDriftThresholdSeconds: 0.12,
      hardSeekThresholdSeconds: 0.65,
      smoothCorrectionRateDelta: 0.02,
      hardSeekCooldownMs: 2000,
      postSeekHardSeekSuppressionMs: 1500,
      postCanPlayHardSeekSuppressionMs: 1250,
    } satisfies PlaybackReconciliationProfile,
    local_follower: {
      ignoreDriftThresholdSeconds: 0.15,
      hardSeekThresholdSeconds: 0.85,
      smoothCorrectionRateDelta: 0.03,
      hardSeekCooldownMs: 2500,
      postSeekHardSeekSuppressionMs: 2000,
      postCanPlayHardSeekSuppressionMs: 1750,
    } satisfies PlaybackReconciliationProfile,
    local_external_audio_follower: {
      ignoreDriftThresholdSeconds: 0.2,
      hardSeekThresholdSeconds: 0.9,
      smoothCorrectionRateDelta: 0.025,
      hardSeekCooldownMs: 3000,
      postSeekHardSeekSuppressionMs: 2250,
      postCanPlayHardSeekSuppressionMs: 2000,
    } satisfies PlaybackReconciliationProfile,
    cast_driven_local_follower: {
      ignoreDriftThresholdSeconds: 0.15,
      hardSeekThresholdSeconds: 1,
      smoothCorrectionRateDelta: 0.03,
      hardSeekCooldownMs: 2500,
      postSeekHardSeekSuppressionMs: 2250,
      postCanPlayHardSeekSuppressionMs: 2000,
    } satisfies PlaybackReconciliationProfile,
    cast_driven_external_audio_follower: {
      ignoreDriftThresholdSeconds: 0.2,
      hardSeekThresholdSeconds: 1.2,
      smoothCorrectionRateDelta: 0.02,
      hardSeekCooldownMs: 3000,
      postSeekHardSeekSuppressionMs: 2500,
      postCanPlayHardSeekSuppressionMs: 2250,
    } satisfies PlaybackReconciliationProfile,
    mobile_external_audio_follower: {
      ignoreDriftThresholdSeconds: 0.2,
      hardSeekThresholdSeconds: 1.2,
      smoothCorrectionRateDelta: 0.025,
      hardSeekCooldownMs: 3000,
      postSeekHardSeekSuppressionMs: 2500,
      postCanPlayHardSeekSuppressionMs: 2250,
    } satisfies PlaybackReconciliationProfile,
  },
  roomFollowerReconciliationProfile: {
    ignoreDriftThresholdSeconds: 0.15,
    hardSeekThresholdSeconds: 0.85,
    smoothCorrectionRateDelta: 0.03,
    hardSeekCooldownMs: 2500,
    postSeekHardSeekSuppressionMs: 2000,
    postCanPlayHardSeekSuppressionMs: 1750,
  } satisfies PlaybackReconciliationProfile,
  suppression: {
    renewalCooldownMs: 1000,
    maxContinuousDurationMs: 4000,
    minimumMeaningfulTargetDeltaSeconds: 0.2,
    settlementProgressSeconds: 0.2,
  },
  pauseConvergenceThresholdSeconds: 0.05,
  localMediaSyncThresholdSeconds: 0.08,
  localMediaCorrectionThresholdSeconds: 0.12,
  localMediaAggressiveCorrectionThresholdSeconds: 0.3,
  externalAudioModeRoomDriftIgnoreThresholdSeconds: 0.2,
  externalAudioModeVideoFollowThresholdSeconds: 0.2,
  externalAudioModeVideoHardAlignThresholdSeconds: 0.45,
  externalAudioModePrimaryClockProgressThresholdSeconds: 0.15,
  localMediaCorrectionThrottleMs: 250,
  localMediaRecoveryEventStormWindowMs: 1500,
  localMediaRecoveryEventStormThreshold: 3,
  stalledProgressThresholdSeconds: 0.15,
  stalledProgressWindowMs: 2000,
  stallRecoveryCooldownMs: 3000,
  castRemoteObservation: {
    initialDelayMs: 700,
    minimumDelayMs: 250,
    maximumDelayMs: 2000,
    smoothingFactor: 0.25,
    stabilizationWindowMs: 4000,
    postMirrorStabilizationWindowMs: 3500,
    debounceWindowMs: 350,
    intentConfirmationWindowMs: 900,
    playIntentConfirmationWindowMs: 500,
    pauseIntentConfirmationWindowMs: 400,
    seekIntentConfirmationWindowMs: 350,
    controlSessionWindowMs: 4500,
    trustedContinuationWindowMs: 3500,
    antiReversionWindowMs: 1200,
    pauseStableNoProgressThresholdSeconds: 0.05,
    implausibleDriftThresholdSeconds: 1.75,
    absurdRegressionThresholdSeconds: 30,
    startupResetThresholdSeconds: 3,
  },
} as const;

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampPlaybackRate(playbackRate: number) {
  return clampNumber(playbackRate, 0.25, 3);
}

export function getPlaybackReconciliationProfile(
  key: PlaybackReconciliationProfileKey,
) {
  return playbackSynchronizationConfig.reconciliationProfiles[key];
}

export function resolvePlaybackReconciliationProfileKey(input: {
  hasExternalAudio: boolean;
  isMobile: boolean;
  leadershipMode: PlaybackLeadershipMode;
}): PlaybackReconciliationProfileKey {
  if (input.hasExternalAudio && input.isMobile) {
    return "mobile_external_audio_follower";
  }

  if (
    input.leadershipMode === "cast_driven_external_audio_follower"
  ) {
    return "cast_driven_external_audio_follower";
  }

  if (
    input.leadershipMode === "cast_driven_local_follower" ||
    input.leadershipMode === "cast_handoff" ||
    input.leadershipMode === "cast_leader_stabilizing"
  ) {
    return input.hasExternalAudio
      ? "cast_driven_external_audio_follower"
      : "cast_driven_local_follower";
  }

  if (
    input.leadershipMode === "local_external_audio_follower" ||
    (input.hasExternalAudio && input.leadershipMode === "local_follower")
  ) {
    return "local_external_audio_follower";
  }

  return input.leadershipMode === "local_leader"
    ? "local_leader"
    : "local_follower";
}

export function resolveLocalPlaybackSyncMode(input: {
  hasExternalAudio: boolean;
  suppressLocalAudioOutput: boolean;
}) {
  return input.hasExternalAudio && !input.suppressLocalAudioOutput
    ? "external_audio_mode"
    : "embedded_audio_mode";
}

export function roundPlaybackSeconds(value: number) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

export function roundWallClockMs(value: number) {
  return Math.round(Math.max(0, value));
}

export function isPlaybackSuppressionActive(
  state: PlaybackSuppressionState | null,
  nowMs = Date.now(),
) {
  return Boolean(state && state.suppressUntilMs > nowMs);
}

export function updatePlaybackSuppressionState(input: {
  cause: PlaybackSuppressionCause;
  durationMs: number;
  nowMs: number;
  previous: PlaybackSuppressionState | null;
  targetTime?: number | null;
}) {
  const maximumSuppressionEndMs =
    input.previous == null
      ? input.nowMs + playbackSynchronizationConfig.suppression.maxContinuousDurationMs
      : input.previous.startedAtMs +
        playbackSynchronizationConfig.suppression.maxContinuousDurationMs;
  const nextSuppressUntilMs = Math.min(
    input.nowMs + input.durationMs,
    maximumSuppressionEndMs,
  );
  const normalizedTargetTime =
    typeof input.targetTime === "number" && Number.isFinite(input.targetTime)
      ? roundPlaybackSeconds(input.targetTime)
      : null;

  if (!input.previous || input.previous.suppressUntilMs <= input.nowMs) {
    return {
      action: "started" as const,
      nextState: {
        cause: input.cause,
        generation: (input.previous?.generation ?? 0) + 1,
        startedAtMs: input.nowMs,
        suppressUntilMs: nextSuppressUntilMs,
        lastRenewedAtMs: input.nowMs,
        lastTargetTime: normalizedTargetTime,
      },
    };
  }

  const sameCause = input.previous.cause === input.cause;
  const targetDeltaSeconds =
    input.previous.lastTargetTime == null || normalizedTargetTime == null
      ? 0
      : Math.abs(input.previous.lastTargetTime - normalizedTargetTime);
  const renewalCoolingDown =
    input.nowMs - input.previous.lastRenewedAtMs <
    playbackSynchronizationConfig.suppression.renewalCooldownMs;
  const equivalentRenewal =
    sameCause &&
    targetDeltaSeconds <
      playbackSynchronizationConfig.suppression.minimumMeaningfulTargetDeltaSeconds;
  const alreadyAtSuppressionCap =
    input.previous.suppressUntilMs >= maximumSuppressionEndMs;

  if ((renewalCoolingDown && equivalentRenewal) || alreadyAtSuppressionCap) {
    return {
      action: "ignored_equivalent" as const,
      nextState: input.previous,
    };
  }

  return {
    action: "renewed" as const,
    nextState: {
      cause: input.cause,
      generation: input.previous.generation,
      startedAtMs: input.previous.startedAtMs,
      suppressUntilMs: Math.max(
        input.previous.suppressUntilMs,
        nextSuppressUntilMs,
      ),
      lastRenewedAtMs: input.nowMs,
      lastTargetTime: normalizedTargetTime ?? input.previous.lastTargetTime,
    },
  };
}

export function assessPlaybackProgressStall(input: {
  currentTime: number;
  nowMs: number;
  previousSample: PlaybackProgressSample | null;
}) {
  if (!input.previousSample) {
    return {
      nextSample: {
        currentTime: roundPlaybackSeconds(input.currentTime),
        observedAtMs: input.nowMs,
      },
      assessment: {
        advancedSeconds: 0,
        elapsedMs: 0,
        isStalled: false,
      } satisfies PlaybackStallAssessment,
    };
  }

  const elapsedMs = input.nowMs - input.previousSample.observedAtMs;
  const advancedSeconds = Math.max(
    0,
    roundPlaybackSeconds(input.currentTime - input.previousSample.currentTime),
  );
  const isStalled =
    elapsedMs >= playbackSynchronizationConfig.stalledProgressWindowMs &&
    advancedSeconds < playbackSynchronizationConfig.stalledProgressThresholdSeconds;

  return {
    nextSample: {
      currentTime: roundPlaybackSeconds(input.currentTime),
      observedAtMs: input.nowMs,
    },
    assessment: {
      advancedSeconds,
      elapsedMs,
      isStalled,
    } satisfies PlaybackStallAssessment,
  };
}

export function hasMeaningfulPlaybackProgress(
  assessment: PlaybackStallAssessment,
  progressThresholdSeconds = playbackSynchronizationConfig.suppression
    .settlementProgressSeconds,
) {
  return assessment.advancedSeconds >= progressThresholdSeconds;
}

export function estimateCastObservationDelayMs(
  previousEstimateMs: number | null,
  sampleMs: number,
) {
  const config = playbackSynchronizationConfig.castRemoteObservation;
  const clampedSampleMs = clampNumber(
    sampleMs,
    config.minimumDelayMs,
    config.maximumDelayMs,
  );

  if (previousEstimateMs == null || !Number.isFinite(previousEstimateMs)) {
    return clampedSampleMs;
  }

  return Math.round(
    previousEstimateMs * (1 - config.smoothingFactor) +
      clampedSampleMs * config.smoothingFactor,
  );
}

export function computeExpectedCastRemoteTimeAtObservation(
  playback: PlaybackStateSnapshot,
  observedAtMs: number,
  observationDelayMs: number,
) {
  return resolveSynchronizedPlaybackTime(
    playback,
    Math.max(0, observedAtMs - observationDelayMs),
  );
}

export function assessCastRemoteObservationPlausibility(input: {
  commandType: SharedPlaybackCommandType;
  expectedTime: number;
  observedTime: number;
}) {
  const config = playbackSynchronizationConfig.castRemoteObservation;
  const driftSeconds = roundPlaybackSeconds(input.observedTime - input.expectedTime);
  const absoluteDriftSeconds = Math.abs(driftSeconds);
  const absurdStartupReset =
    input.expectedTime >= config.absurdRegressionThresholdSeconds &&
    input.observedTime <= config.startupResetThresholdSeconds;

  return {
    driftSeconds,
    plausible:
      !absurdStartupReset &&
      (input.commandType === "seek"
        ? absoluteDriftSeconds <= config.absurdRegressionThresholdSeconds
        : absoluteDriftSeconds <= config.implausibleDriftThresholdSeconds),
  };
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
  lastHardSeekAtMs?: number | null;
  nowMs?: number;
  profile?: PlaybackReconciliationProfile;
  suppressHardSeekUntilMs?: number | null;
}) {
  const profile =
    input.profile ?? playbackSynchronizationConfig.roomFollowerReconciliationProfile;
  const driftSeconds = roundPlaybackSeconds(input.expectedTime - input.actualTime);
  const absoluteDriftSeconds = Math.abs(driftSeconds);
  const normalizedPlaybackRate = clampPlaybackRate(input.basePlaybackRate);
  const nowMs = input.nowMs ?? Date.now();
  const hardSeekCoolingDown =
    input.lastHardSeekAtMs != null &&
    nowMs - input.lastHardSeekAtMs < profile.hardSeekCooldownMs;
  const hardSeekSuppressed =
    input.suppressHardSeekUntilMs != null &&
    input.suppressHardSeekUntilMs > nowMs;

  if (absoluteDriftSeconds < profile.ignoreDriftThresholdSeconds) {
    return {
      kind: "none" as const,
      driftSeconds,
      targetPlaybackRate: normalizedPlaybackRate,
      targetTime: null,
    };
  }

  if (
    absoluteDriftSeconds >= profile.hardSeekThresholdSeconds &&
    !hardSeekCoolingDown &&
    !hardSeekSuppressed
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
        ? profile.smoothCorrectionRateDelta
        : -profile.smoothCorrectionRateDelta),
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
