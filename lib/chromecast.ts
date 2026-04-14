"use client";

import { useEffect, useState } from "react";
import { logDebugEvent, setDebugRuntimeState } from "@/lib/debug-store";
import { isCastableAbsoluteUrl } from "@/lib/public-origin";
import {
  assessCastRemoteObservationPlausibility,
  computeExpectedCastRemoteTimeAtObservation,
  estimateCastObservationDelayMs,
  isPlaybackActivelyRunning,
  playbackSynchronizationConfig,
  resolvePlaybackStartDelayMs,
  resolveSynchronizedPlaybackTime,
} from "@/lib/playback";
import type {
  CastResolvedMediaFailurePayload,
  CastResolvedMediaResponse,
  CastResolvedMediaSuccessPayload,
  CastResolverWarning,
} from "@/types/cast";
import type { PlaybackStateSnapshot, PlaybackStatus } from "@/types/playback";
import type { RoomMediaSummary } from "@/types/room-sync";

const castSdkUrl =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const castSdkReadyTimeoutMs = 15000;
const castMediaSessionReadyTimeoutMs = 8000;

type CastSessionInstance = {
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  getMediaSession?(): unknown;
  loadMedia(loadRequest: unknown): Promise<unknown>;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
};

type CastMediaInfoInstance = {
  contentId?: string;
  contentType?: string;
  contentUrl?: string;
  customData?: Record<string, unknown>;
  metadata?: { title?: string; images?: Array<{ url: string }> };
  streamType?: string;
  tracks?: unknown[];
};

type CastLoadRequestInstance = {
  activeTrackIds?: number[];
  autoplay?: boolean;
  currentTime?: number;
  media?: CastMediaInfoInstance;
};

type CastLoadRequestDiagnostics = {
  receiverApplicationId: string | null;
  contentId: string;
  contentUrl: string;
  contentType: string;
  streamType: string | null;
  title: string;
  posterUrl: string | null;
  autoplay: boolean;
  currentTime: number;
  subtitlesIncludedInLoadRequest: boolean;
  subtitleTrackCatalogSize: number;
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  activeTrackIds: number[];
  castMode: CastResolvedMediaSuccessPayload["castMode"];
  selectionSignature: string;
  castFallbackApplied: boolean;
  castFallbackReason: string | null;
  resolverWarnings: CastResolverWarning[];
  variantCacheKey: string | null;
  variantId: string | null;
  variantStatus: string | null;
  ffmpegAvailable: boolean | null;
  ffmpegBinary: string | null;
  ffmpegGenerationStatus: string | null;
  ffmpegFailureReason: string | null;
};

type CastMediaResponseDiagnostics = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  acceptRanges: string | null;
  contentLength: string | null;
  cacheControl: string | null;
  accessControlAllowOrigin: string | null;
  failure: string | null;
};

type CastSessionLoadRecord = {
  activeMediaSession: CastMediaSession | null;
  inflightSelectionSignature: string | null;
  inflightPromise: Promise<CastMediaSession | null> | null;
  lastFailedSelectionSignature: string | null;
  lastFailureReason: string | null;
  lastLoadedContentUrl: string | null;
  lastLoadedSelectionSignature: string | null;
  lastMirroredPlaybackVersion: number | null;
};

type CastSessionIdentity = {
  id: string;
  startedAt: string;
};

type ChromecastRuntimeListener = (
  snapshot: Record<string, unknown>,
) => void;

type CastContextInstance = {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  endCurrentSession(stopCasting: boolean): void;
  getCastState(): string;
  getCurrentSession(): CastSessionInstance | null;
  requestSession(): Promise<unknown>;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  setOptions(options: Record<string, unknown>): void;
};

type RemotePlayerInstance = {
  currentTime?: number;
  duration?: number;
  isMediaLoaded?: boolean;
  isPaused?: boolean;
  playerState?: string;
  playbackRate?: number;
  mediaInfo?: {
    contentId?: string | null;
    customData?: Record<string, unknown> | null;
  } | null;
};

type RemotePlayerControllerInstance = {
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
};

type CastSdkWindow = Window & {
  cast?: {
    framework?: {
      AutoJoinPolicy: {
        ORIGIN_SCOPED: string;
      };
      CastContext: {
        getInstance(): CastContextInstance;
      };
      RemotePlayer?: new () => RemotePlayerInstance;
      RemotePlayerController?: new (
        player: RemotePlayerInstance,
      ) => RemotePlayerControllerInstance;
      RemotePlayerEventType?: {
        CURRENT_TIME_CHANGED?: string;
        IS_MEDIA_LOADED_CHANGED?: string;
        IS_PAUSED_CHANGED?: string;
        MEDIA_INFO_CHANGED?: string;
        PLAYER_STATE_CHANGED?: string;
      };
      CastContextEventType: {
        CAST_STATE_CHANGED: string;
        SESSION_STATE_CHANGED: string;
      };
      SessionEventType?: {
        MEDIA_SESSION: string;
      };
      CastState: {
        CONNECTED: string;
        CONNECTING: string;
        NOT_CONNECTED: string;
        NO_DEVICES_AVAILABLE: string;
      };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy: {
        ORIGIN_SCOPED: string;
      };
      isAvailable?: boolean;
      media?: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        EditTracksInfoRequest: new (activeTrackIds: number[]) => {
          activeTrackIds: number[];
        };
        GenericMediaMetadata: new () => {
          title?: string;
          images?: Array<{ url: string }>;
        };
        LoadRequest: new (mediaInfo: unknown) => {
          activeTrackIds?: number[];
          autoplay?: boolean;
          currentTime?: number;
        } & CastLoadRequestInstance;
        MediaInfo: new (contentId: string, contentType: string) => {
          metadata?: { title?: string; images?: Array<{ url: string }> };
          contentId?: string;
          contentType?: string;
          contentUrl?: string;
          customData?: Record<string, unknown>;
          streamType?: string;
          tracks?: unknown[];
        } & CastMediaInfoInstance;
        PauseRequest: new () => unknown;
        PlayRequest: new () => unknown;
        SeekRequest: new () => {
          currentTime?: number;
        };
        StopRequest: new () => unknown;
        StreamType: {
          BUFFERED: string;
        };
        TextTrackType: {
          SUBTITLES: string;
        };
        Track: new (trackId: number, trackType: string) => {
          language?: string;
          name?: string;
          subtype?: string;
          trackContentId?: string;
          trackContentType?: string;
        };
        TrackType: {
          TEXT: string;
        };
      };
    };
  };
  __onGCastApiAvailable?: (available: boolean, errorInfo?: unknown) => void;
};

type CastMediaSession = {
  activeTrackIds?: number[] | null;
  currentTime?: number | null;
  editTracksInfo(
    request: unknown,
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ): void;
  getEstimatedTime?(): number;
  idleReason?: string | null;
  media?: {
    contentId?: string | null;
    customData?: Record<string, unknown> | null;
  } | null;
  playbackRate?: number | null;
  playerState?: string | null;
  pause(
    request: unknown,
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ): void;
  play(
    request: unknown,
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ): void;
  seek(
    request: unknown,
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ): void;
  stop(
    request: unknown,
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ): void;
};

type CastSessionEvent = {
  sessionState?: string;
  errorCode?: string;
};

type CastRemoteRoomCommandType = "play" | "pause" | "seek" | "stop";
type CastRemoteLeadershipMode =
  | "idle"
  | "cast_handoff"
  | "cast_leader_stabilizing"
  | "cast_leader_stable";

type CastRemoteIntentState =
  | "cast_remote_idle"
  | "cast_remote_intent_observed"
  | "cast_remote_intent_stabilizing"
  | "cast_remote_intent_committed"
  | "cast_remote_intent_rejected";

export type ChromecastRemotePlaybackEvent = {
  type: CastRemoteRoomCommandType;
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  playerState: string | null;
  isPaused: boolean | null;
  observedAt: string;
  expectedCurrentTime: number;
  observationDelayMs: number;
  sessionId: string | null;
  contentId: string | null;
  selectionSignature: string | null;
  source: "cast_remote";
};

type ChromecastRemotePlaybackListener = (
  event: ChromecastRemotePlaybackEvent,
) => void | Promise<void>;

type RecentLocalCastCommand = {
  type: CastRemoteRoomCommandType;
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  selectionSignature: string | null;
  createdAt: number;
  signature: string;
};

type CastRemoteObserverState = {
  controllerCleanup: (() => void) | null;
  estimatedObservationDelayMs: number | null;
  leadershipMode: CastRemoteLeadershipMode;
  lastEmittedSignature: string | null;
  lastCommittedIntent: {
    committedAtMs: number;
    signature: string;
    status: PlaybackStatus;
  } | null;
  lastMirroredPlayback: PlaybackStateSnapshot | null;
  lastObservedCurrentTime: number | null;
  lastObservedSessionId: string | null;
  lastObservedSignature: string | null;
  lastObservedStatus: PlaybackStatus | null;
  pendingIntent: {
    event: ChromecastRemotePlaybackEvent;
    firstObservedCurrentTime: number;
    firstObservedAtMs: number;
    lastObservedAtMs: number;
    observationCount: number;
    signature: string;
    state: CastRemoteIntentState;
    timerId: number | null;
  } | null;
  pendingCandidate: {
    event: ChromecastRemotePlaybackEvent;
    signature: string;
    timerId: number | null;
  } | null;
  pollTimerId: number | null;
  remotePlayer: RemotePlayerInstance | null;
  remotePlayerController: RemotePlayerControllerInstance | null;
  stabilizationUntilMs: number;
};

type CastEnvironmentSnapshot = {
  browserName: string;
  isSupportedBrowser: boolean;
  isSecureContext: boolean;
};

type CastErrorCode =
  | "unsupported_browser"
  | "insecure_context"
  | "sdk_load_failed"
  | "sdk_unavailable"
  | "context_init_failed"
  | "session_request_failed"
  | "session_end_failed"
  | "media_resolve_failed"
  | "media_load_failed";

class ChromecastError extends Error {
  code: CastErrorCode;
  details?: unknown;

  constructor(code: CastErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type ChromecastAvailabilityStatus =
  | "loading"
  | "unavailable"
  | "available"
  | "connecting"
  | "connected"
  | "error";

let castSdkPromise: Promise<void> | null = null;
let castContextConfigured = false;
let castRuntimeSnapshot: Record<string, unknown> = {};
const castSessionLoadRecords = new WeakMap<object, CastSessionLoadRecord>();
const castSessionIdentities = new WeakMap<object, CastSessionIdentity>();
const chromecastRuntimeListeners = new Set<ChromecastRuntimeListener>();
const chromecastRemotePlaybackListeners =
  new Set<ChromecastRemotePlaybackListener>();
const castResolvedMediaCache = new Map<string, CastResolvedMediaSuccessPayload>();
let castSessionSequence = 0;
const remotePlaybackPollIntervalMs = 750;
const remotePlaybackSeekThresholdSeconds = 1.25;
const localCastCommandSuppressionWindowMs = 2500;
const recentLocalCastCommands: RecentLocalCastCommand[] = [];
const castRemoteObserverState: CastRemoteObserverState = {
  controllerCleanup: null,
  estimatedObservationDelayMs:
    playbackSynchronizationConfig.castRemoteObservation.initialDelayMs,
  leadershipMode: "idle",
  lastEmittedSignature: null,
  lastCommittedIntent: null,
  lastMirroredPlayback: null,
  lastObservedCurrentTime: null,
  lastObservedSessionId: null,
  lastObservedSignature: null,
  lastObservedStatus: null,
  pendingIntent: null,
  pendingCandidate: null,
  pollTimerId: null,
  remotePlayer: null,
  remotePlayerController: null,
  stabilizationUntilMs: 0,
};

function getCastSdkWindow() {
  return window as CastSdkWindow;
}

function emitChromecastRuntimeSnapshot() {
  chromecastRuntimeListeners.forEach((listener) => {
    listener(castRuntimeSnapshot);
  });
}

function updateChromecastRuntimeState(data: Record<string, unknown>) {
  castRuntimeSnapshot = {
    ...castRuntimeSnapshot,
    ...data,
  };
  setDebugRuntimeState("cast/runtime", castRuntimeSnapshot);
  setDebugRuntimeState("cast/health", buildChromecastHealthSnapshot(castRuntimeSnapshot));
  emitChromecastRuntimeSnapshot();
}

function waitFor(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function getCurrentCastReceiverApplicationId() {
  return (
    getCastSdkWindow().chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID ?? null
  );
}

function normalizeSelectedTrackId(trackId: string | null | undefined) {
  if (!trackId) {
    return null;
  }

  const normalizedTrackId = trackId.trim();
  return normalizedTrackId.length > 0 ? normalizedTrackId : null;
}

function buildCastResolveRequestKey(
  roomId: string,
  mediaId: string,
  selectedAudioTrackId: string | null,
  selectedSubtitleTrackId: string | null,
) {
  return JSON.stringify({
    roomId,
    mediaId,
    selectedAudioTrackId,
    selectedSubtitleTrackId,
  });
}

function buildCastResolveUrl(
  roomId: string,
  selectedAudioTrackId: string | null,
  selectedSubtitleTrackId: string | null,
) {
  const url = new URL(
    `/api/cast/resolve/${encodeURIComponent(roomId)}`,
    window.location.origin,
  );

  if (selectedAudioTrackId) {
    url.searchParams.set("audioTrackId", selectedAudioTrackId);
  }

  if (selectedSubtitleTrackId) {
    url.searchParams.set("subtitleTrackId", selectedSubtitleTrackId);
  }

  return url.toString();
}

function getPrimaryCastResolverWarning(warnings: CastResolverWarning[]) {
  return warnings[0] ?? null;
}

function readCastResolverWarnings(value: unknown): CastResolverWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (warning): warning is CastResolverWarning =>
      Boolean(warning) &&
      typeof warning === "object" &&
      typeof warning.code === "string" &&
      typeof warning.message === "string",
  );
}

function roundPlaybackTimeForSignature(value: number) {
  return Math.round(Math.max(0, value) * 4) / 4;
}

function normalizeObservedPlaybackRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.round(value * 100) / 100;
}

function buildPlaybackStateSignature(input: {
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  selectionSignature: string | null;
}) {
  return JSON.stringify({
    status: input.status,
    currentTime: roundPlaybackTimeForSignature(input.currentTime),
    playbackRate: normalizeObservedPlaybackRate(input.playbackRate),
    selectionSignature: input.selectionSignature,
  });
}

function pruneRecentLocalCastCommands(now = Date.now()) {
  while (recentLocalCastCommands.length > 0) {
    const oldestCommand = recentLocalCastCommands[0];

    if (now - oldestCommand.createdAt <= localCastCommandSuppressionWindowMs) {
      break;
    }

    recentLocalCastCommands.shift();
  }
}

function rememberLocalCastCommand(command: {
  type: CastRemoteRoomCommandType;
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  selectionSignature: string | null;
}) {
  const nextEntry: RecentLocalCastCommand = {
    ...command,
    createdAt: Date.now(),
    signature: buildPlaybackStateSignature({
      status: command.status,
      currentTime: command.currentTime,
      playbackRate: command.playbackRate,
      selectionSignature: command.selectionSignature,
    }),
  };

  pruneRecentLocalCastCommands(nextEntry.createdAt);
  recentLocalCastCommands.push(nextEntry);

  if (recentLocalCastCommands.length > 12) {
    recentLocalCastCommands.splice(0, recentLocalCastCommands.length - 12);
  }

  updateChromecastRuntimeState({
    lastCastLocalCommandSignature: nextEntry.signature,
    lastCastLocalCommandType: nextEntry.type,
    lastCastLocalCommandAt: new Date(nextEntry.createdAt).toISOString(),
  });
}

function findMatchingRecentLocalCastCommand(observation: {
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  selectionSignature: string | null;
}) {
  const now = Date.now();
  pruneRecentLocalCastCommands(now);

  for (let index = recentLocalCastCommands.length - 1; index >= 0; index -= 1) {
    const command = recentLocalCastCommands[index];

    if (now - command.createdAt > localCastCommandSuppressionWindowMs) {
      continue;
    }

    if (command.status !== observation.status) {
      continue;
    }

    if (
      Math.abs(
        normalizeObservedPlaybackRate(command.playbackRate) -
          normalizeObservedPlaybackRate(observation.playbackRate),
      ) > 0.05
    ) {
      continue;
    }

    if (
      Math.abs(
        roundPlaybackTimeForSignature(command.currentTime) -
          roundPlaybackTimeForSignature(observation.currentTime),
      ) > remotePlaybackSeekThresholdSeconds
    ) {
      continue;
    }

    if (
      command.selectionSignature &&
      observation.selectionSignature &&
      command.selectionSignature !== observation.selectionSignature
    ) {
      continue;
    }

    return command;
  }

  return null;
}

function clearPendingCastRemoteCandidate(reason: string) {
  if (castRemoteObserverState.pendingCandidate?.timerId != null) {
    window.clearTimeout(castRemoteObserverState.pendingCandidate.timerId);
  }

  castRemoteObserverState.pendingCandidate = null;
  updateChromecastRuntimeState({
    pendingCastRemoteSignature: null,
    pendingCastRemoteObservedAt: null,
    pendingCastRemoteReason: reason,
  });
}

function updateCastRemoteIntentState(
  state: CastRemoteIntentState,
  reason: string,
  event?: ChromecastRemotePlaybackEvent | null,
) {
  updateChromecastRuntimeState({
    castRemoteIntentState: state,
    castRemoteIntentReason: reason,
    castRemoteIntentStatus: event?.status ?? null,
    castRemoteIntentType: event?.type ?? null,
    castRemoteIntentCurrentTime: event?.currentTime ?? null,
    castRemoteIntentObservedAt: event?.observedAt ?? null,
  });
}

function clearPendingCastRemoteIntent(reason: string) {
  if (castRemoteObserverState.pendingIntent?.timerId != null) {
    window.clearTimeout(castRemoteObserverState.pendingIntent.timerId);
  }

  castRemoteObserverState.pendingIntent = null;
  updateCastRemoteIntentState("cast_remote_idle", reason, null);
}

function rejectCastRemoteIntent(
  reason:
    | "rejected_due_to_insufficient_remote_stability"
    | "rejected_due_to_recent_local_cast_command"
    | "rejected_due_to_recent_conflicting_local_play"
    | "rejected_due_to_cast_stabilization_window"
    | "rejected_due_to_implausible_remote_time"
    | "rejected_due_to_unstable_time_progression"
    | "rejected_due_to_contradictory_remote_transition"
    | "rejected_due_to_recent_committed_remote_intent",
  event: ChromecastRemotePlaybackEvent,
  data: Record<string, unknown> = {},
) {
  updateCastRemoteIntentState("cast_remote_intent_rejected", reason, event);
  updateChromecastRuntimeState({
    lastCastRemoteRejectionReason: reason,
  });
  logDebugEvent({
    level: "info",
    category: "cast",
    message: `Rejected a Chromecast remote intent candidate: ${reason}.`,
    source: "cast_remote",
    data: {
      ...data,
      event,
    },
  });
}

function findRecentConflictingLocalCastCommand(input: {
  candidateStatus: PlaybackStatus;
  selectionSignature: string | null;
  sinceMs: number;
}) {
  const now = Date.now();
  pruneRecentLocalCastCommands(now);
  const conflictingStatus =
    input.candidateStatus === "paused" ? "playing" : "paused";

  for (let index = recentLocalCastCommands.length - 1; index >= 0; index -= 1) {
    const command = recentLocalCastCommands[index];

    if (command.createdAt < input.sinceMs) {
      continue;
    }

    if (command.status !== conflictingStatus) {
      continue;
    }

    if (
      command.selectionSignature &&
      input.selectionSignature &&
      command.selectionSignature !== input.selectionSignature
    ) {
      continue;
    }

    return command;
  }

  return null;
}

function isStablePausedRemoteIntent(
  candidate: NonNullable<CastRemoteObserverState["pendingIntent"]>,
) {
  const config = playbackSynchronizationConfig.castRemoteObservation;
  const elapsedMs = candidate.lastObservedAtMs - candidate.firstObservedAtMs;
  const timeAdvancedSeconds = Math.abs(
    candidate.event.currentTime - candidate.firstObservedCurrentTime,
  );
  const pausedStateConfirmed =
    candidate.event.status === "paused" &&
    (candidate.event.playerState?.toUpperCase() === "PAUSED" ||
      candidate.event.isPaused === true);
  const stableTimeProgression =
    timeAdvancedSeconds <= config.pauseStableNoProgressThresholdSeconds;
  const confirmedByObservationCount = candidate.observationCount >= 2;
  const confirmedByElapsedWindow =
    elapsedMs >= config.pauseIntentConfirmationWindowMs && stableTimeProgression;

  return {
    confirmed:
      pausedStateConfirmed &&
      stableTimeProgression &&
      (confirmedByObservationCount || confirmedByElapsedWindow),
    elapsedMs,
    stableTimeProgression,
    timeAdvancedSeconds,
  };
}

function canConfirmCastRemoteIntent(
  candidate: NonNullable<CastRemoteObserverState["pendingIntent"]>,
) {
  const firstCurrentTime = candidate.firstObservedCurrentTime;
  const latestCurrentTime = candidate.event.currentTime;

  if (candidate.event.status === "playing") {
    return candidate.observationCount >= 2 || latestCurrentTime >= firstCurrentTime + 0.15;
  }

  return isStablePausedRemoteIntent(candidate).confirmed;
}

function commitCastRemoteIntent(
  candidate: NonNullable<CastRemoteObserverState["pendingIntent"]>,
) {
  if (castRemoteObserverState.pendingIntent?.timerId != null) {
    window.clearTimeout(castRemoteObserverState.pendingIntent.timerId);
  }
  castRemoteObserverState.pendingIntent = null;
  castRemoteObserverState.lastEmittedSignature = candidate.signature;
  castRemoteObserverState.lastCommittedIntent = {
    committedAtMs: Date.now(),
    signature: candidate.signature,
    status: candidate.event.status,
  };
  updateCastRemoteIntentState(
    "cast_remote_intent_committed",
    "confirmed_remote_intent",
    candidate.event,
  );
  updateChromecastRuntimeState({
    lastAppliedRemoteStateSignature: candidate.signature,
    lastRemoteOriginatedRoomCommand: candidate.event,
    castRemoteIntentCommittedAt: new Date(
      castRemoteObserverState.lastCommittedIntent.committedAtMs,
    ).toISOString(),
  });
  logDebugEvent({
    level: "info",
    category: "cast",
    message: `Committed a confirmed Chromecast remote ${candidate.event.type} intent into shared room sync.`,
    source: "cast_remote",
    data: {
      observationCount: candidate.observationCount,
      event: candidate.event,
    },
  });
  notifyChromecastRemotePlaybackListeners(candidate.event);
}

function updateCastRemoteLeadershipMode(
  mode: CastRemoteLeadershipMode,
  reason: string,
) {
  castRemoteObserverState.leadershipMode = mode;
  updateChromecastRuntimeState({
    castRemoteLeadershipMode: mode,
    castRemoteLeadershipReason: reason,
    castRemoteStabilizationUntil:
      castRemoteObserverState.stabilizationUntilMs > 0
        ? new Date(castRemoteObserverState.stabilizationUntilMs).toISOString()
        : null,
  });
}

function settleCastRemoteLeadershipMode(nowMs = Date.now()) {
  if (
    castRemoteObserverState.leadershipMode !== "idle" &&
    castRemoteObserverState.stabilizationUntilMs > 0 &&
    nowMs >= castRemoteObserverState.stabilizationUntilMs &&
    castRemoteObserverState.leadershipMode !== "cast_leader_stable"
  ) {
    updateCastRemoteLeadershipMode("cast_leader_stable", "stabilization_elapsed");
  }
}

function armCastRemoteStabilization(
  reason: string,
  durationMs: number = playbackSynchronizationConfig.castRemoteObservation
    .postMirrorStabilizationWindowMs,
  mode: CastRemoteLeadershipMode = "cast_leader_stabilizing",
) {
  const nowMs = Date.now();
  castRemoteObserverState.stabilizationUntilMs = Math.max(
    castRemoteObserverState.stabilizationUntilMs,
    nowMs + durationMs,
  );
  clearPendingCastRemoteCandidate(`${reason}:stabilized`);
  clearPendingCastRemoteIntent(`${reason}:stabilized`);
  updateCastRemoteLeadershipMode(mode, reason);
}

function rememberMirroredCastPlayback(
  playback: PlaybackStateSnapshot,
  reason: string,
) {
  castRemoteObserverState.lastMirroredPlayback = playback;
  updateChromecastRuntimeState({
    castMirroredPlaybackAnchor: {
      status: playback.status,
      anchorMediaTime: playback.anchorMediaTime,
      anchorWallClockMs: playback.anchorWallClockMs,
      playbackRate: playback.playbackRate,
      scheduledStartWallClockMs: playback.scheduledStartWallClockMs,
      version: playback.version,
    },
    castMirroredPlaybackReason: reason,
  });
}

function rememberCastObservationDelaySample(sampleMs: number, reason: string) {
  const nextEstimateMs = estimateCastObservationDelayMs(
    castRemoteObserverState.estimatedObservationDelayMs,
    sampleMs,
  );

  castRemoteObserverState.estimatedObservationDelayMs = nextEstimateMs;
  updateChromecastRuntimeState({
    castObservationDelayMs: nextEstimateMs,
    castObservationDelaySampleMs: sampleMs,
    castObservationDelayReason: reason,
  });
}

function rejectCastRemoteObservation(
  reason:
    | "rejected_due_to_cast_stabilization_window"
    | "rejected_due_to_implausible_remote_time"
    | "rejected_due_to_recent_local_cast_command"
    | "rejected_due_to_insufficient_remote_stability",
  data: Record<string, unknown>,
) {
  updateChromecastRuntimeState({
    lastSuppressedRemoteStateSignature:
      typeof data.signature === "string" ? data.signature : null,
    lastSuppressedRemoteStateReason: reason,
    lastCastRemoteRejectionReason: reason,
  });
  logDebugEvent({
    level: "info",
    category: "cast",
    message: `Rejected a Chromecast remote observation: ${reason}.`,
    source: "cast_remote",
    data,
  });
}

function queuePendingCastRemoteCandidate(
  event: ChromecastRemotePlaybackEvent,
  signature: string,
) {
  clearPendingCastRemoteCandidate("new_candidate");
  rejectCastRemoteObservation("rejected_due_to_insufficient_remote_stability", {
    signature,
    event,
  });

  const timerId = window.setTimeout(() => {
    const pendingCandidate = castRemoteObserverState.pendingCandidate;

    if (!pendingCandidate || pendingCandidate.signature !== signature) {
      return;
    }

    settleCastRemoteLeadershipMode();

    if (
      castRemoteObserverState.stabilizationUntilMs > Date.now() ||
      castRemoteObserverState.leadershipMode === "cast_handoff" ||
      castRemoteObserverState.leadershipMode === "cast_leader_stabilizing"
    ) {
      rejectCastRemoteObservation(
        "rejected_due_to_cast_stabilization_window",
        {
          signature,
          event,
        },
      );
      clearPendingCastRemoteCandidate("stabilization_window");
      return;
    }

    const matchingLocalCommand = findMatchingRecentLocalCastCommand({
      status: event.status,
      currentTime: event.currentTime,
      playbackRate: event.playbackRate,
      selectionSignature: event.selectionSignature,
    });

    if (matchingLocalCommand) {
      rejectCastRemoteObservation(
        "rejected_due_to_recent_local_cast_command",
        {
          signature,
          event,
          matchingLocalCommand,
        },
      );
      clearPendingCastRemoteCandidate("recent_local_cast_command");
      return;
    }

    if (castRemoteObserverState.lastMirroredPlayback) {
      const plausibility = assessCastRemoteObservationPlausibility({
        commandType: event.type,
        expectedTime: computeExpectedCastRemoteTimeAtObservation(
          castRemoteObserverState.lastMirroredPlayback,
          new Date(event.observedAt).getTime(),
          event.observationDelayMs,
        ),
        observedTime: event.currentTime,
      });

      if (!plausibility.plausible) {
        rejectCastRemoteObservation(
          "rejected_due_to_implausible_remote_time",
          {
            signature,
            event,
            driftSeconds: plausibility.driftSeconds,
          },
        );
        clearPendingCastRemoteCandidate("implausible_remote_time");
        return;
      }
    }

    castRemoteObserverState.lastEmittedSignature = signature;
    updateChromecastRuntimeState({
      lastAppliedRemoteStateSignature: signature,
      lastRemoteOriginatedRoomCommand: event,
    });
    logDebugEvent({
      level: "info",
      category: "cast",
      message: `Accepted Chromecast remote ${event.type} after the stabilization debounce.`,
      source: "cast_remote",
      data: event,
    });
    notifyChromecastRemotePlaybackListeners(event);
    clearPendingCastRemoteCandidate("accepted");
  }, playbackSynchronizationConfig.castRemoteObservation.debounceWindowMs);

  castRemoteObserverState.pendingCandidate = {
    event,
    signature,
    timerId,
  };
  updateChromecastRuntimeState({
    pendingCastRemoteSignature: signature,
    pendingCastRemoteObservedAt: event.observedAt,
    pendingCastRemoteReason: "awaiting_stability_debounce",
  });
}

function queuePendingCastRemoteIntent(
  event: ChromecastRemotePlaybackEvent,
  signature: string,
) {
  const nowMs = Date.now();
  const isPauseIntent = event.status === "paused";
  const antiReversionWindowMs =
    playbackSynchronizationConfig.castRemoteObservation.antiReversionWindowMs;
  const lastCommittedIntent = castRemoteObserverState.lastCommittedIntent;

  if (
    lastCommittedIntent &&
    lastCommittedIntent.status !== event.status &&
    nowMs - lastCommittedIntent.committedAtMs < antiReversionWindowMs &&
    !isPauseIntent
  ) {
    rejectCastRemoteIntent(
      "rejected_due_to_recent_committed_remote_intent",
      event,
      {
        antiReversionWindowMs,
        committedAt: new Date(lastCommittedIntent.committedAtMs).toISOString(),
        committedStatus: lastCommittedIntent.status,
      },
    );
    logDebugEvent({
      level: "info",
      category: "cast",
      message:
        "Blocked a contradictory Chromecast remote reversal because the previously committed remote intent is still inside the anti-reversion guard window.",
      source: "cast_remote",
      data: {
        antiReversionWindowMs,
        committedStatus: lastCommittedIntent.status,
        nextStatus: event.status,
      },
    });
    return;
  }

  const existingIntent = castRemoteObserverState.pendingIntent;

  if (existingIntent && existingIntent.event.status !== event.status) {
    rejectCastRemoteIntent(
      "rejected_due_to_contradictory_remote_transition",
      existingIntent.event,
      {
        contradictoryEvent: event,
        previousObservationCount: existingIntent.observationCount,
      },
    );
    clearPendingCastRemoteIntent("contradictory_transition");
  }

  if (
    castRemoteObserverState.pendingIntent &&
    castRemoteObserverState.pendingIntent.event.status === event.status &&
    castRemoteObserverState.pendingIntent.event.type === event.type &&
    castRemoteObserverState.pendingIntent.event.sessionId === event.sessionId
  ) {
    const nextIntent = castRemoteObserverState.pendingIntent;
    nextIntent.event = event;
    nextIntent.signature = signature;
    nextIntent.lastObservedAtMs = nowMs;
    nextIntent.observationCount += 1;
    nextIntent.state = "cast_remote_intent_stabilizing";
    updateCastRemoteIntentState(
      "cast_remote_intent_stabilizing",
      "repeat_consistent_observation",
      event,
    );
    return;
  }

  clearPendingCastRemoteIntent("new_intent");
  updateCastRemoteIntentState("cast_remote_intent_observed", "candidate_observed", event);
  logDebugEvent({
    level: "info",
    category: "cast",
    message: isPauseIntent
      ? "remote_pause_candidate_observed"
      : `Observed a Chromecast remote ${event.type} candidate and started intent confirmation.`,
    source: "cast_remote",
    data: event,
  });

  const firstObservedAtMs = nowMs;
  const confirmationWindowMs = isPauseIntent
    ? playbackSynchronizationConfig.castRemoteObservation
        .pauseIntentConfirmationWindowMs
    : playbackSynchronizationConfig.castRemoteObservation.intentConfirmationWindowMs;
  const timerId = window.setTimeout(() => {
    const pendingIntent = castRemoteObserverState.pendingIntent;

    if (
      !pendingIntent ||
      pendingIntent.firstObservedAtMs !== firstObservedAtMs ||
      pendingIntent.event.status !== event.status ||
      pendingIntent.event.sessionId !== event.sessionId
    ) {
      return;
    }

    const conflictingLocalPlayCommand =
      pendingIntent.event.status === "paused"
        ? findRecentConflictingLocalCastCommand({
            candidateStatus: pendingIntent.event.status,
            selectionSignature: pendingIntent.event.selectionSignature,
            sinceMs: pendingIntent.firstObservedAtMs,
          })
        : null;

    if (conflictingLocalPlayCommand) {
      rejectCastRemoteIntent(
        "rejected_due_to_recent_conflicting_local_play",
        pendingIntent.event,
        {
          conflictingLocalPlayCommand,
          observationCount: pendingIntent.observationCount,
          signature,
        },
      );
      logDebugEvent({
        level: "info",
        category: "cast",
        message: "remote_pause_rejected_due_to_recent_conflicting_local_play",
        source: "cast_remote",
        data: {
          conflictingLocalPlayCommand,
          event: pendingIntent.event,
        },
      });
      clearPendingCastRemoteIntent("recent_conflicting_local_play");
      return;
    }

    if (pendingIntent.event.status === "paused") {
      const pauseConfirmation = isStablePausedRemoteIntent(pendingIntent);

      if (pauseConfirmation.confirmed) {
        logDebugEvent({
          level: "info",
          category: "cast",
          message: "remote_pause_confirmed_fast_path",
          source: "cast_remote",
          data: {
            elapsedMs: pauseConfirmation.elapsedMs,
            observationCount: pendingIntent.observationCount,
            timeAdvancedSeconds: pauseConfirmation.timeAdvancedSeconds,
            event: pendingIntent.event,
          },
        });
        commitCastRemoteIntent(pendingIntent);
        return;
      }

      rejectCastRemoteIntent(
        "rejected_due_to_unstable_time_progression",
        pendingIntent.event,
        {
          elapsedMs: pauseConfirmation.elapsedMs,
          observationCount: pendingIntent.observationCount,
          stableTimeProgression: pauseConfirmation.stableTimeProgression,
          timeAdvancedSeconds: pauseConfirmation.timeAdvancedSeconds,
        },
      );
      logDebugEvent({
        level: "info",
        category: "cast",
        message: "remote_pause_rejected_due_to_unstable_time_progression",
        source: "cast_remote",
        data: {
          elapsedMs: pauseConfirmation.elapsedMs,
          observationCount: pendingIntent.observationCount,
          timeAdvancedSeconds: pauseConfirmation.timeAdvancedSeconds,
          event: pendingIntent.event,
        },
      });
      clearPendingCastRemoteIntent("pause_unstable_time_progression");
      return;
    }

    if (!canConfirmCastRemoteIntent(pendingIntent)) {
      rejectCastRemoteIntent(
        "rejected_due_to_insufficient_remote_stability",
        pendingIntent.event,
        {
          observationCount: pendingIntent.observationCount,
          signature,
        },
      );
      clearPendingCastRemoteIntent("insufficient_remote_stability");
      return;
    }

    logDebugEvent({
      level: "info",
      category: "cast",
      message: "remote_play_confirmation_still_using_stricter_rules",
      source: "cast_remote",
      data: {
        observationCount: pendingIntent.observationCount,
        event: pendingIntent.event,
      },
    });
    commitCastRemoteIntent(pendingIntent);
  }, confirmationWindowMs);

  castRemoteObserverState.pendingIntent = {
    event,
    firstObservedCurrentTime: event.currentTime,
    firstObservedAtMs,
    lastObservedAtMs: nowMs,
    observationCount: 1,
    signature,
    state: "cast_remote_intent_stabilizing",
    timerId,
  };
  updateCastRemoteIntentState(
    "cast_remote_intent_stabilizing",
    "awaiting_confirmation_window",
    event,
  );
}

function updateCastResolvedMediaRuntimeState(
  payload: CastResolvedMediaSuccessPayload,
) {
  const primaryWarning = getPrimaryCastResolverWarning(payload.warnings);

  updateChromecastRuntimeState({
    castResolverOk: true,
    castResolverWarnings: payload.warnings,
    castResolverErrorCode: null,
    castResolverErrorMessage: null,
    castFallbackApplied: payload.castFallbackApplied,
    castFallbackReason:
      payload.castFallbackReason ??
      (payload.castFallbackApplied ? primaryWarning?.message ?? null : null),
    resolvedCastMode: payload.castMode,
    resolvedContentUrl: payload.contentUrl,
    resolvedContentType: payload.contentType,
    resolvedSelectionSignature: payload.selectionSignature,
    resolvedAudioTrackId: payload.selectedAudioTrackId,
    resolvedSubtitleTrackId: payload.selectedSubtitleTrackId,
    resolvedEffectiveAudioTrackId: payload.resolvedEffectiveAudioTrackId,
    resolvedEffectiveSubtitleTrackId: payload.resolvedEffectiveSubtitleTrackId,
    resolvedSubtitleTrackCount: payload.textTracks.length,
    resolvedActiveTrackIds: payload.activeTrackIds,
    subtitlesIncludedInLoadRequest: payload.textTracks.length > 0,
    castVariantCacheKey: payload.diagnostics.variantCacheKey,
    castVariantId: payload.diagnostics.variantId,
    castVariantStoragePath: payload.diagnostics.variantStoragePath,
    castVariantStatus: payload.diagnostics.variantStatus,
    ffmpegAvailable: payload.diagnostics.ffmpegAvailable,
    ffmpegBinary: payload.diagnostics.ffmpegBinary,
    ffmpegGenerationStatus: payload.diagnostics.ffmpegStatus,
    ffmpegFailureReason: payload.diagnostics.ffmpegFailureReason,
  });
}

function updateCastResolverFailureRuntimeState(
  payload: CastResolvedMediaFailurePayload,
  fallbackSelection: {
    selectedAudioTrackId: string | null;
    selectedSubtitleTrackId: string | null;
  },
) {
  updateChromecastRuntimeState({
    castResolverOk: false,
    castResolverWarnings: payload.warnings,
    castResolverErrorCode: payload.errorCode,
    castResolverErrorMessage: payload.message,
    castFallbackApplied: payload.castFallbackApplied,
    castFallbackReason: payload.castFallbackReason,
    resolvedCastMode: payload.castMode,
    resolvedContentUrl: null,
    resolvedContentType: null,
    resolvedSelectionSignature: null,
    resolvedAudioTrackId:
      payload.selectedAudioTrackId ?? fallbackSelection.selectedAudioTrackId,
    resolvedSubtitleTrackId:
      payload.selectedSubtitleTrackId ?? fallbackSelection.selectedSubtitleTrackId,
    resolvedEffectiveAudioTrackId: payload.resolvedEffectiveAudioTrackId,
    resolvedEffectiveSubtitleTrackId: payload.resolvedEffectiveSubtitleTrackId,
    resolvedSubtitleTrackCount: 0,
    resolvedActiveTrackIds: [],
    subtitlesIncludedInLoadRequest: payload.diagnostics.subtitlesIncluded,
    castVariantCacheKey: payload.diagnostics.variantCacheKey,
    castVariantId: payload.diagnostics.variantId,
    castVariantStoragePath: payload.diagnostics.variantStoragePath,
    castVariantStatus: payload.diagnostics.variantStatus,
    ffmpegAvailable: payload.diagnostics.ffmpegAvailable,
    ffmpegBinary: payload.diagnostics.ffmpegBinary,
    ffmpegGenerationStatus: payload.diagnostics.ffmpegStatus,
    ffmpegFailureReason: payload.diagnostics.ffmpegFailureReason,
    mediaLoadStatus: "resolver_blocked",
    mediaLoadSucceeded: false,
    mediaLoadBlocked: true,
    mediaLoadLikelyFailureReason: payload.message,
  });
}

async function resolveCastMediaPayload(
  roomId: string,
  media: RoomMediaSummary,
  selectedAudioTrackId: string | null,
  selectedSubtitleTrackId: string | null,
  options?: { forceRefresh?: boolean },
) {
  const normalizedAudioTrackId = normalizeSelectedTrackId(selectedAudioTrackId);
  const normalizedSubtitleTrackId = normalizeSelectedTrackId(
    selectedSubtitleTrackId,
  );
  const cacheKey = buildCastResolveRequestKey(
    roomId,
    media.id,
    normalizedAudioTrackId,
    normalizedSubtitleTrackId,
  );

  if (!options?.forceRefresh) {
    const cachedPayload = castResolvedMediaCache.get(cacheKey);

    if (cachedPayload) {
      updateCastResolvedMediaRuntimeState(cachedPayload);
      return cachedPayload;
    }
  }

  const response = await fetch(
    buildCastResolveUrl(roomId, normalizedAudioTrackId, normalizedSubtitleTrackId),
    {
      method: "GET",
      cache: "no-store",
    },
  );
  const responsePayload = (await response.json().catch(() => null)) as
    | CastResolvedMediaResponse
    | null;

  if (!responsePayload || typeof responsePayload !== "object" || !("ok" in responsePayload)) {
    const failureMessage = "The Cast media payload could not be resolved for this room.";

    updateChromecastRuntimeState({
      castResolverOk: false,
      castResolverWarnings: [],
      castResolverErrorCode: "cast_resolve_failed",
      castResolverErrorMessage: failureMessage,
      castFallbackApplied: false,
      castFallbackReason: null,
      resolvedCastMode: "resolver_error",
      resolvedContentUrl: null,
      resolvedContentType: null,
      resolvedSelectionSignature: null,
      resolvedAudioTrackId: normalizedAudioTrackId,
      resolvedSubtitleTrackId: normalizedSubtitleTrackId,
      resolvedEffectiveAudioTrackId: null,
      resolvedEffectiveSubtitleTrackId: null,
      subtitlesIncludedInLoadRequest: false,
      castVariantCacheKey: null,
      castVariantId: null,
      castVariantStoragePath: null,
      castVariantStatus: "failed",
      ffmpegAvailable: null,
      ffmpegBinary: null,
      ffmpegGenerationStatus: "failed",
      ffmpegFailureReason: failureMessage,
      mediaLoadStatus: "resolver_failed",
      mediaLoadSucceeded: false,
      mediaLoadBlocked: true,
      mediaLoadLikelyFailureReason: failureMessage,
    });

    throw new ChromecastError("media_resolve_failed", failureMessage, {
      roomId,
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      responsePayload,
      status: response.status,
    });
  }

  if (!responsePayload.ok) {
    updateCastResolverFailureRuntimeState(responsePayload, {
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
    });

    throw new ChromecastError("media_resolve_failed", responsePayload.message, {
      roomId,
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      responsePayload,
      status: response.status,
    });
  }

  castResolvedMediaCache.set(cacheKey, responsePayload);
  updateCastResolvedMediaRuntimeState(responsePayload);
  return responsePayload;
}

function extractSelectionSignatureFromMediaSession(
  mediaSession: CastMediaSession | null,
) {
  const customData = mediaSession?.media?.customData;

  if (
    customData &&
    typeof customData === "object" &&
    typeof customData.selectionSignature === "string"
  ) {
    return customData.selectionSignature;
  }

  return null;
}

function getOrCreateCastSessionIdentity(
  session: CastSessionInstance,
): CastSessionIdentity {
  const existingIdentity = castSessionIdentities.get(session as object);

  if (existingIdentity) {
    return existingIdentity;
  }

  castSessionSequence += 1;
  const nextIdentity: CastSessionIdentity = {
    id: `cast-session-${castSessionSequence}`,
    startedAt: new Date().toISOString(),
  };
  castSessionIdentities.set(session as object, nextIdentity);
  return nextIdentity;
}

function resolveCurrentCastSessionIdentity() {
  const currentSession = getCurrentCastSession();
  return currentSession ? getOrCreateCastSessionIdentity(currentSession) : null;
}

function resetCurrentCastSessionRuntimeState(
  identity: CastSessionIdentity | null,
  overrides: Record<string, unknown> = {},
) {
  updateChromecastRuntimeState({
    currentCastSessionId: identity?.id ?? null,
    currentCastSessionStartedAt: identity?.startedAt ?? null,
    activeMediaSessionConfirmedForCurrentSession: false,
    activeMediaSessionContentId: null,
    activeMediaSessionSelectionSignature: null,
    currentCastSessionErrorCode: null,
    currentCastSessionErrorMessage: null,
    mediaLoadStatus: identity ? "session_started" : "idle",
    mediaLoadSucceeded: false,
    mediaLoadBlocked: false,
    mediaLoadLikelyFailureReason: null,
    mediaSessionEventObserved: false,
    mediaSessionReturned: false,
    mediaSessionContentId: null,
    mediaContentId: null,
    activeControllableMediaSession: false,
    initialCastStateAppliedAfterLoad: false,
    playCommandSentAfterLoad: false,
    lastRemotePlaybackCommand: null,
    lastRemoteSeekCommand: null,
    usedExistingMediaSessionForMirror: false,
    reloadedMediaInsteadOfControlling: false,
    remotePlaybackState: identity ? "session_started" : "idle",
    lastRequestedMediaContentId: null,
    lastRequestedSelectionSignature: null,
    mediaLoadRequest: null,
    mediaResponseDiagnostics: null,
    mediaLoadResult: null,
    mediaLoadResultErrorCode: null,
    lastCastMirrorDecision: null,
    castMirroredPlaybackAnchor: null,
    castMirroredPlaybackReason: null,
    resolvedSelectionSignature: null,
    castObservationDelayMs:
      playbackSynchronizationConfig.castRemoteObservation.initialDelayMs,
    castObservationDelaySampleMs: null,
    castObservationDelayReason: null,
    castRemoteLeadershipMode: identity ? "cast_handoff" : "idle",
    castRemoteLeadershipReason: identity ? "session_started" : "idle",
    castRemoteStabilizationUntil: identity
      ? new Date(
          Date.now() +
            playbackSynchronizationConfig.castRemoteObservation
              .stabilizationWindowMs,
        ).toISOString()
      : null,
    remotePlayerObserved: false,
    remotePlayerPollingEnabled: false,
    remotePlayerObservationReason: null,
    remotePlayerObservationSessionId: null,
    lastObservedRemoteExpectedCurrentTime: null,
    lastObservedRemoteCurrentTime: null,
    lastObservedRemotePlayerState: null,
    lastObservedRemoteIsPaused: null,
    lastObservedRemoteStatus: null,
    lastRemoteOriginatedRoomCommand: null,
    lastAppliedRemoteStateSignature: null,
    lastSuppressedRemoteStateSignature: null,
    lastSuppressedRemoteStateReason: null,
    lastCastRemoteRejectionReason: null,
    pendingCastRemoteSignature: null,
    pendingCastRemoteObservedAt: null,
    pendingCastRemoteReason: null,
    lastCastLocalCommandSignature: null,
    lastCastLocalCommandType: null,
    lastCastLocalCommandAt: null,
    ...overrides,
  });
}

function reconcileCurrentCastSessionScope(session: CastSessionInstance | null) {
  const currentTrackedSessionId =
    typeof castRuntimeSnapshot.currentCastSessionId === "string"
      ? castRuntimeSnapshot.currentCastSessionId
      : null;

  if (!session) {
    if (currentTrackedSessionId) {
      resetCurrentCastSessionRuntimeState(null);
    }
    return null;
  }

  const nextIdentity = getOrCreateCastSessionIdentity(session);

  if (currentTrackedSessionId !== nextIdentity.id) {
    resetCurrentCastSessionRuntimeState(nextIdentity);
    castRemoteObserverState.stabilizationUntilMs =
      Date.now() + playbackSynchronizationConfig.castRemoteObservation.stabilizationWindowMs;
    updateCastRemoteLeadershipMode("cast_handoff", "session_started");
  } else if (
    castRuntimeSnapshot.currentCastSessionStartedAt !== nextIdentity.startedAt
  ) {
    updateChromecastRuntimeState({
      currentCastSessionId: nextIdentity.id,
      currentCastSessionStartedAt: nextIdentity.startedAt,
    });
  }

  return nextIdentity;
}

function markCurrentCastSessionError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  const sessionIdentity = resolveCurrentCastSessionIdentity();

  updateChromecastRuntimeState({
    currentCastSessionId: sessionIdentity?.id ?? null,
    currentCastSessionStartedAt: sessionIdentity?.startedAt ?? null,
    currentCastSessionErrorCode: code,
    currentCastSessionErrorMessage: message,
    lastFailedCastSessionId: sessionIdentity?.id ?? null,
    castStatus: "error",
    castIssue: message,
    castIssueCode: code,
    canRequestSession: false,
    lastError: message,
    ...details,
  });
}

function clearCurrentCastSessionError() {
  const nextSnapshot: Record<string, unknown> = {
    ...castRuntimeSnapshot,
    currentCastSessionErrorCode: null,
    currentCastSessionErrorMessage: null,
    lastError: null,
  };
  const castState =
    typeof nextSnapshot.castState === "string" ? nextSnapshot.castState : undefined;
  const nextPresentation = buildChromecastPresentationState(
    nextSnapshot,
    castState,
  );

  updateChromecastRuntimeState({
    currentCastSessionErrorCode: null,
    currentCastSessionErrorMessage: null,
    castStatus: nextPresentation.status,
    castIssue: nextPresentation.issue,
    castIssueCode: nextPresentation.issueCode,
    canRequestSession: nextPresentation.canRequestSession,
    lastError: null,
  });
}

function resolveTrackedCastContentId() {
  const candidateFields = [
    "activeMediaSessionContentId",
    "mediaSessionContentId",
    "mediaContentId",
    "lastRequestedMediaContentId",
    "resolvedContentUrl",
  ] as const;

  for (const field of candidateFields) {
    if (typeof castRuntimeSnapshot[field] === "string") {
      return castRuntimeSnapshot[field] as string;
    }
  }

  return null;
}

function resolveTrackedCastSelectionSignature() {
  const candidateFields = [
    "activeMediaSessionSelectionSignature",
    "lastRequestedSelectionSignature",
    "resolvedSelectionSignature",
  ] as const;

  for (const field of candidateFields) {
    if (typeof castRuntimeSnapshot[field] === "string") {
      return castRuntimeSnapshot[field] as string;
    }
  }

  return null;
}

function resolveObservedRemotePlayerState(
  remotePlayer: RemotePlayerInstance | null,
  mediaSession: CastMediaSession | null,
) {
  return (
    (typeof remotePlayer?.playerState === "string" && remotePlayer.playerState) ||
    (typeof mediaSession?.playerState === "string" && mediaSession.playerState) ||
    null
  );
}

function resolveObservedRemoteCurrentTime(
  remotePlayer: RemotePlayerInstance | null,
  mediaSession: CastMediaSession | null,
) {
  if (
    typeof remotePlayer?.currentTime === "number" &&
    Number.isFinite(remotePlayer.currentTime)
  ) {
    return Math.max(0, remotePlayer.currentTime);
  }

  const estimatedTime = mediaSession?.getEstimatedTime?.();

  if (typeof estimatedTime === "number" && Number.isFinite(estimatedTime)) {
    return Math.max(0, estimatedTime);
  }

  if (
    typeof mediaSession?.currentTime === "number" &&
    Number.isFinite(mediaSession.currentTime)
  ) {
    return Math.max(0, mediaSession.currentTime);
  }

  return 0;
}

function resolveObservedRemotePlaybackRate(
  remotePlayer: RemotePlayerInstance | null,
  mediaSession: CastMediaSession | null,
) {
  if (
    typeof remotePlayer?.playbackRate === "number" &&
    Number.isFinite(remotePlayer.playbackRate)
  ) {
    return normalizeObservedPlaybackRate(remotePlayer.playbackRate);
  }

  if (
    typeof mediaSession?.playbackRate === "number" &&
    Number.isFinite(mediaSession.playbackRate)
  ) {
    return normalizeObservedPlaybackRate(mediaSession.playbackRate);
  }

  return 1;
}

function resolveObservedRemoteStatus(input: {
  remotePlayer: RemotePlayerInstance | null;
  mediaSession: CastMediaSession | null;
  playerState: string | null;
  isPaused: boolean | null;
}): PlaybackStatus | null {
  const normalizedPlayerState = input.playerState?.toUpperCase() ?? null;
  const isMediaLoaded =
    typeof input.remotePlayer?.isMediaLoaded === "boolean"
      ? input.remotePlayer.isMediaLoaded
      : Boolean(input.mediaSession?.media?.contentId);

  if (!isMediaLoaded && !input.mediaSession?.media?.contentId) {
    return null;
  }

  if (normalizedPlayerState === "PLAYING") {
    return "playing";
  }

  if (normalizedPlayerState === "PAUSED") {
    return "paused";
  }

  if (normalizedPlayerState === "BUFFERING") {
    return input.isPaused === true ? "paused" : "playing";
  }

  if (normalizedPlayerState === "IDLE") {
    return "stopped";
  }

  if (input.isPaused === false) {
    return "playing";
  }

  if (input.isPaused === true) {
    return "paused";
  }

  return isMediaLoaded ? "paused" : null;
}

function resolveRemotePlaybackCommandType(input: {
  nextStatus: PlaybackStatus;
  nextCurrentTime: number;
  previousStatus: PlaybackStatus | null;
  previousCurrentTime: number | null;
}) {
  if (!input.previousStatus) {
    return null;
  }

  if (input.nextStatus !== input.previousStatus) {
    switch (input.nextStatus) {
      case "playing":
        return "play" as const;
      case "paused":
        return "pause" as const;
      case "stopped":
        return "stop" as const;
    }
  }

  if (
    input.previousCurrentTime != null &&
    Math.abs(input.nextCurrentTime - input.previousCurrentTime) >=
      remotePlaybackSeekThresholdSeconds
  ) {
    return "seek" as const;
  }

  return null;
}

function stopChromecastRemotePlaybackObservation(reason: string) {
  clearPendingCastRemoteCandidate(`${reason}:stop`);
  clearPendingCastRemoteIntent(`${reason}:stop`);

  if (castRemoteObserverState.controllerCleanup) {
    castRemoteObserverState.controllerCleanup();
    castRemoteObserverState.controllerCleanup = null;
  }

  if (castRemoteObserverState.pollTimerId != null) {
    window.clearInterval(castRemoteObserverState.pollTimerId);
    castRemoteObserverState.pollTimerId = null;
  }

  castRemoteObserverState.remotePlayer = null;
  castRemoteObserverState.remotePlayerController = null;
  castRemoteObserverState.estimatedObservationDelayMs =
    playbackSynchronizationConfig.castRemoteObservation.initialDelayMs;
  castRemoteObserverState.leadershipMode = "idle";
  castRemoteObserverState.lastEmittedSignature = null;
  castRemoteObserverState.lastCommittedIntent = null;
  castRemoteObserverState.lastMirroredPlayback = null;
  castRemoteObserverState.lastObservedCurrentTime = null;
  castRemoteObserverState.lastObservedSessionId = null;
  castRemoteObserverState.lastObservedSignature = null;
  castRemoteObserverState.lastObservedStatus = null;
  castRemoteObserverState.stabilizationUntilMs = 0;

  updateChromecastRuntimeState({
    castObservationDelayMs:
      playbackSynchronizationConfig.castRemoteObservation.initialDelayMs,
    castRemoteLeadershipMode: "idle",
    castRemoteLeadershipReason: reason,
    castRemoteStabilizationUntil: null,
    remotePlayerObserved: false,
    remotePlayerPollingEnabled: false,
    remotePlayerObservationReason: reason,
    lastObservedRemoteCurrentTime: null,
    lastObservedRemoteExpectedCurrentTime: null,
    lastObservedRemotePlayerState: null,
    lastObservedRemoteIsPaused: null,
    lastAppliedRemoteStateSignature: null,
    castRemoteIntentState: "cast_remote_idle",
    castRemoteIntentReason: reason,
    pendingCastRemoteSignature: null,
    pendingCastRemoteObservedAt: null,
    pendingCastRemoteReason: null,
  });
}

function notifyChromecastRemotePlaybackListeners(
  event: ChromecastRemotePlaybackEvent,
) {
  chromecastRemotePlaybackListeners.forEach((listener) => {
    Promise.resolve(listener(event)).catch((error) => {
      logDebugEvent({
        level: "error",
        category: "cast",
        message:
          "A Chromecast remote playback listener failed while propagating a remote state change.",
        source: "cast_remote",
        data: error,
      });
    });
  });
}

function observeChromecastRemotePlaybackState(reason: string) {
  const currentSession = getCurrentCastSession();
  const sessionIdentity = currentSession
    ? getOrCreateCastSessionIdentity(currentSession)
    : null;
  const observedAtMs = Date.now();

  if (!currentSession || !sessionIdentity) {
    stopChromecastRemotePlaybackObservation(reason);
    return;
  }

  settleCastRemoteLeadershipMode(observedAtMs);

  const mediaSession =
    getCurrentCastMediaSession() ??
    getCastSessionLoadRecord(currentSession).activeMediaSession ??
    null;
  const remotePlayer = castRemoteObserverState.remotePlayer;
  const trackedContentId = resolveTrackedCastContentId();
  const trackedSelectionSignature = resolveTrackedCastSelectionSignature();
  const contentId =
    mediaSession?.media?.contentId ??
    remotePlayer?.mediaInfo?.contentId ??
    null;
  const selectionSignature =
    extractSelectionSignatureFromMediaSession(mediaSession) ??
    (typeof remotePlayer?.mediaInfo?.customData?.selectionSignature === "string"
      ? remotePlayer.mediaInfo.customData.selectionSignature
      : null) ??
    trackedSelectionSignature;
  const playerState = resolveObservedRemotePlayerState(remotePlayer, mediaSession);
  const currentTime = resolveObservedRemoteCurrentTime(remotePlayer, mediaSession);
  const playbackRate = resolveObservedRemotePlaybackRate(
    remotePlayer,
    mediaSession,
  );
  const isPaused =
    typeof remotePlayer?.isPaused === "boolean"
      ? remotePlayer.isPaused
      : playerState === "PAUSED"
        ? true
        : playerState === "PLAYING"
          ? false
          : null;
  const status = resolveObservedRemoteStatus({
    remotePlayer,
    mediaSession,
    playerState,
    isPaused,
  });
  const observationDelayMs =
    castRemoteObserverState.estimatedObservationDelayMs ??
    playbackSynchronizationConfig.castRemoteObservation.initialDelayMs;
  const expectedCurrentTime = castRemoteObserverState.lastMirroredPlayback
    ? computeExpectedCastRemoteTimeAtObservation(
        castRemoteObserverState.lastMirroredPlayback,
        observedAtMs,
        observationDelayMs,
      )
    : currentTime;

  updateChromecastRuntimeState({
    castObservationDelayMs: observationDelayMs,
    remotePlayerObserved:
      remotePlayer != null || castRemoteObserverState.remotePlayerController != null,
    remotePlayerObservationReason: reason,
    remotePlayerObservationSessionId: sessionIdentity.id,
    lastObservedRemoteExpectedCurrentTime: expectedCurrentTime,
    lastObservedRemoteCurrentTime: currentTime,
    lastObservedRemotePlayerState: playerState,
    lastObservedRemoteIsPaused: isPaused,
    lastObservedRemoteStatus: status,
  });

  if (!status || !contentId) {
    return;
  }

  if (trackedContentId && trackedContentId !== contentId) {
    return;
  }

  if (
    trackedSelectionSignature &&
    selectionSignature &&
    trackedSelectionSignature !== selectionSignature
  ) {
    return;
  }

  const nextSignature = buildPlaybackStateSignature({
    status,
    currentTime,
    playbackRate,
    selectionSignature,
  });
  const sessionChanged =
    castRemoteObserverState.lastObservedSessionId !== sessionIdentity.id;
  const commandType = resolveRemotePlaybackCommandType({
    nextStatus: status,
    nextCurrentTime: currentTime,
    previousStatus: sessionChanged
      ? null
      : castRemoteObserverState.lastObservedStatus,
    previousCurrentTime: sessionChanged
      ? null
      : castRemoteObserverState.lastObservedCurrentTime,
  });

  castRemoteObserverState.lastObservedSessionId = sessionIdentity.id;
  castRemoteObserverState.lastObservedSignature = nextSignature;
  castRemoteObserverState.lastObservedStatus = status;
  castRemoteObserverState.lastObservedCurrentTime = currentTime;

  if (!commandType) {
    return;
  }

  if (castRemoteObserverState.lastEmittedSignature === nextSignature) {
    logDebugEvent({
      level: "info",
      category: "cast",
      message:
        "Suppressed a duplicate Chromecast remote playback event that matched the last applied remote state.",
      source: "cast_remote",
      data: {
        commandType,
        currentTime,
        selectionSignature,
        signature: nextSignature,
        status,
      },
    });
    return;
  }

  const matchingLocalCommand = findMatchingRecentLocalCastCommand({
    status,
    currentTime,
    playbackRate,
    selectionSignature,
  });

  if (matchingLocalCommand) {
    rememberCastObservationDelaySample(
      observedAtMs - matchingLocalCommand.createdAt,
      "recent_local_cast_command",
    );
    castRemoteObserverState.lastEmittedSignature = nextSignature;
    updateChromecastRuntimeState({
      lastAppliedRemoteStateSignature: nextSignature,
      lastSuppressedRemoteStateSignature: nextSignature,
      lastSuppressedRemoteStateReason: "recent_local_cast_command",
    });
    rejectCastRemoteObservation("rejected_due_to_recent_local_cast_command", {
      commandType,
      currentTime,
      matchingLocalCommand,
      selectionSignature,
      signature: nextSignature,
      status,
    });
    if (commandType === "play" || commandType === "pause") {
      rejectCastRemoteIntent(
        "rejected_due_to_recent_local_cast_command",
        {
          type: commandType,
          status,
          currentTime: Math.round(currentTime * 1000) / 1000,
          playbackRate,
          playerState,
          isPaused,
          expectedCurrentTime: Math.round(expectedCurrentTime * 1000) / 1000,
          observationDelayMs,
          observedAt: new Date(observedAtMs).toISOString(),
          sessionId: sessionIdentity.id,
          contentId,
          selectionSignature,
          source: "cast_remote",
        },
        { matchingLocalCommand, signature: nextSignature },
      );
    }
    return;
  }

  if (
    castRemoteObserverState.stabilizationUntilMs > observedAtMs ||
    castRemoteObserverState.leadershipMode === "cast_handoff" ||
    castRemoteObserverState.leadershipMode === "cast_leader_stabilizing"
  ) {
    const pauseCandidateDuringStabilization =
      commandType === "pause" &&
      status === "paused" &&
      (playerState?.toUpperCase() === "PAUSED" || isPaused === true);

    if (pauseCandidateDuringStabilization) {
      const pauseEvent: ChromecastRemotePlaybackEvent = {
        type: commandType,
        status,
        currentTime: Math.round(currentTime * 1000) / 1000,
        playbackRate,
        playerState,
        isPaused,
        expectedCurrentTime: Math.round(expectedCurrentTime * 1000) / 1000,
        observationDelayMs,
        observedAt: new Date(observedAtMs).toISOString(),
        sessionId: sessionIdentity.id,
        contentId,
        selectionSignature,
        source: "cast_remote",
      };

      logDebugEvent({
        level: "info",
        category: "cast",
        message:
          "Observed a paused Chromecast remote state during stabilization and routed it into the remote pause confirmation fast-path.",
        source: "cast_remote",
        data: {
          commandType,
          currentTime,
          expectedCurrentTime,
          observationDelayMs,
          signature: nextSignature,
          status,
        },
      });
      queuePendingCastRemoteIntent(pauseEvent, nextSignature);
      return;
    }

    rejectCastRemoteObservation("rejected_due_to_cast_stabilization_window", {
      commandType,
      currentTime,
      expectedCurrentTime,
      observationDelayMs,
      signature: nextSignature,
      status,
      stabilizationUntil:
        castRemoteObserverState.stabilizationUntilMs > 0
          ? new Date(castRemoteObserverState.stabilizationUntilMs).toISOString()
          : null,
    });
    if (commandType === "play" || commandType === "pause") {
      rejectCastRemoteIntent(
        "rejected_due_to_cast_stabilization_window",
        {
          type: commandType,
          status,
          currentTime: Math.round(currentTime * 1000) / 1000,
          playbackRate,
          playerState,
          isPaused,
          expectedCurrentTime: Math.round(expectedCurrentTime * 1000) / 1000,
          observationDelayMs,
          observedAt: new Date(observedAtMs).toISOString(),
          sessionId: sessionIdentity.id,
          contentId,
          selectionSignature,
          source: "cast_remote",
        },
        { signature: nextSignature },
      );
    }
    return;
  }

  const plausibility = assessCastRemoteObservationPlausibility({
    commandType,
    expectedTime: expectedCurrentTime,
    observedTime: currentTime,
  });

  if (castRemoteObserverState.lastMirroredPlayback && !plausibility.plausible) {
    rejectCastRemoteObservation("rejected_due_to_implausible_remote_time", {
      commandType,
      currentTime,
      expectedCurrentTime,
      observationDelayMs,
      driftSeconds: plausibility.driftSeconds,
      signature: nextSignature,
      status,
    });
    if (commandType === "play" || commandType === "pause") {
      rejectCastRemoteIntent(
        "rejected_due_to_implausible_remote_time",
        {
          type: commandType,
          status,
          currentTime: Math.round(currentTime * 1000) / 1000,
          playbackRate,
          playerState,
          isPaused,
          expectedCurrentTime: Math.round(expectedCurrentTime * 1000) / 1000,
          observationDelayMs,
          observedAt: new Date(observedAtMs).toISOString(),
          sessionId: sessionIdentity.id,
          contentId,
          selectionSignature,
          source: "cast_remote",
        },
        { driftSeconds: plausibility.driftSeconds, signature: nextSignature },
      );
    }
    return;
  }

  if (castRemoteObserverState.pendingCandidate?.signature === nextSignature) {
    return;
  }

  const observedAt = new Date(observedAtMs).toISOString();
  const event: ChromecastRemotePlaybackEvent = {
    type: commandType,
    status,
    currentTime: Math.round(currentTime * 1000) / 1000,
    playbackRate,
    playerState,
    isPaused,
    expectedCurrentTime: Math.round(expectedCurrentTime * 1000) / 1000,
    observationDelayMs,
    observedAt,
    sessionId: sessionIdentity.id,
    contentId,
    selectionSignature,
    source: "cast_remote",
  };

  if (commandType === "play" || commandType === "pause") {
    queuePendingCastRemoteIntent(event, nextSignature);
    return;
  }

  queuePendingCastRemoteCandidate(event, nextSignature);
}

function ensureChromecastRemotePlaybackObservation(reason: string) {
  const currentSession = getCurrentCastSession();
  const sessionIdentity = currentSession
    ? getOrCreateCastSessionIdentity(currentSession)
    : null;

  if (!sessionIdentity) {
    stopChromecastRemotePlaybackObservation(reason);
    return;
  }

  if (
    castRemoteObserverState.lastObservedSessionId === sessionIdentity.id &&
    castRemoteObserverState.pollTimerId != null
  ) {
    observeChromecastRemotePlaybackState(`${reason}:refresh`);
    return;
  }

  stopChromecastRemotePlaybackObservation(`${reason}:restart`);

  const castFramework = getCastSdkWindow().cast?.framework;
  const remotePlayer = castFramework?.RemotePlayer
    ? new castFramework.RemotePlayer()
    : null;
  const remotePlayerController =
    remotePlayer && castFramework?.RemotePlayerController
      ? new castFramework.RemotePlayerController(remotePlayer)
      : null;
  const remotePlayerEventTypes = [
    castFramework?.RemotePlayerEventType?.CURRENT_TIME_CHANGED,
    castFramework?.RemotePlayerEventType?.IS_MEDIA_LOADED_CHANGED,
    castFramework?.RemotePlayerEventType?.IS_PAUSED_CHANGED,
    castFramework?.RemotePlayerEventType?.MEDIA_INFO_CHANGED,
    castFramework?.RemotePlayerEventType?.PLAYER_STATE_CHANGED,
  ].filter((value): value is string => typeof value === "string");

  castRemoteObserverState.remotePlayer = remotePlayer;
  castRemoteObserverState.remotePlayerController = remotePlayerController;
  castRemoteObserverState.lastObservedSessionId = sessionIdentity.id;

  if (remotePlayerController && remotePlayerEventTypes.length > 0) {
    const handleRemotePlayerEvent = () => {
      observeChromecastRemotePlaybackState("remote_player_event");
    };

    remotePlayerEventTypes.forEach((eventType) => {
      remotePlayerController.addEventListener?.(eventType, handleRemotePlayerEvent);
    });

    castRemoteObserverState.controllerCleanup = () => {
      remotePlayerEventTypes.forEach((eventType) => {
        remotePlayerController.removeEventListener?.(
          eventType,
          handleRemotePlayerEvent,
        );
      });
    };
  }

  castRemoteObserverState.pollTimerId = window.setInterval(() => {
    observeChromecastRemotePlaybackState("poll");
  }, remotePlaybackPollIntervalMs);

  updateChromecastRuntimeState({
    remotePlayerObserved:
      remotePlayer != null || remotePlayerController != null,
    remotePlayerPollingEnabled: true,
    remotePlayerObservationReason: reason,
    remotePlayerObservationSessionId: sessionIdentity.id,
  });
  observeChromecastRemotePlaybackState(`${reason}:initial`);
}

function buildChromecastPresentationState(
  runtimeSnapshot: Record<string, unknown>,
  castState: string | null | undefined,
) {
  const baseState = describeCastState(castState);
  const currentCastSessionId =
    typeof runtimeSnapshot.currentCastSessionId === "string"
      ? runtimeSnapshot.currentCastSessionId
      : null;
  const currentCastSessionErrorCode =
    typeof runtimeSnapshot.currentCastSessionErrorCode === "string"
      ? runtimeSnapshot.currentCastSessionErrorCode
      : null;
  const currentCastSessionErrorMessage =
    typeof runtimeSnapshot.currentCastSessionErrorMessage === "string"
      ? runtimeSnapshot.currentCastSessionErrorMessage
      : null;
  const activeMediaSessionConfirmedForCurrentSession =
    runtimeSnapshot.activeMediaSessionConfirmedForCurrentSession === true;
  const castResolverOk =
    runtimeSnapshot.castResolverOk === true
      ? true
      : runtimeSnapshot.castResolverOk === false
        ? false
        : null;
  const castResolverErrorCode =
    typeof runtimeSnapshot.castResolverErrorCode === "string"
      ? runtimeSnapshot.castResolverErrorCode
      : null;
  const castResolverErrorMessage =
    typeof runtimeSnapshot.castResolverErrorMessage === "string"
      ? runtimeSnapshot.castResolverErrorMessage
      : null;
  const castResolverWarnings = readCastResolverWarnings(
    runtimeSnapshot.castResolverWarnings,
  );
  const primaryResolverWarning = getPrimaryCastResolverWarning(
    castResolverWarnings,
  );
  const hasActiveSessionFailure =
    Boolean(currentCastSessionId && currentCastSessionErrorCode) &&
    !activeMediaSessionConfirmedForCurrentSession;

  if (hasActiveSessionFailure) {
    return {
      status: "error" as const,
      issue:
        currentCastSessionErrorMessage ??
        "The current Cast session failed before room media became ready.",
      issueCode: currentCastSessionErrorCode,
      canRequestSession: false,
    };
  }

  if (castResolverOk === false && !activeMediaSessionConfirmedForCurrentSession) {
    return {
      status: "error" as const,
      issue:
        castResolverErrorMessage ??
        "Chromecast media preparation is blocked for the current room selection.",
      issueCode: castResolverErrorCode ?? "media_resolve_failed",
      canRequestSession: currentCastSessionId == null,
    };
  }

  if (castResolverOk === false && activeMediaSessionConfirmedForCurrentSession) {
    return {
      status: "connected" as const,
      issue:
        castResolverErrorMessage ??
        "Chromecast kept the current media because the requested room selection could not be prepared.",
      issueCode: castResolverErrorCode ?? "media_resolve_failed",
      canRequestSession: false,
    };
  }

  if (
    castState === getCastSdkWindow().cast?.framework?.CastState.CONNECTED &&
    activeMediaSessionConfirmedForCurrentSession
  ) {
    return {
      status: "connected" as const,
      issue: primaryResolverWarning?.message ?? null,
      issueCode: primaryResolverWarning?.code ?? null,
      canRequestSession: false,
    };
  }

  return baseState;
}

export function subscribeToChromecastRuntime(
  listener: ChromecastRuntimeListener,
) {
  chromecastRuntimeListeners.add(listener);
  listener(castRuntimeSnapshot);
  return () => {
    chromecastRuntimeListeners.delete(listener);
  };
}

export function subscribeToChromecastRemotePlayback(
  listener: ChromecastRemotePlaybackListener,
) {
  chromecastRemotePlaybackListeners.add(listener);
  return () => {
    chromecastRemotePlaybackListeners.delete(listener);
  };
}

function getCastSessionLoadRecord(session: CastSessionInstance) {
  const existingRecord = castSessionLoadRecords.get(session as object);

  if (existingRecord) {
    return existingRecord;
  }

  const nextRecord: CastSessionLoadRecord = {
    activeMediaSession: null,
    inflightSelectionSignature: null,
    inflightPromise: null,
    lastFailedSelectionSignature: null,
    lastFailureReason: null,
    lastLoadedContentUrl: null,
    lastLoadedSelectionSignature: null,
    lastMirroredPlaybackVersion: null,
  };
  castSessionLoadRecords.set(session as object, nextRecord);
  return nextRecord;
}

function resolveUsableCastMediaSession(
  resolvedMedia: CastResolvedMediaSuccessPayload,
  loadRecord: CastSessionLoadRecord | null,
) {
  const liveMediaSession = getCurrentCastMediaSession();

  if (isSameCastMediaSession(liveMediaSession, resolvedMedia, loadRecord)) {
    if (loadRecord) {
      loadRecord.activeMediaSession = liveMediaSession;
    }

    return {
      mediaSession: liveMediaSession,
      source: "live" as const,
    };
  }

  if (
    loadRecord?.activeMediaSession &&
    isSameCastMediaSession(loadRecord.activeMediaSession, resolvedMedia, loadRecord)
  ) {
    return {
      mediaSession: loadRecord.activeMediaSession,
      source: "cached" as const,
    };
  }

  return {
    mediaSession: null,
    source: "none" as const,
  };
}

function buildChromecastHealthSnapshot(runtimeSnapshot: Record<string, unknown>) {
  const castStatus =
    typeof runtimeSnapshot.castStatus === "string"
      ? runtimeSnapshot.castStatus
      : "loading";
  const mediaLoadStatus =
    typeof runtimeSnapshot.mediaLoadStatus === "string"
      ? runtimeSnapshot.mediaLoadStatus
      : "idle";
  const mediaLoadSucceeded = runtimeSnapshot.mediaLoadSucceeded === true;
  const mediaLoadBlocked = runtimeSnapshot.mediaLoadBlocked === true;
  const mediaSessionReturned =
    runtimeSnapshot.activeMediaSessionConfirmedForCurrentSession === true ||
    runtimeSnapshot.mediaSessionReturned === true;
  const currentCastSessionId =
    typeof runtimeSnapshot.currentCastSessionId === "string"
      ? runtimeSnapshot.currentCastSessionId
      : null;
  const currentCastSessionStartedAt =
    typeof runtimeSnapshot.currentCastSessionStartedAt === "string"
      ? runtimeSnapshot.currentCastSessionStartedAt
      : null;
  const currentRoomMediaContentId =
    typeof runtimeSnapshot.lastRequestedMediaContentId === "string"
      ? runtimeSnapshot.lastRequestedMediaContentId
      : null;
  const currentRoomMediaSelectionSignature =
    typeof runtimeSnapshot.lastRequestedSelectionSignature === "string"
      ? runtimeSnapshot.lastRequestedSelectionSignature
      : null;
  const activeMediaSessionContentId =
    typeof runtimeSnapshot.activeMediaSessionContentId === "string"
      ? runtimeSnapshot.activeMediaSessionContentId
      : typeof runtimeSnapshot.mediaSessionContentId === "string"
        ? runtimeSnapshot.mediaSessionContentId
        : typeof runtimeSnapshot.mediaContentId === "string"
          ? runtimeSnapshot.mediaContentId
          : null;
  const activeMediaSessionSelectionSignature =
    typeof runtimeSnapshot.activeMediaSessionSelectionSignature === "string"
      ? runtimeSnapshot.activeMediaSessionSelectionSignature
      : null;
  const currentCastSessionErrorCode =
    typeof runtimeSnapshot.currentCastSessionErrorCode === "string"
      ? runtimeSnapshot.currentCastSessionErrorCode
      : null;
  const currentCastSessionErrorMessage =
    typeof runtimeSnapshot.currentCastSessionErrorMessage === "string"
      ? runtimeSnapshot.currentCastSessionErrorMessage
      : null;
  const activeMediaSessionConfirmedForCurrentSession =
    runtimeSnapshot.activeMediaSessionConfirmedForCurrentSession === true;
  const currentRoomMediaLoadedOnChromecast = Boolean(
    currentCastSessionId &&
    currentRoomMediaContentId &&
      activeMediaSessionContentId &&
      currentRoomMediaContentId === activeMediaSessionContentId &&
      (!currentRoomMediaSelectionSignature ||
        !activeMediaSessionSelectionSignature ||
        currentRoomMediaSelectionSignature ===
          activeMediaSessionSelectionSignature) &&
      mediaLoadSucceeded &&
      mediaSessionReturned &&
      activeMediaSessionConfirmedForCurrentSession,
  );
  const activeControllableMediaSession =
    runtimeSnapshot.activeControllableMediaSession === true &&
    activeMediaSessionConfirmedForCurrentSession;
  const mirrorCommandsEnabled =
    castStatus === "connected" &&
    activeControllableMediaSession &&
    !currentCastSessionErrorCode;
  const castSubtitleTrackMode =
    typeof runtimeSnapshot.castSubtitleTrackMode === "string"
      ? runtimeSnapshot.castSubtitleTrackMode
      : "unknown";
  const loadRequest =
    runtimeSnapshot.mediaLoadRequest &&
    typeof runtimeSnapshot.mediaLoadRequest === "object"
      ? (runtimeSnapshot.mediaLoadRequest as Record<string, unknown>)
      : null;
  const likelyFailureReason =
    typeof runtimeSnapshot.mediaLoadLikelyFailureReason === "string"
      ? runtimeSnapshot.mediaLoadLikelyFailureReason
      : null;
  const lastSuccessfulCastSessionId =
    typeof runtimeSnapshot.lastSuccessfulCastSessionId === "string"
      ? runtimeSnapshot.lastSuccessfulCastSessionId
      : null;
  const lastFailedCastSessionId =
    typeof runtimeSnapshot.lastFailedCastSessionId === "string"
      ? runtimeSnapshot.lastFailedCastSessionId
      : null;
  const remotePlaybackState =
    typeof runtimeSnapshot.remotePlaybackState === "string"
      ? runtimeSnapshot.remotePlaybackState
      : currentRoomMediaLoadedOnChromecast
        ? "loaded_idle"
        : "none";
  const castResolverOk =
    runtimeSnapshot.castResolverOk === true
      ? true
      : runtimeSnapshot.castResolverOk === false
        ? false
        : null;
  const castResolverWarnings = readCastResolverWarnings(
    runtimeSnapshot.castResolverWarnings,
  );
  const primaryResolverWarning = getPrimaryCastResolverWarning(
    castResolverWarnings,
  );
  const castResolverErrorMessage =
    typeof runtimeSnapshot.castResolverErrorMessage === "string"
      ? runtimeSnapshot.castResolverErrorMessage
      : null;
  const castFallbackApplied = runtimeSnapshot.castFallbackApplied === true;
  const castFallbackReason =
    typeof runtimeSnapshot.castFallbackReason === "string"
      ? runtimeSnapshot.castFallbackReason
      : null;
  const ffmpegAvailable =
    typeof runtimeSnapshot.ffmpegAvailable === "boolean"
      ? runtimeSnapshot.ffmpegAvailable
      : null;
  const ffmpegBinary =
    typeof runtimeSnapshot.ffmpegBinary === "string"
      ? runtimeSnapshot.ffmpegBinary
      : null;
  const ffmpegFailureReason =
    typeof runtimeSnapshot.ffmpegFailureReason === "string"
      ? runtimeSnapshot.ffmpegFailureReason
      : null;
  const resolvedCastMode =
    typeof runtimeSnapshot.resolvedCastMode === "string"
      ? runtimeSnapshot.resolvedCastMode
      : null;
  const resolvedEffectiveAudioTrackId =
    typeof runtimeSnapshot.resolvedEffectiveAudioTrackId === "string"
      ? runtimeSnapshot.resolvedEffectiveAudioTrackId
      : null;
  const resolvedEffectiveSubtitleTrackId =
    typeof runtimeSnapshot.resolvedEffectiveSubtitleTrackId === "string"
      ? runtimeSnapshot.resolvedEffectiveSubtitleTrackId
      : null;
  const castVariantStoragePath =
    typeof runtimeSnapshot.castVariantStoragePath === "string"
      ? runtimeSnapshot.castVariantStoragePath
      : null;
  const remotePlayerObserved = runtimeSnapshot.remotePlayerObserved === true;
  const remotePlayerPollingEnabled =
    runtimeSnapshot.remotePlayerPollingEnabled === true;
  const lastObservedRemoteCurrentTime =
    typeof runtimeSnapshot.lastObservedRemoteCurrentTime === "number"
      ? runtimeSnapshot.lastObservedRemoteCurrentTime
      : null;
  const lastObservedRemotePlayerState =
    typeof runtimeSnapshot.lastObservedRemotePlayerState === "string"
      ? runtimeSnapshot.lastObservedRemotePlayerState
      : null;
  const lastObservedRemoteIsPaused =
    typeof runtimeSnapshot.lastObservedRemoteIsPaused === "boolean"
      ? runtimeSnapshot.lastObservedRemoteIsPaused
      : null;
  const lastRemoteOriginatedRoomCommand =
    runtimeSnapshot.lastRemoteOriginatedRoomCommand &&
    typeof runtimeSnapshot.lastRemoteOriginatedRoomCommand === "object"
      ? runtimeSnapshot.lastRemoteOriginatedRoomCommand
      : null;
  const lastAppliedRemoteStateSignature =
    typeof runtimeSnapshot.lastAppliedRemoteStateSignature === "string"
      ? runtimeSnapshot.lastAppliedRemoteStateSignature
      : null;

  let healthStatus = "idle";

  if (
    (currentCastSessionErrorCode && !activeMediaSessionConfirmedForCurrentSession) ||
    (castResolverOk === false && !activeMediaSessionConfirmedForCurrentSession)
  ) {
    healthStatus = "error";
  } else if (mirrorCommandsEnabled) {
    healthStatus = "healthy";
  } else if (castStatus === "connected" && mediaLoadStatus === "loaded") {
    healthStatus = "connected_without_mirroring";
  } else if (castStatus === "connected") {
    healthStatus = "connected_loading_media";
  } else if (castStatus === "connecting" || castStatus === "loading") {
    healthStatus = "connecting";
  } else if (castStatus === "unavailable") {
    healthStatus = "unavailable";
  } else if (castStatus === "error") {
    healthStatus = "error";
  }

  return {
    healthStatus,
    currentCastSessionId,
    currentCastSessionStartedAt,
    activeCastSessionState: castStatus,
    activeMediaSessionState: activeMediaSessionContentId
      ? currentRoomMediaLoadedOnChromecast
        ? remotePlaybackState === "playing"
          ? "room_media_playing"
          : remotePlaybackState === "paused"
            ? "room_media_paused"
            : remotePlaybackState === "stopped"
              ? "room_media_stopped"
              : "room_media_loaded"
        : "other_media_session"
      : "none",
    mediaLoadStatus,
    mediaLoadSucceeded,
    mediaLoadBlocked,
    mediaSessionReturned,
    activeMediaSessionConfirmedForCurrentSession,
    castResolverOk,
    castResolverWarnings,
    castFallbackApplied,
    castFallbackReason,
    resolvedCastMode,
    resolvedEffectiveAudioTrackId,
    resolvedEffectiveSubtitleTrackId,
    castVariantStoragePath,
    ffmpegAvailable,
    ffmpegBinary,
    ffmpegFailureReason,
    remotePlayerObserved,
    remotePlayerPollingEnabled,
    lastObservedRemoteCurrentTime,
    lastObservedRemotePlayerState,
    lastObservedRemoteIsPaused,
    lastRemoteOriginatedRoomCommand,
    lastAppliedRemoteStateSignature,
    currentRoomMediaContentId,
    activeMediaSessionContentId,
    currentRoomMediaLoadedOnChromecast,
    mirrorCommandsEnabled,
    activeControllableMediaSession,
    remotePlaybackState,
    initialCastStateAppliedAfterLoad:
      runtimeSnapshot.initialCastStateAppliedAfterLoad === true,
    usedExistingMediaSessionForMirror:
      runtimeSnapshot.usedExistingMediaSessionForMirror === true,
    reloadedMediaInsteadOfControlling:
      runtimeSnapshot.reloadedMediaInsteadOfControlling === true,
    lastSuccessfulCastSessionId,
    lastFailedCastSessionId,
    castSubtitleTrackMode,
    subtitleSupportEnabled:
      castSubtitleTrackMode === "included_in_load_request" ||
      castSubtitleTrackMode === "editable_after_load",
    subtitleSupportReason:
      loadRequest?.subtitlesIncludedInLoadRequest === true
        ? null
        : "No subtitle text tracks were present in the resolved Cast media payload.",
    currentIssue:
      mirrorCommandsEnabled
        ? castResolverErrorMessage ??
          primaryResolverWarning?.message ??
          null
        : currentCastSessionErrorMessage ??
          castResolverErrorMessage ??
          likelyFailureReason ??
          castFallbackReason ??
          primaryResolverWarning?.message ??
          null,
  };
}

function extractCastMediaSessionFromEvent(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const maybeEvent = event as {
    media?: unknown;
    mediaSession?: unknown;
  };
  const candidate = maybeEvent.mediaSession ?? maybeEvent.media;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return candidate as CastMediaSession;
}

function summarizeCastLoadResult(result: unknown) {
  if (result == null) {
    return null;
  }

  if (typeof result === "string" || typeof result === "number") {
    return result;
  }

  if (typeof result !== "object") {
    return String(result);
  }

  const maybeResult = result as {
    code?: unknown;
    description?: unknown;
    media?: { contentId?: unknown } | null;
    contentId?: unknown;
  };

  return {
    code:
      typeof maybeResult.code === "string" || typeof maybeResult.code === "number"
        ? maybeResult.code
        : null,
    description:
      typeof maybeResult.description === "string"
        ? maybeResult.description
        : null,
    mediaContentId:
      typeof maybeResult.media?.contentId === "string"
        ? maybeResult.media.contentId
        : typeof maybeResult.contentId === "string"
          ? maybeResult.contentId
          : null,
  };
}

async function inspectCastMediaResponseHeaders(
  contentUrl: string,
): Promise<CastMediaResponseDiagnostics> {
  try {
    const response = await fetch(contentUrl, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
    });

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      acceptRanges: response.headers.get("accept-ranges"),
      contentLength: response.headers.get("content-length"),
      cacheControl: response.headers.get("cache-control"),
      accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
      failure: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: null,
      acceptRanges: null,
      contentLength: null,
      cacheControl: null,
      accessControlAllowOrigin: null,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

function isPrivateNetworkHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  ) {
    return true;
  }

  if (/^10\./.test(normalizedHostname)) {
    return true;
  }

  if (/^192\.168\./.test(normalizedHostname)) {
    return true;
  }

  const private172Match = normalizedHostname.match(/^172\.(\d{1,3})\./);

  if (private172Match) {
    const secondOctet = Number(private172Match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }

  return false;
}

function inferMissingCastMediaSessionReason(
  contentUrl: string,
  contentType: string,
  mediaResponseDiagnostics: CastMediaResponseDiagnostics,
) {
  if (mediaResponseDiagnostics.failure) {
    return `A sender-side HEAD request to the Cast media URL failed before load confirmation: ${mediaResponseDiagnostics.failure}`;
  }

  if (
    mediaResponseDiagnostics.status != null &&
    (mediaResponseDiagnostics.status < 200 || mediaResponseDiagnostics.status >= 300)
  ) {
    return `The Cast media URL returned HTTP ${mediaResponseDiagnostics.status} to a sender-side HEAD request.`;
  }

  if (
    mediaResponseDiagnostics.contentType &&
    !mediaResponseDiagnostics.contentType.toLowerCase().startsWith("video/")
  ) {
    return `The Cast media URL is serving ${mediaResponseDiagnostics.contentType}, which may not be accepted as video content by the Default Media Receiver.`;
  }

  try {
    const url = new URL(contentUrl);

    if (url.protocol === "https:" && isPrivateNetworkHostname(url.hostname)) {
      return "The Chromecast receiver most likely could not fetch or trust the private-network HTTPS media URL. Local browser playback can still work if this computer trusts a local certificate authority that the receiver device does not trust.";
    }
  } catch {
    return `The Cast receiver did not create a media session for ${contentType}. The media URL or receiver compatibility is the most likely cause.`;
  }

  return `The Cast receiver did not create a media session for ${contentType}. The media URL, MIME type, or receiver compatibility is the most likely cause.`;
}

function detectCastEnvironment(): CastEnvironmentSnapshot {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{ brand: string }>;
    };
  };
  const userAgentData = navigatorWithUserAgentData.userAgentData;
  const userAgent = navigator.userAgent;
  const brandList =
    userAgentData?.brands?.map((brand) => brand.brand).join(", ") ?? "";
  const combinedUserAgent = `${brandList} ${userAgent}`.toLowerCase();
  const isIosBrowser = /iphone|ipad|ipod/.test(combinedUserAgent);
  const isFirefox = combinedUserAgent.includes("firefox");
  const isEdge =
    combinedUserAgent.includes("microsoft edge") || /edg\//.test(combinedUserAgent);
  const isChromiumBrowser =
    !isIosBrowser &&
    !isFirefox &&
    (combinedUserAgent.includes("google chrome") ||
      combinedUserAgent.includes("chromium") ||
      /chrome\//.test(combinedUserAgent) ||
      isEdge);

  let browserName = "Unknown browser";

  if (isEdge) {
    browserName = "Edge";
  } else if (isFirefox) {
    browserName = "Firefox";
  } else if (
    combinedUserAgent.includes("google chrome") ||
    /chrome\//.test(combinedUserAgent)
  ) {
    browserName = "Chrome";
  } else if (combinedUserAgent.includes("safari")) {
    browserName = "Safari";
  } else if (combinedUserAgent.includes("chromium")) {
    browserName = "Chromium";
  }

  return {
    browserName,
    isSupportedBrowser: isChromiumBrowser,
    isSecureContext: window.isSecureContext,
  };
}

function buildUnsupportedBrowserMessage(browserName: string) {
  return `Google Cast requires a Cast-supported browser such as Chrome or Edge, plus HTTPS. This session is running in ${browserName}.`;
}

function buildInsecureContextMessage() {
  return "Google Cast requires HTTPS in a Cast-supported browser such as Chrome or Edge.";
}

function buildSdkUnavailableMessage() {
  return "The Google Cast SDK loaded, but sender APIs are still unavailable in this supported browser session.";
}

function buildSessionStartFailedMessage() {
  return "The Cast session request failed in this browser session.";
}

function hasCastApis() {
  const castWindow = getCastSdkWindow();

  return Boolean(
    castWindow.cast?.framework?.CastContext &&
      castWindow.chrome?.cast?.media &&
      castWindow.chrome.cast.isAvailable !== false,
  );
}

async function waitForCastApis(timeoutMs = castSdkReadyTimeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (hasCastApis()) {
      return;
    }

    await waitFor(100);
  }

  throw new ChromecastError(
    "sdk_unavailable",
    buildSdkUnavailableMessage(),
  );
}

function getCurrentCastContext() {
  return getCastSdkWindow().cast?.framework?.CastContext.getInstance() ?? null;
}

function getCurrentCastSession() {
  return getCurrentCastContext()?.getCurrentSession() ?? null;
}

function getCurrentCastMediaSession() {
  const currentSession = getCurrentCastSession();

  if (!currentSession) {
    return null;
  }

  return (currentSession.getMediaSession?.() as CastMediaSession | null) ?? null;
}

function toChromecastAvailabilityStatus(castState: string | null | undefined) {
  const castFramework = getCastSdkWindow().cast?.framework;

  if (!castFramework || !castState) {
    return "loading" as const;
  }

  switch (castState) {
    case castFramework.CastState.CONNECTED:
      return "connected" as const;
    case castFramework.CastState.CONNECTING:
      return "connecting" as const;
    case castFramework.CastState.NOT_CONNECTED:
      return "available" as const;
    case castFramework.CastState.NO_DEVICES_AVAILABLE:
      return "unavailable" as const;
    default:
      return "loading" as const;
  }
}

function describeCastState(castState: string | null | undefined) {
  const status = toChromecastAvailabilityStatus(castState);

  switch (status) {
    case "loading":
      return {
        status,
        issue: "Checking Cast support for this browser session.",
        issueCode: "checking",
        canRequestSession: false,
      };
    case "unavailable":
      return {
        status,
        issue: "No Cast devices are currently available on this browser or network.",
        issueCode: "no_devices_available",
        canRequestSession: false,
      };
    case "available":
      return { status, issue: null, issueCode: null, canRequestSession: true };
    case "connecting":
      return {
        status,
        issue: "Waiting for the Cast session to finish connecting.",
        issueCode: "connecting",
        canRequestSession: false,
      };
    case "connected":
      return { status, issue: null, issueCode: null, canRequestSession: false };
  }
}

function normalizeChromecastError(error: unknown) {
  if (error instanceof ChromecastError) {
    return error;
  }

  if (error instanceof Error) {
    return new ChromecastError("sdk_unavailable", error.message, error);
  }

  return new ChromecastError(
    "sdk_unavailable",
    "Google Cast reported an unknown error.",
    error,
  );
}

async function waitForCastMediaSession(
  currentSession: CastSessionInstance,
  timeoutMs = castMediaSessionReadyTimeoutMs,
) {
  const existingMediaSession = getCurrentCastMediaSession();

  if (existingMediaSession) {
    return existingMediaSession;
  }

  return new Promise<CastMediaSession | null>((resolve) => {
    const mediaSessionEventType =
      getCastSdkWindow().cast?.framework?.SessionEventType?.MEDIA_SESSION;
    let isSettled = false;
    let pollTimerId = 0;
    let timeoutTimerId = 0;

    const cleanup = () => {
      if (pollTimerId) {
        window.clearInterval(pollTimerId);
      }

      if (timeoutTimerId) {
        window.clearTimeout(timeoutTimerId);
      }

      if (mediaSessionEventType) {
        currentSession.removeEventListener?.(mediaSessionEventType, handleSessionEvent);
      }
    };

    const settleWith = (mediaSession: CastMediaSession | null) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      cleanup();
      resolve(mediaSession);
    };

    const handleCandidate = (candidate: CastMediaSession | null) => {
      if (!candidate) {
        return;
      }

      const sessionIdentity = getOrCreateCastSessionIdentity(currentSession);
      updateChromecastRuntimeState({
        currentCastSessionId: sessionIdentity.id,
        currentCastSessionStartedAt: sessionIdentity.startedAt,
        activeMediaSessionConfirmedForCurrentSession: true,
        activeMediaSessionContentId: candidate.media?.contentId ?? null,
        activeMediaSessionSelectionSignature:
          extractSelectionSignatureFromMediaSession(candidate),
        mediaSessionReturned: true,
        mediaSessionContentId: candidate.media?.contentId ?? null,
      });
      settleWith(candidate);
    };

    const handleSessionEvent = (event: unknown) => {
      const mediaSession =
        extractCastMediaSessionFromEvent(event) ?? getCurrentCastMediaSession();

      if (!mediaSession) {
        return;
      }

      updateChromecastRuntimeState({
        mediaSessionEventObserved: true,
        mediaSessionEventData: event,
      });
      handleCandidate(mediaSession);
    };

    if (mediaSessionEventType) {
      currentSession.addEventListener?.(mediaSessionEventType, handleSessionEvent);
    }

    pollTimerId = window.setInterval(() => {
      handleCandidate(getCurrentCastMediaSession());
    }, 150);
    timeoutTimerId = window.setTimeout(() => {
      settleWith(null);
    }, timeoutMs);
  });
}

function castCommandAsPromise(
  invokeCommand: (
    successCallback: () => void,
    errorCallback: (error: unknown) => void,
  ) => void,
) {
  return new Promise<void>((resolve, reject) => {
    invokeCommand(resolve, reject);
  });
}

function buildCastLoadRequest(
  resolvedMedia: CastResolvedMediaSuccessPayload,
  playback: PlaybackStateSnapshot,
) {
  const chromeCastMedia = getCastSdkWindow().chrome?.cast?.media;

  if (!chromeCastMedia) {
    throw new ChromecastError(
      "media_load_failed",
      "Google Cast media APIs are unavailable in this browser session.",
    );
  }

  const mediaInfo = new chromeCastMedia.MediaInfo(
    resolvedMedia.contentUrl,
    resolvedMedia.contentType,
  );
  const metadata = new chromeCastMedia.GenericMediaMetadata();
  metadata.title = resolvedMedia.title;

  if (resolvedMedia.posterUrl && isCastableAbsoluteUrl(resolvedMedia.posterUrl)) {
    metadata.images = [{ url: resolvedMedia.posterUrl }];
  }

  mediaInfo.metadata = metadata;
  mediaInfo.contentUrl = resolvedMedia.contentUrl;
  mediaInfo.customData = {
    selectionSignature: resolvedMedia.selectionSignature,
    castMode: resolvedMedia.castMode,
    selectedAudioTrackId: resolvedMedia.selectedAudioTrackId,
    selectedSubtitleTrackId: resolvedMedia.selectedSubtitleTrackId,
    effectiveAudioTrackId: resolvedMedia.resolvedEffectiveAudioTrackId,
    effectiveSubtitleTrackId: resolvedMedia.resolvedEffectiveSubtitleTrackId,
    castFallbackApplied: resolvedMedia.castFallbackApplied,
    castResolverWarnings: resolvedMedia.warnings,
    variantCacheKey: resolvedMedia.diagnostics.variantCacheKey,
    variantId: resolvedMedia.diagnostics.variantId,
  };
  mediaInfo.streamType = chromeCastMedia.StreamType.BUFFERED;

  if (resolvedMedia.textTracks.length > 0) {
    mediaInfo.tracks = resolvedMedia.textTracks.map((track) => {
      const castTrack = new chromeCastMedia.Track(
        track.trackId,
        chromeCastMedia.TrackType.TEXT,
      );

      castTrack.trackContentId = track.trackContentId;
      castTrack.trackContentType = track.trackContentType;
      castTrack.name = track.name;
      castTrack.language = track.language;
      castTrack.subtype = chromeCastMedia.TextTrackType.SUBTITLES;
      return castTrack;
    });
  }

  const loadRequest = new chromeCastMedia.LoadRequest(mediaInfo);
  loadRequest.autoplay = playback.status === "playing";
  loadRequest.currentTime =
    playback.status === "stopped"
      ? 0
      : resolveSynchronizedPlaybackTime(playback);

  const activeTrackIds = resolvedMedia.activeTrackIds;

  if (activeTrackIds.length > 0) {
    loadRequest.activeTrackIds = activeTrackIds;
  }

  const diagnostics: CastLoadRequestDiagnostics = {
    receiverApplicationId: getCurrentCastReceiverApplicationId(),
    contentId: mediaInfo.contentId ?? resolvedMedia.contentUrl,
    contentUrl: mediaInfo.contentUrl ?? resolvedMedia.contentUrl,
    contentType: mediaInfo.contentType ?? resolvedMedia.contentType,
    streamType: mediaInfo.streamType ?? null,
    title: resolvedMedia.title,
    posterUrl:
      resolvedMedia.posterUrl && isCastableAbsoluteUrl(resolvedMedia.posterUrl)
        ? resolvedMedia.posterUrl
        : null,
    autoplay: loadRequest.autoplay ?? false,
    currentTime: loadRequest.currentTime ?? 0,
    subtitlesIncludedInLoadRequest: resolvedMedia.textTracks.length > 0,
    subtitleTrackCatalogSize: resolvedMedia.textTracks.length,
    selectedAudioTrackId: resolvedMedia.selectedAudioTrackId,
    selectedSubtitleTrackId: resolvedMedia.selectedSubtitleTrackId,
    activeTrackIds,
    castMode: resolvedMedia.castMode,
    selectionSignature: resolvedMedia.selectionSignature,
    castFallbackApplied: resolvedMedia.castFallbackApplied,
    castFallbackReason:
      resolvedMedia.castFallbackReason ??
      getPrimaryCastResolverWarning(resolvedMedia.warnings)?.message ??
      null,
    resolverWarnings: resolvedMedia.warnings,
    variantCacheKey: resolvedMedia.diagnostics.variantCacheKey,
    variantId: resolvedMedia.diagnostics.variantId,
    variantStatus: resolvedMedia.diagnostics.variantStatus,
    ffmpegAvailable: resolvedMedia.diagnostics.ffmpegAvailable,
    ffmpegBinary: resolvedMedia.diagnostics.ffmpegBinary,
    ffmpegGenerationStatus: resolvedMedia.diagnostics.ffmpegStatus,
    ffmpegFailureReason: resolvedMedia.diagnostics.ffmpegFailureReason,
  };

  return {
    loadRequest,
    diagnostics,
  };
}

function isSameCastMediaSession(
  mediaSession: CastMediaSession | null,
  resolvedMedia: CastResolvedMediaSuccessPayload,
  loadRecord: CastSessionLoadRecord | null,
) {
  const sessionContentId = mediaSession?.media?.contentId ?? null;

  if (sessionContentId !== resolvedMedia.contentUrl) {
    return false;
  }

  const sessionSelectionSignature =
    extractSelectionSignatureFromMediaSession(mediaSession) ??
    loadRecord?.lastLoadedSelectionSignature ??
    null;

  if (
    sessionSelectionSignature == null &&
    (resolvedMedia.selectedAudioTrackId != null ||
      resolvedMedia.selectedSubtitleTrackId != null)
  ) {
    return false;
  }

  return (
    sessionSelectionSignature == null ||
    sessionSelectionSignature === resolvedMedia.selectionSignature
  );
}

function canMirrorChromecastPlayback(
  resolvedMedia: CastResolvedMediaSuccessPayload,
  mediaSession: CastMediaSession | null,
  loadRecord: CastSessionLoadRecord | null,
) {
  return (
    castRuntimeSnapshot.castStatus === "connected" &&
    castRuntimeSnapshot.currentCastSessionErrorCode == null &&
    castRuntimeSnapshot.mediaLoadSucceeded === true &&
    castRuntimeSnapshot.mediaLoadBlocked !== true &&
    castRuntimeSnapshot.activeMediaSessionConfirmedForCurrentSession === true &&
    isSameCastMediaSession(mediaSession, resolvedMedia, loadRecord)
  );
}

async function ensureRoomMediaLoadedOnChromecast(
  media: RoomMediaSummary,
  playback: PlaybackStateSnapshot,
  resolvedMedia: CastResolvedMediaSuccessPayload,
) {
  const currentSession = getCurrentCastSession();
  const sessionIdentity = reconcileCurrentCastSessionScope(currentSession);
  const loadRecord = currentSession ? getCastSessionLoadRecord(currentSession) : null;

  updateChromecastRuntimeState({
    mediaLoadStatus: currentSession ? "session_available" : "no_session",
    activeControllableMediaSession: false,
    receiverApplicationId: getCurrentCastReceiverApplicationId(),
    currentCastSessionId: sessionIdentity?.id ?? null,
    currentCastSessionStartedAt: sessionIdentity?.startedAt ?? null,
  });

  if (!currentSession || !loadRecord) {
    return null;
  }
  const existingMediaSession = resolveUsableCastMediaSession(resolvedMedia, loadRecord);

  updateChromecastRuntimeState({
    mediaContentId: existingMediaSession.mediaSession?.media?.contentId ?? null,
    resolvedCastMode: resolvedMedia.castMode,
    resolvedContentUrl: resolvedMedia.contentUrl,
    resolvedContentType: resolvedMedia.contentType,
    resolvedSelectionSignature: resolvedMedia.selectionSignature,
    resolvedAudioTrackId: resolvedMedia.selectedAudioTrackId,
    resolvedSubtitleTrackId: resolvedMedia.selectedSubtitleTrackId,
  });

  if (existingMediaSession.mediaSession) {
    loadRecord.lastLoadedContentUrl = resolvedMedia.contentUrl;
    loadRecord.lastLoadedSelectionSignature = resolvedMedia.selectionSignature;
    loadRecord.lastFailedSelectionSignature = null;
    loadRecord.lastFailureReason = null;
    loadRecord.lastMirroredPlaybackVersion = null;
    loadRecord.activeMediaSession = existingMediaSession.mediaSession;
    updateChromecastRuntimeState({
      mediaLoadStatus: "already_loaded",
      mediaLoadSucceeded: true,
      mediaLoadBlocked: false,
      mediaLoadLikelyFailureReason: null,
      activeMediaSessionConfirmedForCurrentSession: true,
      activeControllableMediaSession: true,
      activeMediaSessionContentId:
        existingMediaSession.mediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      activeMediaSessionSelectionSignature:
        extractSelectionSignatureFromMediaSession(existingMediaSession.mediaSession) ??
        resolvedMedia.selectionSignature,
      mediaContentId:
        existingMediaSession.mediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      mediaSessionContentId:
        existingMediaSession.mediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      lastCastMediaCommand: "loadMedia:already_loaded",
      lastSuccessfulCastSessionId: sessionIdentity?.id ?? null,
    });
    armCastRemoteStabilization(
      "media_already_loaded",
      playbackSynchronizationConfig.castRemoteObservation.stabilizationWindowMs,
      "cast_leader_stabilizing",
    );
    ensureChromecastRemotePlaybackObservation("media_already_loaded");
    clearCurrentCastSessionError();
    return existingMediaSession.mediaSession;
  }

  if (
    loadRecord.inflightPromise &&
    loadRecord.inflightSelectionSignature === resolvedMedia.selectionSignature
  ) {
    updateChromecastRuntimeState({
      mediaLoadStatus: "loading",
      mediaLoadSucceeded: false,
      mediaLoadBlocked: false,
      mediaContentId: resolvedMedia.contentUrl,
      activeControllableMediaSession: false,
      lastCastMediaCommand: "loadMedia:await_inflight",
    });
    return loadRecord.inflightPromise;
  }

  if (loadRecord.lastFailedSelectionSignature === resolvedMedia.selectionSignature) {
    updateChromecastRuntimeState({
      mediaLoadStatus: "blocked_after_failure",
      mediaLoadSucceeded: false,
      mediaLoadBlocked: true,
      mediaLoadLikelyFailureReason: loadRecord.lastFailureReason,
      activeMediaSessionConfirmedForCurrentSession: false,
      activeControllableMediaSession: false,
      activeMediaSessionContentId: null,
      activeMediaSessionSelectionSignature: null,
      mediaContentId: resolvedMedia.contentUrl,
      lastCastMediaCommand: "loadMedia:blocked_after_failure",
    });
    return null;
  }

  const inflightPromise = (async () => {
    const { loadRequest, diagnostics } = buildCastLoadRequest(resolvedMedia, playback);
    const mediaResponseDiagnostics = await inspectCastMediaResponseHeaders(
      diagnostics.contentUrl,
    );

    logDebugEvent({
      level: "info",
      category: "cast",
      message: "Loading room media onto Chromecast.",
      source: "cast",
      data: {
        roomMediaId: media.id,
        resolvedMedia,
        loadRequest: diagnostics,
        mediaResponseDiagnostics,
      },
    });

    updateChromecastRuntimeState({
      mediaLoadStatus: "loading",
      mediaLoadSucceeded: false,
      mediaLoadBlocked: false,
      mediaLoadLikelyFailureReason: null,
      mediaContentId: resolvedMedia.contentUrl,
      activeControllableMediaSession: false,
      lastCastMediaCommand: "loadMedia",
      lastRequestedMediaContentId: resolvedMedia.contentUrl,
      lastRequestedSelectionSignature: resolvedMedia.selectionSignature,
      mediaLoadRequest: diagnostics,
      mediaResponseDiagnostics,
      mediaSessionEventObserved: false,
      mediaSessionReturned: false,
      usedExistingMediaSessionForMirror: false,
      reloadedMediaInsteadOfControlling: true,
      initialCastStateAppliedAfterLoad: false,
      playCommandSentAfterLoad: false,
      lastRemotePlaybackCommand: null,
      lastRemoteSeekCommand: null,
      remotePlaybackState: "loading_media",
      lastCastAudioTrackId: resolvedMedia.selectedAudioTrackId,
      lastCastSubtitleTrackId: resolvedMedia.selectedSubtitleTrackId,
      castSubtitleTrackMode: diagnostics.subtitlesIncludedInLoadRequest
        ? "included_in_load_request"
        : "no_text_tracks",
    });

    let loadResult: unknown;

    try {
      loadResult = await currentSession.loadMedia(loadRequest);
    } catch (error) {
      const normalizedError = new ChromecastError(
        "media_load_failed",
        "The Cast session started, but the room media could not be loaded onto the receiver.",
        {
          error,
          loadRequest: diagnostics,
          mediaResponseDiagnostics,
        },
      );
      loadRecord.lastFailedSelectionSignature = resolvedMedia.selectionSignature;
      loadRecord.lastFailureReason = normalizedError.message;
      loadRecord.activeMediaSession = null;
      loadRecord.lastLoadedContentUrl = null;
      loadRecord.lastLoadedSelectionSignature = null;
      loadRecord.lastMirroredPlaybackVersion = null;
      markCurrentCastSessionError("media_load_failed", normalizedError.message, {
        mediaLoadStatus: "load_failed",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: normalizedError.message,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        lastCastMediaCommand: "loadMedia",
      });
      updateChromecastRuntimeState({
        mediaLoadStatus: "load_failed",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: normalizedError.message,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        lastCastMediaCommand: "loadMedia",
        lastError: normalizedError.message,
      });
      throw normalizedError;
    }

    const summarizedLoadResult = summarizeCastLoadResult(loadResult);
    const loadResultErrorCode =
      typeof loadResult === "string" && loadResult.length > 0
        ? loadResult
        : summarizedLoadResult &&
            typeof summarizedLoadResult === "object" &&
            "code" in summarizedLoadResult &&
            typeof summarizedLoadResult.code === "string" &&
            summarizedLoadResult.code.length > 0
          ? summarizedLoadResult.code
          : null;

    updateChromecastRuntimeState({
      mediaLoadResult: summarizedLoadResult,
      mediaLoadResultErrorCode: loadResultErrorCode,
    });

    if (loadResultErrorCode) {
      const loadResultError = new ChromecastError(
        "media_load_failed",
        `The Cast receiver reported ${loadResultErrorCode} while loading the room media.`,
        {
          loadResult,
          loadRequest: diagnostics,
          mediaResponseDiagnostics,
        },
      );
      loadRecord.lastFailedSelectionSignature = resolvedMedia.selectionSignature;
      loadRecord.lastFailureReason = loadResultError.message;
      loadRecord.activeMediaSession = null;
      loadRecord.lastLoadedContentUrl = null;
      loadRecord.lastLoadedSelectionSignature = null;
      loadRecord.lastMirroredPlaybackVersion = null;
      markCurrentCastSessionError("media_load_failed", loadResultError.message, {
        mediaLoadStatus: "load_failed",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: loadResultError.message,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        lastCastMediaCommand: "loadMedia",
      });
      updateChromecastRuntimeState({
        mediaLoadStatus: "load_failed",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: loadResultError.message,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        lastCastMediaCommand: "loadMedia",
        lastError: loadResultError.message,
      });
      throw loadResultError;
    }

    const nextMediaSession = await waitForCastMediaSession(currentSession);

    if (!nextMediaSession) {
      const likelyFailureReason = inferMissingCastMediaSessionReason(
        diagnostics.contentUrl,
        diagnostics.contentType,
        mediaResponseDiagnostics,
      );
      loadRecord.lastFailedSelectionSignature = resolvedMedia.selectionSignature;
      loadRecord.lastFailureReason = likelyFailureReason;
      loadRecord.activeMediaSession = null;
      loadRecord.lastLoadedContentUrl = null;
      loadRecord.lastLoadedSelectionSignature = null;
      loadRecord.lastMirroredPlaybackVersion = null;
      markCurrentCastSessionError("media_load_failed", likelyFailureReason, {
        mediaLoadStatus: "missing_media_session",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: likelyFailureReason,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        mediaContentId: resolvedMedia.contentUrl,
        lastCastMediaCommand: "loadMedia",
      });
      updateChromecastRuntimeState({
        mediaLoadStatus: "missing_media_session",
        mediaLoadSucceeded: false,
        mediaLoadBlocked: true,
        mediaLoadLikelyFailureReason: likelyFailureReason,
        activeMediaSessionConfirmedForCurrentSession: false,
        activeControllableMediaSession: false,
        activeMediaSessionContentId: null,
        activeMediaSessionSelectionSignature: null,
        mediaContentId: resolvedMedia.contentUrl,
        lastCastMediaCommand: "loadMedia",
        lastError:
          "The Cast receiver connected, but it did not create a media session for the room media.",
      });
      throw new ChromecastError(
        "media_load_failed",
        "The Cast receiver connected, but it did not create a media session for the room media.",
        {
          likelyFailureReason,
          loadRequest: diagnostics,
          mediaResponseDiagnostics,
          loadResult: summarizedLoadResult,
        },
      );
    }

    loadRecord.lastLoadedContentUrl = resolvedMedia.contentUrl;
    loadRecord.lastLoadedSelectionSignature = resolvedMedia.selectionSignature;
    loadRecord.lastFailedSelectionSignature = null;
    loadRecord.lastFailureReason = null;
    loadRecord.lastMirroredPlaybackVersion = null;
    loadRecord.activeMediaSession = nextMediaSession;
    clearCurrentCastSessionError();
    updateChromecastRuntimeState({
      mediaLoadStatus: "loaded",
      mediaLoadSucceeded: true,
      mediaLoadBlocked: false,
      mediaLoadLikelyFailureReason: null,
      activeMediaSessionConfirmedForCurrentSession: true,
      activeControllableMediaSession: true,
      activeMediaSessionContentId:
        nextMediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      activeMediaSessionSelectionSignature:
        extractSelectionSignatureFromMediaSession(nextMediaSession) ??
        resolvedMedia.selectionSignature,
      mediaContentId: nextMediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      mediaSessionContentId:
        nextMediaSession.media?.contentId ?? resolvedMedia.contentUrl,
      lastCastMediaCommand: "loadMedia",
      lastError: null,
      lastSuccessfulCastSessionId: sessionIdentity?.id ?? null,
      remotePlaybackState: "loaded_idle",
    });
    armCastRemoteStabilization(
      "media_loaded",
      playbackSynchronizationConfig.castRemoteObservation.stabilizationWindowMs,
      "cast_leader_stabilizing",
    );
    ensureChromecastRemotePlaybackObservation("media_loaded");

    return nextMediaSession;
  })();

  loadRecord.activeMediaSession = null;
  loadRecord.lastMirroredPlaybackVersion = null;
  loadRecord.inflightSelectionSignature = resolvedMedia.selectionSignature;
  loadRecord.inflightPromise = inflightPromise;

  try {
    return await inflightPromise;
  } finally {
    if (loadRecord.inflightPromise === inflightPromise) {
      loadRecord.inflightPromise = null;
      loadRecord.inflightSelectionSignature = null;
    }
  }
}

export async function loadGoogleCastSdk() {
  if (typeof window === "undefined") {
    throw new ChromecastError(
      "sdk_unavailable",
      "Google Cast can only be initialized in the browser.",
    );
  }

  const environment = detectCastEnvironment();
  updateChromecastRuntimeState({
    browserName: environment.browserName,
    supportedBrowser: environment.isSupportedBrowser,
    secureContext: environment.isSecureContext,
  });

  if (!environment.isSupportedBrowser) {
    throw new ChromecastError(
      "unsupported_browser",
      buildUnsupportedBrowserMessage(environment.browserName),
      environment,
    );
  }

  if (!environment.isSecureContext) {
    throw new ChromecastError(
      "insecure_context",
      buildInsecureContextMessage(),
      environment,
    );
  }

  if (hasCastApis()) {
    updateChromecastRuntimeState({
      sdkLoaded: true,
      sdkStatus: "ready",
      initialized: castContextConfigured,
      lastError: null,
    });
    return;
  }

  if (castSdkPromise) {
    return castSdkPromise;
  }

  updateChromecastRuntimeState({
    sdkLoaded: false,
    sdkStatus: "loading",
    initialized: false,
    lastError: null,
  });

  castSdkPromise = new Promise<void>((resolve, reject) => {
    const castWindow = getCastSdkWindow();
    const previousAvailabilityHandler = castWindow.__onGCastApiAvailable;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    const rejectWith = (error: ChromecastError) => {
      settle(() => {
        castSdkPromise = null;
        updateChromecastRuntimeState({
          sdkLoaded: error.code !== "sdk_load_failed",
          sdkStatus: error.code,
          initialized: false,
          lastError: error.message,
        });
        reject(error);
      });
    };

    const verifySdkAvailability = (reason: string) => {
      updateChromecastRuntimeState({
        sdkLoaded: true,
        sdkStatus: "waiting_for_sender_apis",
        sdkReadyReason: reason,
        initialized: false,
      });

      void waitForCastApis()
        .then(() => {
          settle(() => {
            updateChromecastRuntimeState({
              sdkLoaded: true,
              sdkStatus: "ready",
              initialized: false,
              lastError: null,
            });
            resolve();
          });
        })
        .catch((error) => {
          rejectWith(normalizeChromecastError(error));
        });
    };

    castWindow.__onGCastApiAvailable = (available: boolean, errorInfo?: unknown) => {
      previousAvailabilityHandler?.(available, errorInfo);
      logDebugEvent({
        level: available ? "info" : "warn",
        category: "cast",
        message: available
          ? "The Google Cast SDK reported that sender APIs are available."
          : "The Google Cast SDK loaded, but sender APIs are not immediately available.",
        source: "system",
        data: { errorInfo },
      });
      verifySdkAvailability(
        available ? "__onGCastApiAvailable:true" : "__onGCastApiAvailable:false",
      );
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${castSdkUrl}"]`,
    );

    if (existingScript) {
      verifySdkAvailability("existing-script");
      return;
    }

    const script = document.createElement("script");
    script.src = castSdkUrl;
    script.async = true;
    script.onerror = () => {
      rejectWith(
        new ChromecastError(
          "sdk_load_failed",
          "The Google Cast Web Sender SDK script could not be loaded.",
        ),
      );
    };
    script.onload = () => {
      verifySdkAvailability("script-onload");
    };
    document.head.appendChild(script);
  });

  return castSdkPromise;
}

export async function ensureGoogleCastContextConfigured() {
  await loadGoogleCastSdk();

  const castWindow = getCastSdkWindow();
  const castContext = castWindow.cast?.framework?.CastContext.getInstance();
  const chromeCastMedia = castWindow.chrome?.cast?.media;
  const autoJoinPolicy =
    castWindow.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED ??
    castWindow.cast?.framework?.AutoJoinPolicy?.ORIGIN_SCOPED;

  if (!castContext || !chromeCastMedia) {
    throw new ChromecastError(
      "context_init_failed",
      "Google Cast sender context could not be initialized in this browser session.",
    );
  }

  if (!castContextConfigured) {
    castContext.setOptions({
      receiverApplicationId: chromeCastMedia.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy,
    });
    castContextConfigured = true;
    logDebugEvent({
      level: "info",
      category: "cast",
      message: "Configured Google Cast context for the Default Media Receiver.",
      source: "system",
    });
  }

  updateChromecastRuntimeState({
    sdkLoaded: true,
    sdkStatus: "ready",
    contextConfigured: true,
    initialized: true,
    castState: castContext.getCastState(),
    receiverApplicationId: chromeCastMedia.DEFAULT_MEDIA_RECEIVER_APP_ID,
  });

  return castContext;
}

export async function requestChromecastSession() {
  logDebugEvent({
    level: "info",
    category: "cast",
    message: "Requesting a Chromecast session from the browser.",
    source: "local_user",
  });

  const castContext = await ensureGoogleCastContextConfigured();
  resetCurrentCastSessionRuntimeState(null, {
    lastCastMediaCommand: "requestSession",
    castStatus: "connecting",
    castIssue: "Waiting for the Cast session to finish connecting.",
    castIssueCode: "connecting",
    canRequestSession: false,
  });
  updateChromecastRuntimeState({
    lastCastMediaCommand: "requestSession",
    mediaLoadStatus: "waiting_for_session",
    mediaLoadSucceeded: false,
    mediaLoadBlocked: false,
    mediaLoadLikelyFailureReason: null,
    mediaSessionEventObserved: false,
    mediaSessionReturned: false,
    receiverApplicationId: getCurrentCastReceiverApplicationId(),
  });

  try {
    await castContext.requestSession();
  } catch (error) {
    throw new ChromecastError(
      "session_request_failed",
      buildSessionStartFailedMessage(),
      error,
    );
  }
}

export async function prepareChromecastMediaForSession(
  roomId: string,
  media: RoomMediaSummary | null,
  selectedAudioTrackId: string | null,
  selectedSubtitleTrackId: string | null,
) {
  if (!media) {
    throw new ChromecastError(
      "media_resolve_failed",
      "There is no room media available to prepare for Chromecast.",
    );
  }

  return resolveCastMediaPayload(
    roomId,
    media,
    selectedAudioTrackId,
    selectedSubtitleTrackId,
  );
}

export async function endChromecastSession() {
  logDebugEvent({
    level: "info",
    category: "cast",
    message: "Ending the current Chromecast session.",
    source: "local_user",
  });

  const castContext = await ensureGoogleCastContextConfigured();
  const currentSession = getCurrentCastSession();

  if (currentSession) {
    castSessionLoadRecords.delete(currentSession as object);
  }

  stopChromecastRemotePlaybackObservation("session_ending");

  resetCurrentCastSessionRuntimeState(null, {
    lastCastMediaCommand: "endSession",
    mediaLoadStatus: "session_ending",
    mediaLoadBlocked: false,
  });

  try {
    castContext.endCurrentSession(true);
  } catch (error) {
    throw new ChromecastError(
      "session_end_failed",
      "The Cast session could not be ended cleanly.",
      error,
    );
  }
}

export async function syncChromecastSubtitleSelection(
  media: RoomMediaSummary | null,
  selectedSubtitleTrackId: string | null,
) {
  updateChromecastRuntimeState({
    castSubtitleTrackMode: media ? "reload_required_for_subtitle_change" : "idle",
    lastCastSubtitleTrackId: selectedSubtitleTrackId,
  });
}

export async function syncRoomPlaybackToChromecast(
  roomId: string,
  media: RoomMediaSummary | null,
  playback: PlaybackStateSnapshot,
  selectedAudioTrackId: string | null,
  selectedSubtitleTrackId: string | null,
) {
  if (!media) {
    return;
  }

  const currentSession = getCurrentCastSession();
  const loadRecord = currentSession ? getCastSessionLoadRecord(currentSession) : null;
  let resolvedMedia: CastResolvedMediaSuccessPayload | null = null;
  let hadUsableMediaSession = false;
  let mediaSession: CastMediaSession | null = null;
  let resolverBlockedExistingMediaSession = false;

  try {
    resolvedMedia = await resolveCastMediaPayload(
      roomId,
      media,
      selectedAudioTrackId,
      selectedSubtitleTrackId,
    );
    const existingMediaSession = currentSession
      ? resolveUsableCastMediaSession(resolvedMedia, loadRecord)
      : { mediaSession: null, source: "none" as const };

    hadUsableMediaSession = Boolean(existingMediaSession.mediaSession);
    mediaSession = await ensureRoomMediaLoadedOnChromecast(
      media,
      playback,
      resolvedMedia,
    );

    if (!mediaSession) {
      return;
    }

    if (!canMirrorChromecastPlayback(resolvedMedia, mediaSession, loadRecord)) {
      updateChromecastRuntimeState({
        activeControllableMediaSession: false,
        lastCastMirrorDecision: "skipped_not_ready",
      });
      return;
    }
  } catch (error) {
    const fallbackMediaSession =
      getCurrentCastMediaSession() ?? loadRecord?.activeMediaSession ?? null;
    const canContinueWithCurrentMedia =
      castRuntimeSnapshot.castStatus === "connected" &&
      castRuntimeSnapshot.currentCastSessionErrorCode == null &&
      castRuntimeSnapshot.activeMediaSessionConfirmedForCurrentSession === true &&
      fallbackMediaSession != null;

    if (!canContinueWithCurrentMedia) {
      throw error;
    }

    resolverBlockedExistingMediaSession = true;
    hadUsableMediaSession = true;
    mediaSession = fallbackMediaSession;
    updateChromecastRuntimeState({
      activeControllableMediaSession: true,
      usedExistingMediaSessionForMirror: true,
      reloadedMediaInsteadOfControlling: false,
      lastCastMirrorDecision: "used_existing_media_session_after_resolver_block",
    });
  }

  if (!mediaSession) {
    return;
  }

  rememberMirroredCastPlayback(
    playback,
    resolverBlockedExistingMediaSession
      ? "resolver_blocked_existing_media_session"
      : hadUsableMediaSession
        ? "existing_media_session"
        : "media_loaded_for_sync",
  );

  if (
    loadRecord &&
    hadUsableMediaSession &&
    (resolverBlockedExistingMediaSession ||
      (resolvedMedia != null &&
        loadRecord.lastLoadedContentUrl === resolvedMedia.contentUrl &&
        loadRecord.lastLoadedSelectionSignature ===
          resolvedMedia.selectionSignature)) &&
    loadRecord.lastMirroredPlaybackVersion === playback.version
  ) {
    updateChromecastRuntimeState({
      activeControllableMediaSession: true,
      usedExistingMediaSessionForMirror: true,
      reloadedMediaInsteadOfControlling: false,
      lastCastMirrorDecision: resolverBlockedExistingMediaSession
        ? "skipped_duplicate_playback_version_after_resolver_block"
        : "skipped_duplicate_playback_version",
    });
    return;
  }

  const chromeCastMedia = getCastSdkWindow().chrome?.cast?.media;

  if (!chromeCastMedia) {
    return;
  }

  const initialCastStateAppliedAfterLoad = !hadUsableMediaSession;
  const usedExistingMediaSessionForMirror = hadUsableMediaSession;
  const reloadedMediaInsteadOfControlling = !hadUsableMediaSession;
  const sessionAlreadyAppliedInitialState =
    castRuntimeSnapshot.initialCastStateAppliedAfterLoad === true;
  const sessionAlreadySentPlayAfterLoad =
    castRuntimeSnapshot.playCommandSentAfterLoad === true;
  let lastRemotePlaybackCommand: "play" | "pause" | "stop" | null = null;
  let lastRemoteSeekCommand: number | null = null;
  let lastCastMirrorDecision = resolverBlockedExistingMediaSession
    ? "used_existing_media_session_after_resolver_block"
    : hadUsableMediaSession
      ? "used_existing_media_session"
      : "applying_initial_state_after_load";
  let remotePlaybackState = "loaded_idle";

  if (playback.status === "stopped") {
    if (hadUsableMediaSession) {
      await castCommandAsPromise((resolve, reject) => {
        mediaSession.stop(new chromeCastMedia.StopRequest(), resolve, reject);
      });
      rememberLocalCastCommand({
        type: "stop",
        status: "stopped",
        currentTime: 0,
        playbackRate: playback.playbackRate,
        selectionSignature: resolvedMedia?.selectionSignature ?? null,
      });
      lastRemotePlaybackCommand = "stop";
      lastCastMirrorDecision = "mirrored_stop";
      remotePlaybackState = "stopped";
    }

    updateChromecastRuntimeState({
      mediaContentId:
        mediaSession.media?.contentId ?? resolvedMedia?.contentUrl ?? null,
      lastCastMediaCommand: lastRemotePlaybackCommand ?? "loadMedia",
      lastCastMirrorDecision,
      mediaLoadStatus: resolverBlockedExistingMediaSession
        ? "blocked_using_existing_media"
        : "loaded",
      mediaLoadSucceeded: true,
      mediaLoadBlocked: resolverBlockedExistingMediaSession,
      mediaLoadLikelyFailureReason: resolverBlockedExistingMediaSession
        ? castRuntimeSnapshot.mediaLoadLikelyFailureReason ?? null
        : null,
      activeControllableMediaSession: true,
      initialCastStateAppliedAfterLoad:
        sessionAlreadyAppliedInitialState || initialCastStateAppliedAfterLoad,
      playCommandSentAfterLoad: sessionAlreadySentPlayAfterLoad,
      lastRemotePlaybackCommand,
      lastRemoteSeekCommand,
      usedExistingMediaSessionForMirror,
      reloadedMediaInsteadOfControlling,
      remotePlaybackState,
    });
    armCastRemoteStabilization("mirrored_stop");
    if (loadRecord) {
      loadRecord.lastMirroredPlaybackVersion = playback.version;
    }
    logDebugEvent({
      level: "info",
      category: "cast",
      message: resolverBlockedExistingMediaSession
        ? "Kept mirroring shared playback on the existing Chromecast media because the requested Cast variant could not be prepared."
        : hadUsableMediaSession
        ? "Mirrored the shared stop command to Chromecast."
        : "Cast media loaded and kept idle at the room start position.",
      source: "cast_local_command",
      data: {
        currentTime: 0,
        initialCastStateAppliedAfterLoad,
        selectedAudioTrackId,
        selectedSubtitleTrackId,
      },
    });
    return;
  }

  const playbackShouldBeRunningNow = isPlaybackActivelyRunning(playback);
  const scheduledPlaybackStartDelayMs = resolvePlaybackStartDelayMs(playback);
  const nextCurrentTime = resolveSynchronizedPlaybackTime(playback);
  const currentEstimatedTime = mediaSession.getEstimatedTime?.() ?? 0;

  if (Math.abs(currentEstimatedTime - nextCurrentTime) > 0.75) {
    const seekRequest = new chromeCastMedia.SeekRequest();
    seekRequest.currentTime = nextCurrentTime;

    await castCommandAsPromise((resolve, reject) => {
      mediaSession.seek(seekRequest, resolve, reject);
    });
    rememberLocalCastCommand({
      type: "seek",
      status: playback.status,
      currentTime: nextCurrentTime,
      playbackRate: playback.playbackRate,
      selectionSignature: resolvedMedia?.selectionSignature ?? null,
    });
    lastRemoteSeekCommand = nextCurrentTime;
    lastCastMirrorDecision = hadUsableMediaSession
      ? "mirrored_seek"
      : "applied_initial_seek_after_load";
  }

  if (playback.status === "playing" && playbackShouldBeRunningNow) {
    await castCommandAsPromise((resolve, reject) => {
      mediaSession.play(new chromeCastMedia.PlayRequest(), resolve, reject);
    });
    rememberLocalCastCommand({
      type: "play",
      status: "playing",
      currentTime: nextCurrentTime,
      playbackRate: playback.playbackRate,
      selectionSignature: resolvedMedia?.selectionSignature ?? null,
    });
    lastRemotePlaybackCommand = "play";
    lastCastMirrorDecision = hadUsableMediaSession
      ? "mirrored_play"
      : "applied_initial_play_after_load";
    remotePlaybackState = "playing";
  } else {
    await castCommandAsPromise((resolve, reject) => {
      mediaSession.pause(new chromeCastMedia.PauseRequest(), resolve, reject);
    });
    rememberLocalCastCommand({
      type: "pause",
      status: "paused",
      currentTime: nextCurrentTime,
      playbackRate: playback.playbackRate,
      selectionSignature: resolvedMedia?.selectionSignature ?? null,
    });
    lastRemotePlaybackCommand = "pause";
    lastCastMirrorDecision = playbackShouldBeRunningNow
      ? hadUsableMediaSession
        ? "mirrored_pause"
        : "applied_initial_pause_after_load"
      : hadUsableMediaSession
        ? "prepared_scheduled_play"
        : "prepared_initial_scheduled_play_after_load";
    remotePlaybackState = playbackShouldBeRunningNow ? "paused" : "scheduled";
  }

  updateChromecastRuntimeState({
    mediaContentId:
      mediaSession.media?.contentId ?? resolvedMedia?.contentUrl ?? null,
    lastCastMediaCommand:
      lastRemotePlaybackCommand ?? (lastRemoteSeekCommand != null ? "seek" : "loadMedia"),
    lastCastSeekTime: lastRemoteSeekCommand,
    authoritativeAnchorMediaTime: playback.anchorMediaTime,
    authoritativeAnchorWallClockMs: playback.anchorWallClockMs,
    scheduledPlaybackStartDelayMs,
    lastCastMirrorDecision,
    mediaLoadStatus: resolverBlockedExistingMediaSession
      ? "blocked_using_existing_media"
      : "loaded",
    mediaLoadSucceeded: true,
    mediaLoadBlocked: resolverBlockedExistingMediaSession,
    mediaLoadLikelyFailureReason: resolverBlockedExistingMediaSession
      ? castRuntimeSnapshot.mediaLoadLikelyFailureReason ?? null
      : null,
    activeControllableMediaSession: true,
    initialCastStateAppliedAfterLoad:
      sessionAlreadyAppliedInitialState || initialCastStateAppliedAfterLoad,
    playCommandSentAfterLoad:
      sessionAlreadySentPlayAfterLoad ||
      (initialCastStateAppliedAfterLoad && lastRemotePlaybackCommand === "play"),
    lastRemotePlaybackCommand,
    lastRemoteSeekCommand,
    usedExistingMediaSessionForMirror,
    reloadedMediaInsteadOfControlling,
    remotePlaybackState,
  });
  if (lastRemoteSeekCommand != null || lastRemotePlaybackCommand != null) {
    armCastRemoteStabilization(lastCastMirrorDecision);
  }

  if (loadRecord) {
    loadRecord.lastMirroredPlaybackVersion = playback.version;
  }

  logDebugEvent({
    level: "info",
    category: "cast",
    message: resolverBlockedExistingMediaSession
      ? `Kept the existing Chromecast media in sync while the requested ${selectedAudioTrackId ? "audio" : "media"} selection stayed blocked.`
      : initialCastStateAppliedAfterLoad
        ? playbackShouldBeRunningNow
          ? `Applied the initial shared ${playback.status} state to Chromecast after media load.`
          : "Prepared Chromecast at the shared start position and paused until the authoritative room start time."
        : playbackShouldBeRunningNow
          ? `Mirrored shared ${playback.status} playback to Chromecast.`
          : "Prepared Chromecast for a scheduled shared room start.",
    source: "cast_local_command",
    data: {
      status: playback.status,
      currentTime: nextCurrentTime,
      playbackRate: playback.playbackRate,
      playbackShouldBeRunningNow,
      scheduledPlaybackStartDelayMs,
      selectedAudioTrackId,
      selectedSubtitleTrackId,
      initialCastStateAppliedAfterLoad,
      usedExistingMediaSessionForMirror,
      lastRemotePlaybackCommand,
      lastRemoteSeekCommand,
    },
  });
}

export function useChromecastAvailability() {
  const [castStatus, setCastStatus] =
    useState<ChromecastAvailabilityStatus>("loading");
  const [castIssue, setCastIssue] = useState<string | null>(
    "Checking Cast support for this browser session.",
  );
  const [castIssueCode, setCastIssueCode] = useState<string | null>("checking");
  const [canRequestSession, setCanRequestSession] = useState(false);

  useEffect(() => {
    let isActive = true;
    let removeListeners: (() => void) | null = null;
    let removeRuntimeListener: (() => void) | null = null;
    const environment = detectCastEnvironment();

    const applyPresentationState = (snapshot = castRuntimeSnapshot) => {
      if (!isActive) {
        return;
      }

      const castState =
        typeof snapshot.castState === "string" ? snapshot.castState : undefined;
      const nextPresentation = buildChromecastPresentationState(
        snapshot,
        castState,
      );

      setCastStatus(nextPresentation.status);
      setCastIssue(nextPresentation.issue);
      setCastIssueCode(nextPresentation.issueCode);
      setCanRequestSession(nextPresentation.canRequestSession);
    };

        const syncCastContextState = (
          castContext: CastContextInstance,
          sessionEvent?: CastSessionEvent,
        ) => {
          const currentSession = castContext.getCurrentSession();
          const sessionIdentity = reconcileCurrentCastSessionScope(currentSession);
          if (currentSession) {
            ensureChromecastRemotePlaybackObservation("cast_context_state");
          } else {
            stopChromecastRemotePlaybackObservation("cast_context_state:no_session");
          }
          const castState = castContext.getCastState();
          const nextState = buildChromecastPresentationState(
            castRuntimeSnapshot,
            castState,
      );

      updateChromecastRuntimeState({
        browserName: environment.browserName,
        supportedBrowser: environment.isSupportedBrowser,
        secureContext: environment.isSecureContext,
        castStatus: nextState.status,
        castIssue: nextState.issue,
        castIssueCode: nextState.issueCode,
        canRequestSession: nextState.canRequestSession,
        castState,
        sessionState: sessionEvent?.sessionState ?? null,
        sessionErrorCode: sessionEvent?.errorCode ?? null,
        currentCastSessionId: sessionIdentity?.id ?? null,
        currentCastSessionStartedAt: sessionIdentity?.startedAt ?? null,
        mediaContentId: getCurrentCastMediaSession()?.media?.contentId ?? null,
      });
    };

    updateChromecastRuntimeState({
      browserName: environment.browserName,
      supportedBrowser: environment.isSupportedBrowser,
      secureContext: environment.isSecureContext,
      castStatus: "loading",
      castIssue: "Checking Cast support for this browser session.",
      castIssueCode: "checking",
      sdkStatus: "loading",
      canRequestSession: false,
    });

    void ensureGoogleCastContextConfigured()
      .then((castContext) => {
        if (!isActive) {
          return;
        }

        removeRuntimeListener = subscribeToChromecastRuntime((snapshot) => {
          applyPresentationState(snapshot);
        });

        const castFramework = getCastSdkWindow().cast?.framework;

        if (!castFramework) {
          const message = buildSdkUnavailableMessage();
          setCastStatus("unavailable");
          setCastIssue(message);
          setCastIssueCode("sdk_unavailable");
          setCanRequestSession(false);
          updateChromecastRuntimeState({
            castStatus: "unavailable",
            castIssue: message,
            castIssueCode: "sdk_unavailable",
            canRequestSession: false,
          });
          return;
        }

        const handleCastStateChange = () => {
          if (!isActive) {
            return;
          }

          syncCastContextState(castContext);
        };

        const handleSessionEvent = (event: unknown) => {
          if (!isActive) {
            return;
          }

          const normalizedEvent =
            event && typeof event === "object"
              ? (event as CastSessionEvent)
              : undefined;

          if (normalizedEvent?.sessionState?.includes("FAILED")) {
            const message = buildSessionStartFailedMessage();
            stopChromecastRemotePlaybackObservation("session_failed");
            markCurrentCastSessionError("session_request_failed", message, {
              sessionState: normalizedEvent.sessionState,
              sessionErrorCode: normalizedEvent.errorCode ?? null,
            });
            updateChromecastRuntimeState({
              castStatus: "error",
              castIssue: message,
              castIssueCode: "session_request_failed",
              canRequestSession: true,
              sessionState: normalizedEvent.sessionState,
              sessionErrorCode: normalizedEvent.errorCode ?? null,
            });
          } else {
            if (
              normalizedEvent?.sessionState === "SESSION_STARTED" ||
              normalizedEvent?.sessionState === "SESSION_RESUMED"
            ) {
              armCastRemoteStabilization(
                normalizedEvent.sessionState.toLowerCase(),
                playbackSynchronizationConfig.castRemoteObservation
                  .stabilizationWindowMs,
                "cast_handoff",
              );
            }
            if (
              normalizedEvent?.sessionState === "SESSION_ENDED" ||
              normalizedEvent?.sessionState === "SESSION_RESUMED"
            ) {
              reconcileCurrentCastSessionScope(castContext.getCurrentSession());
            }
            if (normalizedEvent?.sessionState === "SESSION_ENDED") {
              stopChromecastRemotePlaybackObservation("session_ended");
            }
            syncCastContextState(castContext, normalizedEvent);
          }

          logDebugEvent({
            level: normalizedEvent?.sessionState?.includes("FAILED")
              ? "error"
              : "info",
            category: "cast",
            message: "Observed a Chromecast session lifecycle event.",
            source: "system",
            data: normalizedEvent,
          });
        };

        handleCastStateChange();
        applyPresentationState();

        castContext.addEventListener(
          castFramework.CastContextEventType.CAST_STATE_CHANGED,
          handleCastStateChange,
        );
        castContext.addEventListener(
          castFramework.CastContextEventType.SESSION_STATE_CHANGED,
          handleSessionEvent,
        );

        removeListeners = () => {
          castContext.removeEventListener(
            castFramework.CastContextEventType.CAST_STATE_CHANGED,
            handleCastStateChange,
          );
          castContext.removeEventListener(
            castFramework.CastContextEventType.SESSION_STATE_CHANGED,
            handleSessionEvent,
          );
        };
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        const normalizedError = normalizeChromecastError(error);
        const nextStatus =
          normalizedError.code === "unsupported_browser" ||
          normalizedError.code === "insecure_context" ||
          normalizedError.code === "sdk_unavailable"
            ? "unavailable"
            : "error";

        setCastStatus(nextStatus);
        setCastIssue(normalizedError.message);
        setCastIssueCode(normalizedError.code);
        setCanRequestSession(false);
        updateChromecastRuntimeState({
          castStatus: nextStatus,
          castIssue: normalizedError.message,
          castIssueCode: normalizedError.code,
          sdkStatus: normalizedError.code,
          lastError: normalizedError.message,
          canRequestSession: false,
        });
        logDebugEvent({
          level: nextStatus === "error" ? "error" : "warn",
          category: "cast",
          message: normalizedError.message,
          source: "system",
          data: normalizedError.details,
        });
      });

    return () => {
      isActive = false;
      removeListeners?.();
      removeRuntimeListener?.();
      stopChromecastRemotePlaybackObservation("availability_hook_cleanup");
    };
  }, []);

  async function startSession() {
    try {
      updateChromecastRuntimeState({
        castStatus: "connecting",
        castIssue: "Waiting for the Cast session to finish connecting.",
        castIssueCode: "connecting",
        canRequestSession: false,
      });
      await requestChromecastSession();
    } catch (error) {
      const normalizedError = normalizeChromecastError(error);
      const nextStatus =
        normalizedError.code === "unsupported_browser" ||
        normalizedError.code === "insecure_context" ||
        normalizedError.code === "sdk_unavailable"
          ? "unavailable"
          : "error";
      const allowRetry = normalizedError.code === "session_request_failed";

      updateChromecastRuntimeState({
        castStatus: nextStatus,
        castIssue: normalizedError.message,
        castIssueCode: normalizedError.code,
        canRequestSession: allowRetry,
        lastError: normalizedError.message,
      });
      logDebugEvent({
        level: "error",
        category: "cast",
        message: normalizedError.message,
        source: "system",
        data: normalizedError.details,
      });
    }
  }

  async function stopSession() {
    try {
      await endChromecastSession();
    } catch (error) {
      const normalizedError = normalizeChromecastError(error);
      updateChromecastRuntimeState({
        castStatus: "error",
        castIssue: normalizedError.message,
        castIssueCode: normalizedError.code,
        canRequestSession: false,
        lastError: normalizedError.message,
      });
      logDebugEvent({
        level: "error",
        category: "cast",
        message: normalizedError.message,
        source: "system",
        data: normalizedError.details,
      });
    }
  }

  return {
    castStatus,
    castIssue,
    castIssueCode,
    canRequestSession,
    isCastActive: castStatus === "connected",
    requestChromecastSession: startSession,
    endChromecastSession: stopSession,
  };
}
