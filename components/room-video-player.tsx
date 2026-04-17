"use client";

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createSafeId } from "@/lib/create-safe-id";
import { logDebugEvent } from "@/lib/debug-store";
import {
  isPlayableAudioTrackSupport,
  type AudioTrackPlaybackSupport,
} from "@/lib/audio-track-playback";
import {
  calculateDriftMilliseconds,
  createEmptyRawInput,
} from "@/lib/remote-diagnostics";
import {
  assessPlaybackProgressStall,
  clampPlaybackRate,
  createInitialPlaybackState,
  getPlaybackReconciliationProfile,
  hasMeaningfulPlaybackProgress,
  isPlaybackActivelyRunning,
  playbackSynchronizationConfig,
  resolveLocalPlaybackSyncMode,
  resolvePlaybackDriftCorrection,
  resolvePlaybackStartDelayMs,
  resolveSynchronizedPlaybackTime,
  updatePlaybackSuppressionState,
  isPlaybackSuppressionActive,
  type LocalPlaybackSyncMode,
  type PlaybackLeadershipMode,
  type PlaybackReconciliationProfileKey,
  type PlaybackSuppressionCause,
  type PlaybackSuppressionState,
} from "@/lib/playback";
import {
  logRemoteDiagnosticsEvent,
  recordRemoteDiagnosticsPipSnapshot,
  recordRemoteDiagnosticsPlayerSnapshot,
} from "@/lib/remote-diagnostics-store";
import { useDebugRuntimeState } from "@/components/debug-runtime";
import type { PlaybackStateSnapshot, PlaybackStatus } from "@/types/playback";
import type {
  RoomAudioTrackSummary,
  RoomSubtitleTrackSummary,
} from "@/types/room-sync";

export type RoomVideoPlayerSnapshot = {
  currentTime: number;
  videoCurrentTime: number;
  audibleCurrentTime: number | null;
  duration: number | null;
  avDriftSeconds: number | null;
  primaryClockSource: "video" | "external_audio";
  syncMode: LocalPlaybackSyncMode;
  playbackRate: number;
  status: PlaybackStatus;
};

export type RoomVideoPlayerLocalAudioState = {
  selectedSource: "embedded" | "external";
  selectedAudioTrackId: string | null;
  activeSource: "embedded" | "external" | "none";
  activeTrackId: string | null;
  intendedAudibleSource: "embedded" | "external" | "none";
  embeddedAudioActive: boolean;
  externalAudioActive: boolean;
  externalAudioAttached: boolean;
  externalAudioSynchronized: boolean;
  suppressLocalAudioOutput: boolean;
  videoMuted: boolean;
  externalAudioMuted: boolean;
  issue: string | null;
};

export type RoomVideoPlayerHandle = {
  getSnapshot(): RoomVideoPlayerSnapshot;
  play(): Promise<RoomVideoPlayerSnapshot>;
  pause(): RoomVideoPlayerSnapshot;
  stop(): RoomVideoPlayerSnapshot;
  seekTo(targetSeconds: number): RoomVideoPlayerSnapshot;
  seekBy(deltaSeconds: number): RoomVideoPlayerSnapshot;
  applySharedPlayback(
    playback: PlaybackStateSnapshot,
  ): Promise<RoomVideoPlayerSnapshot>;
};

type RoomVideoPlayerProps = {
  title: string;
  roomId: string;
  videoUrl: string | null;
  leadershipMode: PlaybackLeadershipMode;
  reconciliationProfileKey: PlaybackReconciliationProfileKey;
  audioTracks: RoomAudioTrackSummary[];
  audioTrackSupport: Record<string, AudioTrackPlaybackSupport>;
  selectedAudioTrackId: string | null;
  subtitleTracks: RoomSubtitleTrackSummary[];
  selectedSubtitleTrackId: string | null;
  playbackRate: number;
  suppressLocalAudioOutput?: boolean;
  onAudioStateChange(snapshot: RoomVideoPlayerLocalAudioState): void;
  onObservedStateChange(snapshot: RoomVideoPlayerSnapshot): void;
  onSyncIssueChange(message: string | null): void;
  className?: string;
};

type RoomCorrectionDiagnostics = {
  driftSeconds: number;
  expectedTime: number;
  actualTime: number;
  kind: "none" | "smooth" | "hard_seek";
  targetPlaybackRate: number;
  targetTime: number | null;
} | null;

type MediaElementState = {
  currentSrc: string;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  readyState: number;
  networkState: number;
  playbackRate: number;
};

type ExternalAudioElementState = MediaElementState & {
  syncDeltaSeconds: number | null;
  isSynchronized: boolean;
};

type RecoveryEventStormState = {
  burstCount: number;
  burstStartedAtMs: number;
  lastEventAtMs: number;
  lastEventType: string | null;
  lastTargetTime: number | null;
};

function roundTargetTime(targetTime: number | null | undefined) {
  return typeof targetTime === "number" && Number.isFinite(targetTime)
    ? Math.round(targetTime * 1000) / 1000
    : null;
}

function resolvePlaybackStatus(video: HTMLVideoElement): PlaybackStatus {
  if (!video.paused) {
    return "playing";
  }

  if (video.currentTime === 0 || video.ended) {
    return "stopped";
  }

  return "paused";
}

function normalizeSeekTarget(video: HTMLVideoElement, deltaSeconds: number) {
  const nextTime = video.currentTime + deltaSeconds;
  const duration = Number.isFinite(video.duration) ? video.duration : nextTime;
  return Math.max(0, Math.min(nextTime, duration));
}

function isExternalAudioClockHealthy(
  externalAudio: HTMLAudioElement | null,
  externalAudioIsActive: boolean,
  externalAudioIssue: string | null,
) {
  return (
    externalAudioIsActive &&
    Boolean(externalAudio?.currentSrc) &&
    (externalAudio?.readyState ?? 0) >= 2 &&
    externalAudioIssue == null
  );
}

function resolvePrimaryClockSource(input: {
  externalAudio: HTMLAudioElement | null;
  externalAudioIsActive: boolean;
  externalAudioIssue: string | null;
}) {
  return isExternalAudioClockHealthy(
    input.externalAudio,
    input.externalAudioIsActive,
    input.externalAudioIssue,
  )
    ? ("external_audio" as const)
    : ("video" as const);
}

function buildSnapshot(
  video: HTMLVideoElement | null,
  externalAudio: HTMLAudioElement | null,
  externalAudioIsActive: boolean,
  externalAudioIssue: string | null,
  fallbackPlaybackRate: number,
): RoomVideoPlayerSnapshot {
  const syncMode = resolveLocalPlaybackSyncMode({
    hasExternalAudio: externalAudioIsActive,
    suppressLocalAudioOutput: false,
  });

  if (!video) {
    return {
      currentTime: 0,
      videoCurrentTime: 0,
      audibleCurrentTime: null,
      duration: null,
      avDriftSeconds: null,
      primaryClockSource: "video",
      syncMode,
      playbackRate: fallbackPlaybackRate,
      status: "stopped",
    };
  }

  const videoCurrentTime = video.currentTime;
  const audibleCurrentTime =
    externalAudioIsActive && externalAudio?.currentSrc
      ? externalAudio.currentTime
      : null;
  const duration = Number.isFinite(video.duration) ? video.duration : null;
  const primaryClockSource = resolvePrimaryClockSource({
    externalAudio,
    externalAudioIsActive,
    externalAudioIssue,
  });
  const avDriftSeconds =
    audibleCurrentTime === null
      ? null
      : Number(Math.abs(audibleCurrentTime - videoCurrentTime).toFixed(3));

  return {
    currentTime:
      primaryClockSource === "external_audio" && audibleCurrentTime != null
        ? audibleCurrentTime
        : videoCurrentTime,
    videoCurrentTime,
    audibleCurrentTime,
    duration,
    avDriftSeconds,
    primaryClockSource,
    syncMode,
    playbackRate: video.playbackRate,
    status: resolvePlaybackStatus(video),
  };
}

function resolveReferenceCurrentTime(
  video: HTMLVideoElement | null,
  externalAudio: HTMLAudioElement | null,
  externalAudioIsActive: boolean,
  externalAudioIssue: string | null,
) {
  if (
    resolvePrimaryClockSource({
      externalAudio,
      externalAudioIsActive,
      externalAudioIssue,
    }) === "external_audio" &&
    externalAudio
  ) {
    return externalAudio.currentTime;
  }

  return video?.currentTime ?? 0;
}

function applyActiveSubtitleTrackToVideo(
  video: HTMLVideoElement | null,
  renderableSubtitleTracks: RoomSubtitleTrackSummary[],
  trackId: string | null,
) {
  if (!video) {
    return;
  }

  Array.from(video.textTracks).forEach((textTrack, index) => {
    const matchingTrack = renderableSubtitleTracks[index];

    textTrack.mode =
      matchingTrack && matchingTrack.id === trackId ? "showing" : "disabled";
  });
}

function buildMediaElementState(
  element: HTMLMediaElement | null,
): MediaElementState | null {
  if (!element) {
    return null;
  }

  return {
    currentSrc: element.currentSrc,
    currentTime: element.currentTime,
    paused: element.paused,
    muted: element.muted,
    readyState: element.readyState,
    networkState: element.networkState,
    playbackRate: element.playbackRate,
  };
}

function areMediaElementStatesEqual(
  left: MediaElementState | null,
  right: MediaElementState | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.currentSrc === right.currentSrc &&
    left.currentTime === right.currentTime &&
    left.paused === right.paused &&
    left.muted === right.muted &&
    left.readyState === right.readyState &&
    left.networkState === right.networkState &&
    left.playbackRate === right.playbackRate
  );
}

function areExternalAudioElementStatesEqual(
  left: ExternalAudioElementState | null,
  right: ExternalAudioElementState | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    areMediaElementStatesEqual(left, right) &&
    left.syncDeltaSeconds === right.syncDeltaSeconds &&
    left.isSynchronized === right.isSynchronized
  );
}

function areRoomCorrectionDiagnosticsEqual(
  left: RoomCorrectionDiagnostics,
  right: RoomCorrectionDiagnostics,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.kind === right.kind &&
    left.driftSeconds === right.driftSeconds &&
    left.expectedTime === right.expectedTime &&
    left.actualTime === right.actualTime &&
    left.targetPlaybackRate === right.targetPlaybackRate &&
    left.targetTime === right.targetTime
  );
}

export const RoomVideoPlayer = forwardRef<
  RoomVideoPlayerHandle,
  RoomVideoPlayerProps
>(function RoomVideoPlayer(
  {
    title,
    roomId,
    videoUrl,
    leadershipMode,
    reconciliationProfileKey,
    audioTracks,
    audioTrackSupport,
    selectedAudioTrackId,
    subtitleTracks,
    selectedSubtitleTrackId,
    playbackRate,
    suppressLocalAudioOutput = false,
    onAudioStateChange,
    onObservedStateChange,
    onSyncIssueChange,
    className,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const externalAudioRef = useRef<HTMLAudioElement>(null);
  const lastExternalAudioCorrectionAtRef = useRef(0);
  const lastLoggedCorrectionSignatureRef = useRef<string | null>(null);
  const lastHardSeekSuppressionLogAtRef = useRef(0);
  const lastIgnoredSuppressionRenewalLogAtRef = useRef(0);
  const lastStallRecoveryLogAtRef = useRef(0);
  const lastRoomHardSeekAtRef = useRef<number | null>(null);
  const lastStallRecoveryAtRef = useRef<number | null>(null);
  const audioRecoveryStormStateRef = useRef<RecoveryEventStormState | null>(null);
  const playbackProgressSampleRef = useRef<{
    currentTime: number;
    observedAtMs: number;
  } | null>(null);
  const requestedExternalAudioUrlRef = useRef<string | null>(null);
  const scheduledSharedStartTimerRef = useRef<number | null>(null);
  const suppressionStateRef = useRef<PlaybackSuppressionState | null>(null);
  const authoritativePlaybackRef = useRef<PlaybackStateSnapshot>(
    createInitialPlaybackState(),
  );
  const [lastMediaEvent, setLastMediaEvent] = useState("idle");
  const [lastAudioEvent, setLastAudioEvent] = useState("idle");
  const [videoElementState, setVideoElementState] =
    useState<MediaElementState | null>(null);
  const [externalAudioElementState, setExternalAudioElementState] =
    useState<ExternalAudioElementState | null>(null);
  const [externalAudioIssue, setExternalAudioIssue] = useState<string | null>(null);
  const [suppressionDiagnostics, setSuppressionDiagnostics] =
    useState<PlaybackSuppressionState | null>(null);
  const [authoritativePlaybackDiagnostics, setAuthoritativePlaybackDiagnostics] =
    useState<PlaybackStateSnapshot>(() => createInitialPlaybackState());
  const [roomCorrectionDiagnostics, setRoomCorrectionDiagnostics] =
    useState<RoomCorrectionDiagnostics>(null);
  const [lastStallRecoveryAt, setLastStallRecoveryAt] = useState<number | null>(
    null,
  );
  const renderableSubtitleTracks = subtitleTracks.filter(
    (track) => track.isRenderable && Boolean(track.url),
  );
  const selectedExternalAudioTrack =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ?? null;
  const selectedExternalAudioTrackPlayable = Boolean(
    selectedExternalAudioTrack &&
      isPlayableAudioTrackSupport(
        audioTrackSupport[selectedExternalAudioTrack.id],
      ),
  );
  const activeExternalAudioTrack = selectedExternalAudioTrackPlayable
    ? selectedExternalAudioTrack
    : null;
  const localSyncMode = resolveLocalPlaybackSyncMode({
    hasExternalAudio: Boolean(activeExternalAudioTrack),
    suppressLocalAudioOutput,
  });
  const currentPrimaryClockSource =
    localSyncMode === "external_audio_mode" &&
    Boolean(externalAudioElementState?.currentSrc) &&
    (externalAudioElementState?.readyState ?? 0) >= 2 &&
    externalAudioIssue == null
      ? "external_audio"
      : "video";
  const reconciliationProfile = getPlaybackReconciliationProfile(
    reconciliationProfileKey,
  );

  const emitObservedStateChange = useEffectEvent(() => {
    onObservedStateChange(
      buildSnapshot(
        videoRef.current,
        externalAudioRef.current,
        Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
        externalAudioIssue,
        playbackRate,
      ),
    );
  });

  const emitSyncIssue = useEffectEvent((message: string | null) => {
    onSyncIssueChange(message);
  });

  const publishRemotePlayerSnapshot = useEffectEvent(
    (playerKind: "local-web" | "pip", notes: string, extra?: Record<string, unknown>) => {
      const snapshot = buildSnapshot(
        videoRef.current,
        externalAudioRef.current,
        Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
        externalAudioIssue,
        playbackRate,
      );
      const video = videoRef.current;

      recordRemoteDiagnosticsPlayerSnapshot({
        recordedAtMs: Date.now(),
        playerKind,
        currentTimeSec: snapshot.currentTime,
        durationSec: snapshot.duration,
        status: snapshot.status,
        playbackRate: snapshot.playbackRate,
        paused: snapshot.status !== "playing",
        buffering: video ? video.readyState < 3 : null,
        seeking: video?.seeking ?? null,
        primaryClockSource: snapshot.primaryClockSource,
        extra: {
          audibleCurrentTimeSec: snapshot.audibleCurrentTime,
          avDriftSeconds: snapshot.avDriftSeconds,
          notes,
          syncMode: snapshot.syncMode,
          videoCurrentTimeSec: snapshot.videoCurrentTime,
          ...extra,
        },
      });

      return snapshot;
    },
  );

  const logPlayerDiagnosticsEvent = useEffectEvent(
    (input: {
      action: "play" | "pause" | "seek_to" | "pip_enter" | "pip_exit" | "state_sync" | "custom";
      notes: string;
      reason?: string | null;
      stage?: "received" | "applied" | "rendered" | "ack";
      status?: "observed" | "applied" | "rendered" | "warning";
      source?: "player" | "pip";
    }) => {
      const snapshot = buildSnapshot(
        videoRef.current,
        externalAudioRef.current,
        Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
        externalAudioIssue,
        playbackRate,
      );
      const video = videoRef.current;

      logRemoteDiagnosticsEvent({
        eventId: createSafeId("player"),
        parentEventId: null,
        source: input.source ?? "player",
        action: input.action,
        rawInput: createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage: input.stage ?? "rendered",
        sequenceNumber: authoritativePlaybackRef.current.version,
        roomVersion: authoritativePlaybackRef.current.version,
        stateVersion: authoritativePlaybackRef.current.version,
        playbackStateVersion: authoritativePlaybackRef.current.version,
        currentTimeSec: snapshot.currentTime,
        durationSec: snapshot.duration,
        paused: snapshot.status !== "playing",
        playbackRate: snapshot.playbackRate,
        buffering: video ? video.readyState < 3 : null,
        seeking: video?.seeking ?? null,
        module: "components/room-video-player",
        functionName: "logPlayerDiagnosticsEvent",
        notes: input.notes,
        reason: input.reason ?? null,
        status: input.status ?? "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: {
          audibleCurrentTimeSec: snapshot.audibleCurrentTime,
          avDriftSeconds: snapshot.avDriftSeconds,
          primaryClockSource: snapshot.primaryClockSource,
          syncMode: snapshot.syncMode,
          videoCurrentTimeSec: snapshot.videoCurrentTime,
        },
      });
    },
  );

  const publishPipSnapshot = useEffectEvent((eventType: string, notes?: string | null) => {
    const video = videoRef.current;
    const supported =
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document;
    const active =
      Boolean(video) &&
      typeof document !== "undefined" &&
      document.pictureInPictureElement === video;
    const mainSnapshot = buildSnapshot(
      video,
      externalAudioRef.current,
      Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
      externalAudioIssue,
      playbackRate,
    );
    const authoritativePlayback = authoritativePlaybackRef.current;
    const authoritativeRoomTimeSec = resolveSynchronizedPlaybackTime(
      authoritativePlayback,
    );
    const pipCurrentTimeSec = active ? mainSnapshot.currentTime : null;
    const pipStatus = active ? mainSnapshot.status : null;
    const followingCanonicalState =
      active && pipCurrentTimeSec != null
        ? Math.abs(
            (calculateDriftMilliseconds(
              pipCurrentTimeSec,
              authoritativeRoomTimeSec,
            ) ?? 0) / 1000,
          ) <= 0.35 && mainSnapshot.status === authoritativePlayback.status
        : null;

    recordRemoteDiagnosticsPipSnapshot({
      recordedAtMs: Date.now(),
      supported,
      active,
      mode: supported ? "video-element" : "unavailable",
      pipCurrentTimeSec,
      mainPlayerCurrentTimeSec: mainSnapshot.currentTime,
      authoritativeRoomTimeSec,
      pipMinusRoomMs: calculateDriftMilliseconds(
        pipCurrentTimeSec,
        authoritativeRoomTimeSec,
      ),
      pipMinusMainMs: calculateDriftMilliseconds(
        pipCurrentTimeSec,
        mainSnapshot.currentTime,
      ),
      pipStatus,
      mainStatus: mainSnapshot.status,
      authoritativeStatus: authoritativePlayback.status,
      followingCanonicalState,
      lastCommandEventId: null,
      lastCommandAction: null,
      lastCommandReceivedAtMs: null,
      notes: notes ?? eventType,
    });

    if (active) {
      publishRemotePlayerSnapshot("pip", eventType, {
        pipEventType: eventType,
      });
    }
  });

  const clearScheduledSharedStart = useEffectEvent(() => {
    if (scheduledSharedStartTimerRef.current != null) {
      window.clearTimeout(scheduledSharedStartTimerRef.current);
      scheduledSharedStartTimerRef.current = null;
    }
  });

  const applyPlaybackRateToMedia = useEffectEvent((nextPlaybackRate: number) => {
    const normalizedPlaybackRate = Math.max(0.25, Math.min(nextPlaybackRate, 3));
    const video = videoRef.current;
    const audio = externalAudioRef.current;

    if (video && video.playbackRate !== normalizedPlaybackRate) {
      video.playbackRate = normalizedPlaybackRate;
    }

    if (audio && audio.playbackRate !== normalizedPlaybackRate) {
      audio.playbackRate = normalizedPlaybackRate;
    }
  });

  const resetAudioRecoveryStormState = useEffectEvent((reason: string) => {
    if (!audioRecoveryStormStateRef.current) {
      return;
    }

    audioRecoveryStormStateRef.current = null;
    logDebugEvent({
      level: "info",
      category: "sync",
      message: "Cleared the external-audio recovery event burst tracker.",
      source: "reconciliation",
      data: { reason },
    });
  });

  const clearPlaybackSuppression = useEffectEvent((reason: string) => {
    const activeSuppression = suppressionStateRef.current;

    if (!activeSuppression) {
      return;
    }

    suppressionStateRef.current = null;
    setSuppressionDiagnostics(null);
    resetAudioRecoveryStormState(reason);
    logDebugEvent({
      level: "info",
      category: "sync",
      message: "Ended a local reconciliation suppression cycle.",
      source: "reconciliation",
      data: {
        reason,
        cause: activeSuppression.cause,
        generation: activeSuppression.generation,
      },
    });
  });

  const armRoomHardSeekSuppression = useEffectEvent(
    (
      durationMs: number,
      cause: PlaybackSuppressionCause,
      targetTime?: number | null,
    ) => {
      const nowMs = Date.now();
      const result = updatePlaybackSuppressionState({
        cause,
        durationMs,
        nowMs,
        previous: suppressionStateRef.current,
        targetTime,
      });

      suppressionStateRef.current = result.nextState;
      setSuppressionDiagnostics(result.nextState);

      if (result.action === "ignored_equivalent") {
        if (nowMs - lastIgnoredSuppressionRenewalLogAtRef.current >= 1000) {
          lastIgnoredSuppressionRenewalLogAtRef.current = nowMs;
          logDebugEvent({
            level: "info",
            category: "sync",
            message:
              "Skipped extending the local reconciliation suppression window because the media event did not represent a meaningfully new reposition.",
            source: "reconciliation",
            data: {
              cause,
              targetTime,
              suppressionGeneration: result.nextState.generation,
            },
          });
        }
        return;
      }

      if (nowMs - lastHardSeekSuppressionLogAtRef.current >= 750) {
        lastHardSeekSuppressionLogAtRef.current = nowMs;
        logDebugEvent({
          level: "info",
          category: "sync",
          message:
            result.action === "started"
              ? "Started a local reconciliation suppression cycle after a seek/recovery event."
              : "Renewed a local reconciliation suppression cycle because a new reposition occurred.",
          source: "reconciliation",
          data: {
            cause,
            targetTime,
            suppressionGeneration: result.nextState.generation,
            suppressUntil: new Date(result.nextState.suppressUntilMs).toISOString(),
          },
        });
      }
    },
  );

  const updateVideoElementState = useEffectEvent(() => {
    const nextState = buildMediaElementState(videoRef.current);

    setVideoElementState((previousState) =>
      areMediaElementStatesEqual(previousState, nextState)
        ? previousState
        : nextState,
    );
  });

  const updateExternalAudioElementState = useEffectEvent(() => {
    const audio = externalAudioRef.current;
    const video = videoRef.current;

    if (!audio) {
      setExternalAudioElementState((previousState) =>
        previousState === null ? previousState : null,
      );
      return;
    }

    const baseState = buildMediaElementState(audio);

    if (!baseState) {
      setExternalAudioElementState((previousState) =>
        previousState === null ? previousState : null,
      );
      return;
    }

    const syncDeltaSeconds = video
      ? Number(Math.abs(audio.currentTime - video.currentTime).toFixed(3))
      : null;
    const nextState: ExternalAudioElementState = {
      ...baseState,
      syncDeltaSeconds,
      isSynchronized:
        Boolean(activeExternalAudioTrack) &&
        syncDeltaSeconds !== null &&
        syncDeltaSeconds <=
          playbackSynchronizationConfig.localMediaSyncThresholdSeconds &&
        audio.playbackRate === (video?.playbackRate ?? audio.playbackRate) &&
        audio.paused === (video?.paused ?? audio.paused),
    };

    setExternalAudioElementState((previousState) =>
      areExternalAudioElementStatesEqual(previousState, nextState)
        ? previousState
        : nextState,
    );
  });

  const resetPlaybackProgressSample = useEffectEvent((currentTime: number) => {
    playbackProgressSampleRef.current = {
      currentTime,
      observedAtMs: Date.now(),
    };
  });

  const shouldSuppressEquivalentAudioRecoveryEvent = useEffectEvent(
    (eventType: string, targetTime: number | null) => {
      const nowMs = Date.now();
      const normalizedTargetTime = roundTargetTime(targetTime);
      const previousStorm = audioRecoveryStormStateRef.current;

      if (
        !previousStorm ||
        nowMs - previousStorm.lastEventAtMs >
          playbackSynchronizationConfig.localMediaRecoveryEventStormWindowMs
      ) {
        audioRecoveryStormStateRef.current = {
          burstCount: 1,
          burstStartedAtMs: nowMs,
          lastEventAtMs: nowMs,
          lastEventType: eventType,
          lastTargetTime: normalizedTargetTime,
        };
        return false;
      }

      const equivalentTarget =
        previousStorm.lastTargetTime == null || normalizedTargetTime == null
          ? true
          : Math.abs(previousStorm.lastTargetTime - normalizedTargetTime) <
            playbackSynchronizationConfig.suppression
              .minimumMeaningfulTargetDeltaSeconds;
      const equivalentEvent =
        equivalentTarget && previousStorm.lastEventType === eventType;
      const nextStormState: RecoveryEventStormState = {
        burstCount:
          equivalentTarget || equivalentEvent
            ? previousStorm.burstCount + 1
            : 1,
        burstStartedAtMs:
          equivalentTarget || equivalentEvent
            ? previousStorm.burstStartedAtMs
            : nowMs,
        lastEventAtMs: nowMs,
        lastEventType: eventType,
        lastTargetTime: normalizedTargetTime,
      };

      audioRecoveryStormStateRef.current = nextStormState;

      if (
        (equivalentTarget || equivalentEvent) &&
        nextStormState.burstCount >=
          playbackSynchronizationConfig.localMediaRecoveryEventStormThreshold
      ) {
        logDebugEvent({
          level: "info",
          category: "sync",
          message:
            "Suppressed an equivalent external-audio recovery trigger because the same target was already producing a recovery event burst.",
          source: "reconciliation",
          data: {
            burstCount: nextStormState.burstCount,
            eventType,
            targetTime: normalizedTargetTime,
          },
        });
        return true;
      }

      return false;
    },
  );

  const emitLocalAudioStateChange = useEffectEvent(() => {
    const video = videoRef.current;
    const audio = externalAudioRef.current;
    const externalAudioAttached = Boolean(audio?.currentSrc);
    const shouldUseExternalAudio = Boolean(activeExternalAudioTrack);
    const intendedAudibleSource =
      suppressLocalAudioOutput || !videoUrl
        ? "none"
        : shouldUseExternalAudio
          ? "external"
          : "embedded";

    onAudioStateChange({
      selectedSource: selectedAudioTrackId ? "external" : "embedded",
      selectedAudioTrackId,
      activeSource: videoUrl
        ? shouldUseExternalAudio
          ? "external"
          : "embedded"
        : "none",
      activeTrackId: activeExternalAudioTrack?.id ?? null,
      intendedAudibleSource,
      embeddedAudioActive: Boolean(videoUrl) && !shouldUseExternalAudio,
      externalAudioActive: shouldUseExternalAudio && externalAudioAttached,
      externalAudioAttached,
      externalAudioSynchronized:
        externalAudioElementState?.isSynchronized ?? false,
      suppressLocalAudioOutput,
      videoMuted: video?.muted ?? false,
      externalAudioMuted: audio?.muted ?? true,
      issue: externalAudioIssue,
    });
  });

  const publishMediaDiagnostics = useEffectEvent(() => {
    updateVideoElementState();
    updateExternalAudioElementState();
    emitLocalAudioStateChange();
  });

  const updateLastMediaEvent = useEffectEvent((eventName: string) => {
    setLastMediaEvent(eventName);
    logDebugEvent({
      level: "info",
      category: "resource",
      message: `Room media event: ${eventName}.`,
      source: "system",
      data: {
        roomId,
        videoUrl,
        selectedAudioTrackId,
        selectedSubtitleTrackId,
      },
    });
  });

  const updateLastAudioEvent = useEffectEvent((eventName: string) => {
    setLastAudioEvent(eventName);
    logDebugEvent({
      level: "info",
      category: "resource",
      message: `Room external audio event: ${eventName}.`,
      source: "system",
      data: {
        roomId,
        selectedAudioTrackId,
      },
    });
  });

  const updateExternalAudioIssue = useEffectEvent((message: string | null) => {
    setExternalAudioIssue((previousIssue) =>
      previousIssue === message ? previousIssue : message,
    );
    emitSyncIssue(message);
  });

  const synchronizeExternalAudioWithVideo = useEffectEvent(
    async (options?: {
      attemptPlayback?: boolean;
      forceSeek?: boolean;
      allowDriftCorrection?: boolean;
      publishDiagnostics?: boolean;
      targetTime?: number | null;
    }) => {
      const video = videoRef.current;
      const audio = externalAudioRef.current;
      const shouldUseExternalAudio = Boolean(activeExternalAudioTrack);
      const shouldMuteVideo = suppressLocalAudioOutput || shouldUseExternalAudio;
      const shouldMuteExternalAudio =
        suppressLocalAudioOutput || !shouldUseExternalAudio;

      if (video && video.muted !== shouldMuteVideo) {
        video.muted = shouldMuteVideo;
      }

      if (!audio) {
        if (options?.publishDiagnostics !== false) {
          publishMediaDiagnostics();
        }
        return;
      }

      if (!video || !shouldUseExternalAudio) {
        requestedExternalAudioUrlRef.current = null;

        if (!audio.paused) {
          audio.pause();
        }

        if (audio.muted !== true) {
          audio.muted = true;
        }

        if (audio.getAttribute("src")) {
          audio.removeAttribute("src");
          audio.load();
        }

        updateExternalAudioIssue(null);

        if (options?.publishDiagnostics !== false) {
          publishMediaDiagnostics();
        }
        return;
      }

      const externalTrack = activeExternalAudioTrack;

      if (!externalTrack) {
        if (options?.publishDiagnostics !== false) {
          publishMediaDiagnostics();
        }
        return;
      }

      const nextExternalAudioUrl = new URL(
        externalTrack.url,
        window.location.origin,
      ).toString();
      const shouldLoadNewTrack =
        requestedExternalAudioUrlRef.current !== nextExternalAudioUrl;

      if (shouldLoadNewTrack) {
        requestedExternalAudioUrlRef.current = nextExternalAudioUrl;
        audio.src = externalTrack.url;
        audio.load();
      }

      if (audio.muted !== shouldMuteExternalAudio) {
        audio.muted = shouldMuteExternalAudio;
      }

      applyPlaybackRateToMedia(
        authoritativePlaybackRef.current.playbackRate || video.playbackRate,
      );

      const avDriftSeconds = audio.currentTime - video.currentTime;
      const absoluteAvDriftSeconds = Math.abs(avDriftSeconds);
      const suppressionActive = isPlaybackSuppressionActive(
        suppressionStateRef.current,
      );
      const driftCorrectionThreshold = suppressionActive
        ? playbackSynchronizationConfig.localMediaAggressiveCorrectionThresholdSeconds
        : playbackSynchronizationConfig.localMediaCorrectionThresholdSeconds;
      const externalAudioMode = localSyncMode === "external_audio_mode";
      const shouldCorrectForDrift =
        !shouldLoadNewTrack &&
        !audio.seeking &&
        !video.seeking &&
        options?.allowDriftCorrection !== false &&
        absoluteAvDriftSeconds > driftCorrectionThreshold &&
        Date.now() - lastExternalAudioCorrectionAtRef.current >=
          playbackSynchronizationConfig.localMediaCorrectionThrottleMs;
      const targetTime =
        roundTargetTime(options?.targetTime) ??
        roundTargetTime(
          externalAudioMode ? audio.currentTime : video.currentTime,
        ) ??
        0;

      if (shouldLoadNewTrack || options?.forceSeek) {
        try {
          if (externalAudioMode) {
            audio.currentTime = targetTime;
            video.currentTime = targetTime;
          } else {
            audio.currentTime = targetTime;
          }
          lastExternalAudioCorrectionAtRef.current = Date.now();
        } catch {
          // Ignore early seek failures while metadata is still loading.
        }
      } else if (shouldCorrectForDrift) {
        try {
          if (
            externalAudioMode &&
            absoluteAvDriftSeconds >
              playbackSynchronizationConfig
                .externalAudioModeVideoHardAlignThresholdSeconds
          ) {
            video.currentTime = audio.currentTime;
            resetPlaybackProgressSample(audio.currentTime);
          } else if (
            externalAudioMode &&
            absoluteAvDriftSeconds >
              playbackSynchronizationConfig
                .externalAudioModeVideoFollowThresholdSeconds
          ) {
            video.playbackRate = clampPlaybackRate(
              audio.playbackRate + (avDriftSeconds > 0 ? 0.02 : -0.02),
            );
          } else if (externalAudioMode && video.playbackRate !== audio.playbackRate) {
            video.playbackRate = audio.playbackRate;
          } else if (!externalAudioMode) {
            video.currentTime = audio.currentTime;
            resetPlaybackProgressSample(audio.currentTime);
          }
          lastExternalAudioCorrectionAtRef.current = Date.now();
        } catch {
          // Ignore early correction failures while metadata is still loading.
        }
      } else if (externalAudioMode && video.playbackRate !== audio.playbackRate) {
        video.playbackRate = audio.playbackRate;
      }

      if (video.paused) {
        if (!audio.paused) {
          audio.pause();
        }
      } else if (options?.attemptPlayback && audio.paused && !audio.muted) {
        try {
          await audio.play();
          updateExternalAudioIssue(null);
        } catch {
          updateExternalAudioIssue(
            "The selected external audio track is active, but this browser still needs a local interaction before it can play it.",
          );
        }
      } else {
        updateExternalAudioIssue(null);
      }

      if (options?.publishDiagnostics !== false) {
        publishMediaDiagnostics();
      }
    },
  );

  const repositionMediaToAuthoritativeTarget = useEffectEvent(
    async (input: {
      targetTime: number;
      attemptPlayback?: boolean;
      forcePlaybackRestart?: boolean;
      publishDiagnostics?: boolean;
    }) => {
      const video = videoRef.current;
      const audio = externalAudioRef.current;
      const externalAudioMode =
        localSyncMode === "external_audio_mode" &&
        Boolean(activeExternalAudioTrack) &&
        !suppressLocalAudioOutput &&
        Boolean(audio);

      if (!video) {
        return;
      }

      const normalizedTargetTime = roundTargetTime(input.targetTime) ?? 0;

      if (externalAudioMode && audio) {
        if (input.forcePlaybackRestart) {
          if (!audio.paused) {
            audio.pause();
          }
          if (!video.paused) {
            video.pause();
          }
        }

        try {
          audio.currentTime = normalizedTargetTime;
        } catch {
          // Ignore early seek failures while metadata is still loading.
        }

        try {
          video.currentTime = normalizedTargetTime;
        } catch {
          // Ignore early seek failures while metadata is still loading.
        }

        resetPlaybackProgressSample(normalizedTargetTime);
        await synchronizeExternalAudioWithVideo({
          attemptPlayback:
            input.forcePlaybackRestart || input.attemptPlayback || !video.paused,
          forceSeek: true,
          publishDiagnostics: input.publishDiagnostics,
          targetTime: normalizedTargetTime,
        });
        return;
      }

      video.currentTime = normalizedTargetTime;
      resetPlaybackProgressSample(normalizedTargetTime);
      await synchronizeExternalAudioWithVideo({
        attemptPlayback: input.attemptPlayback || !video.paused,
        forceSeek: true,
        publishDiagnostics: input.publishDiagnostics,
        targetTime: normalizedTargetTime,
      });
    },
  );

  const startPlayback = useEffectEvent(
    async (options?: { allowMutedFallback?: boolean }) => {
      const video = videoRef.current;
      const targetPlaybackRate =
        authoritativePlaybackRef.current.playbackRate || playbackRate;

      if (!video) {
        return buildSnapshot(null, null, false, null, targetPlaybackRate);
      }

      applyPlaybackRateToMedia(targetPlaybackRate);
      await synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });

      try {
        await video.play();
      } catch (error) {
        if (!options?.allowMutedFallback) {
          throw error;
        }

        const previousMuted = video.muted;
        video.muted = true;

        try {
          await video.play();
          emitSyncIssue(
            "Shared playback started muted on this browser because autoplay with audio was blocked. Interact with the page to restore local audio.",
          );
        } catch {
          video.muted = previousMuted;
          throw error;
        }
      }

      await synchronizeExternalAudioWithVideo({
        attemptPlayback: true,
        forceSeek: true,
        publishDiagnostics: true,
      });
      return buildSnapshot(
        video,
        externalAudioRef.current,
        Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
        externalAudioIssue,
        targetPlaybackRate,
      );
    },
  );

  const updateRoomCorrectionState = useEffectEvent(
    (nextDiagnostics: RoomCorrectionDiagnostics) => {
      setRoomCorrectionDiagnostics((previousDiagnostics) =>
        areRoomCorrectionDiagnosticsEqual(previousDiagnostics, nextDiagnostics)
          ? previousDiagnostics
          : nextDiagnostics,
      );
    },
  );

  const reconcileAuthoritativePlayback = useEffectEvent(async () => {
    const playback = authoritativePlaybackRef.current;
    const video = videoRef.current;
    const audio = externalAudioRef.current;
    const nowMs = Date.now();

    if (!video) {
      return;
    }

    if (playback.status !== "playing") {
      playbackProgressSampleRef.current = null;
      clearPlaybackSuppression("playback_not_running");
      applyPlaybackRateToMedia(playback.playbackRate);
      updateRoomCorrectionState(null);
      return;
    }

    if (!isPlaybackActivelyRunning(playback)) {
      playbackProgressSampleRef.current = null;
      clearPlaybackSuppression("awaiting_scheduled_start");
      applyPlaybackRateToMedia(playback.playbackRate);
      updateRoomCorrectionState({
        kind: "none",
        driftSeconds: 0,
        expectedTime: playback.anchorMediaTime,
        actualTime: resolveReferenceCurrentTime(
          video,
          audio,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
        ),
        targetPlaybackRate: playback.playbackRate,
        targetTime: null,
      });
      return;
    }

    if (video.paused) {
      try {
        await startPlayback({ allowMutedFallback: true });
      } catch {
        return;
      }
    }

    const expectedTime = resolveSynchronizedPlaybackTime(playback);
    const actualTime = resolveReferenceCurrentTime(
      video,
      audio,
      Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
      externalAudioIssue,
    );
    const stallProgress = assessPlaybackProgressStall({
      currentTime: actualTime,
      nowMs,
      previousSample: playbackProgressSampleRef.current,
    });
    playbackProgressSampleRef.current = stallProgress.nextSample;

    if (
      suppressionStateRef.current &&
      hasMeaningfulPlaybackProgress(stallProgress.assessment) &&
      !video.seeking &&
      !audio?.seeking
    ) {
      clearPlaybackSuppression("playback_progressed");
    }

    if (stallProgress.assessment.isStalled) {
      const stallRecoveryCoolingDown =
        lastStallRecoveryAtRef.current != null &&
        nowMs - lastStallRecoveryAtRef.current <
          playbackSynchronizationConfig.stallRecoveryCooldownMs;

      if (stallRecoveryCoolingDown) {
        if (nowMs - lastStallRecoveryLogAtRef.current >= 1500) {
          lastStallRecoveryLogAtRef.current = nowMs;
          logDebugEvent({
            level: "info",
            category: "sync",
            message:
              "Detected stalled local playback, but skipped recovery because the last stall recovery is still cooling down.",
            source: "reconciliation",
            data: {
              leadershipMode,
              reconciliationProfileKey,
              stallAssessment: stallProgress.assessment,
            },
          });
        }
      } else {
        lastStallRecoveryAtRef.current = nowMs;
        setLastStallRecoveryAt(nowMs);
        lastRoomHardSeekAtRef.current = nowMs;
        armRoomHardSeekSuppression(
          reconciliationProfile.postSeekHardSeekSuppressionMs,
          "stall_recovery",
          expectedTime,
        );
        await repositionMediaToAuthoritativeTarget({
          attemptPlayback: true,
          forcePlaybackRestart: localSyncMode === "external_audio_mode",
          publishDiagnostics: true,
          targetTime: expectedTime,
        });
        applyPlaybackRateToMedia(playback.playbackRate);
        logDebugEvent({
          level: "warn",
          category: "sync",
          message:
            "Detected stalled local playback progression and performed one controlled recovery from the authoritative room anchor.",
          source: "reconciliation",
          data: {
            leadershipMode,
            reconciliationProfileKey,
            expectedTime,
            actualTime,
            stallAssessment: stallProgress.assessment,
          },
        });
        emitObservedStateChange();
        return;
      }
    }

    const correction = resolvePlaybackDriftCorrection({
      actualTime,
      basePlaybackRate: playback.playbackRate,
      expectedTime,
      lastHardSeekAtMs: lastRoomHardSeekAtRef.current,
      nowMs,
      profile: reconciliationProfile,
      suppressHardSeekUntilMs: suppressionStateRef.current?.suppressUntilMs ?? null,
    });

    updateRoomCorrectionState({
      kind: correction.kind,
      driftSeconds: correction.driftSeconds,
      expectedTime,
      actualTime,
      targetPlaybackRate: correction.targetPlaybackRate,
      targetTime: correction.targetTime,
    });

    if (correction.kind === "hard_seek" && correction.targetTime != null) {
      lastRoomHardSeekAtRef.current = nowMs;
      armRoomHardSeekSuppression(
        reconciliationProfile.postSeekHardSeekSuppressionMs,
        "room_hard_seek",
        correction.targetTime,
      );
      await repositionMediaToAuthoritativeTarget({
        attemptPlayback: true,
        publishDiagnostics: true,
        targetTime: correction.targetTime,
      });
      applyPlaybackRateToMedia(playback.playbackRate);
      {
        const correctionSignature = JSON.stringify({
          kind: correction.kind,
          driftSeconds: correction.driftSeconds,
          targetTime: correction.targetTime,
        });

        if (lastLoggedCorrectionSignatureRef.current !== correctionSignature) {
          lastLoggedCorrectionSignatureRef.current = correctionSignature;
          logDebugEvent({
            level: "info",
            category: "sync",
            message:
              "Applied a hard seek to pull local playback back to the authoritative room anchor.",
            source: "reconciliation",
            data: correction,
          });
        }
      }
      emitObservedStateChange();
      return;
    }

    if (correction.kind === "smooth") {
      applyPlaybackRateToMedia(correction.targetPlaybackRate);
      {
        const direction = correction.targetPlaybackRate > playback.playbackRate
          ? "speed_up"
          : "slow_down";
        const correctionSignature = JSON.stringify({
          kind: correction.kind,
          direction,
        });

        if (lastLoggedCorrectionSignatureRef.current !== correctionSignature) {
          lastLoggedCorrectionSignatureRef.current = correctionSignature;
          logDebugEvent({
            level: "info",
            category: "sync",
            message:
              "Applied a temporary playback-rate correction to smooth local room drift.",
            source: "reconciliation",
            data: correction,
          });
        }
      }
    } else {
      applyPlaybackRateToMedia(playback.playbackRate);
      lastLoggedCorrectionSignatureRef.current = null;
    }

    await synchronizeExternalAudioWithVideo({
      allowDriftCorrection: true,
      publishDiagnostics: false,
    });
  });

  const scheduleSharedPlaybackStart = useEffectEvent(
    (playback: PlaybackStateSnapshot) => {
      clearScheduledSharedStart();

      const playbackStartDelayMs = resolvePlaybackStartDelayMs(playback);

      if (playbackStartDelayMs <= 0) {
        return;
      }

      scheduledSharedStartTimerRef.current = window.setTimeout(() => {
        scheduledSharedStartTimerRef.current = null;
        void startPlayback({ allowMutedFallback: true })
          .then(() => reconcileAuthoritativePlayback())
          .catch(() => {
            emitSyncIssue(
              "This browser received a shared play command, but playback still needs a local interaction before it can start.",
            );
          });
      }, playbackStartDelayMs);
    },
  );

  useDebugRuntimeState("room/player", {
    roomId,
    title,
    videoUrl,
    selectedAudioTrackId,
    selectedSubtitleTrackId,
    suppressLocalAudioOutput,
    activeAudioSource: activeExternalAudioTrack ? "external" : "embedded",
    activeExternalAudioTrackId: activeExternalAudioTrack?.id ?? null,
    intendedAudibleSource:
      suppressLocalAudioOutput || !videoUrl
        ? "none"
        : activeExternalAudioTrack
          ? "external"
          : "embedded",
    audioTrackCount: audioTracks.length,
    audioTrackSupport,
    subtitleTrackCount: subtitleTracks.length,
    renderableSubtitleTrackCount: renderableSubtitleTracks.length,
    authoritativePlayback: authoritativePlaybackDiagnostics,
    authoritativeCurrentTime: resolveSynchronizedPlaybackTime(
      authoritativePlaybackDiagnostics,
    ),
    authoritativePlaybackActive: isPlaybackActivelyRunning(
      authoritativePlaybackDiagnostics,
    ),
    leadershipMode,
    localSyncMode,
    primaryClockSource: currentPrimaryClockSource,
    reconciliationProfileKey,
    reconciliationProfile,
    suppressionState: suppressionDiagnostics,
    stallRecoveryCooldownMs: playbackSynchronizationConfig.stallRecoveryCooldownMs,
    lastStallRecoveryAt,
    roomCorrectionDiagnostics,
    lastMediaEvent,
    lastAudioEvent,
    externalAudioIssue,
    elementState: videoElementState,
    externalAudioElementState,
  });

  useEffect(() => {
    applyPlaybackRateToMedia(playbackRate);

    void synchronizeExternalAudioWithVideo({
      forceSeek: true,
      publishDiagnostics: true,
    });
    emitObservedStateChange();
  }, [
    playbackRate,
    selectedAudioTrackId,
    suppressLocalAudioOutput,
    videoUrl,
    audioTracks,
    audioTrackSupport,
  ]);

  useEffect(() => {
    const nextRenderableSubtitleTracks = subtitleTracks.filter(
      (track) => track.isRenderable && Boolean(track.url),
    );

    applyActiveSubtitleTrackToVideo(
      videoRef.current,
      nextRenderableSubtitleTracks,
      selectedSubtitleTrackId,
    );
    updateLastMediaEvent("subtitle-selection-changed");
    publishMediaDiagnostics();
    emitObservedStateChange();
  }, [selectedSubtitleTrackId, subtitleTracks]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = externalAudioRef.current;

    if (!video || !audio) {
      return;
    }

    const handleTimeUpdate = () => {
      emitObservedStateChange();
      publishRemotePlayerSnapshot("local-web", "video_timeupdate");
      publishPipSnapshot("video_timeupdate");

      if (!video.paused) {
        void synchronizeExternalAudioWithVideo({
          allowDriftCorrection: true,
          publishDiagnostics: false,
        });
      }
    };

    const handlePlay = () => {
      updateLastMediaEvent("play");
      emitObservedStateChange();
      logPlayerDiagnosticsEvent({
        action: "play",
        notes: "video_play_event",
      });
      publishRemotePlayerSnapshot("local-web", "video_play_event");
      publishPipSnapshot("video_play_event");
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: true,
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handlePause = () => {
      updateLastMediaEvent("pause");
      emitObservedStateChange();
      logPlayerDiagnosticsEvent({
        action: "pause",
        notes: "video_pause_event",
      });
      publishRemotePlayerSnapshot("local-web", "video_pause_event");
      publishPipSnapshot("video_pause_event");
      void synchronizeExternalAudioWithVideo({
        publishDiagnostics: true,
      });
      emitSyncIssue(null);
    };

    const handleEnded = () => {
      updateLastMediaEvent("ended");
      emitObservedStateChange();
      logPlayerDiagnosticsEvent({
        action: "pause",
        notes: "video_ended_event",
        reason: "media_ended",
      });
      publishRemotePlayerSnapshot("local-web", "video_ended_event");
      publishPipSnapshot("video_ended_event");
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
      emitSyncIssue(null);
    };

    const handleSeeked = () => {
      updateLastMediaEvent("seeked");
      logPlayerDiagnosticsEvent({
        action: "seek_to",
        notes: "video_seeked_event",
      });
      if (
        localSyncMode === "external_audio_mode" &&
        shouldSuppressEquivalentAudioRecoveryEvent("video_seeked", video.currentTime)
      ) {
        publishMediaDiagnostics();
        emitObservedStateChange();
        return;
      }
      armRoomHardSeekSuppression(
        reconciliationProfile.postSeekHardSeekSuppressionMs,
        "media_recovery",
        video.currentTime,
      );
      emitObservedStateChange();
      publishRemotePlayerSnapshot("local-web", "video_seeked_event");
      publishPipSnapshot("video_seeked_event");
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleSeeking = () => {
      logPlayerDiagnosticsEvent({
        action: "seek_to",
        notes: "video_seeking_event",
        stage: "received",
      });
      publishRemotePlayerSnapshot("local-web", "video_seeking_event", {
        seeking: true,
      });
    };

    const handleLoadedMetadata = () => {
      updateLastMediaEvent("loadedmetadata");
      logPlayerDiagnosticsEvent({
        action: "state_sync",
        notes: "video_loadedmetadata_event",
      });
      if (
        localSyncMode === "external_audio_mode" &&
        shouldSuppressEquivalentAudioRecoveryEvent(
          "video_loadedmetadata",
          video.currentTime,
        )
      ) {
        publishMediaDiagnostics();
        emitObservedStateChange();
        return;
      }
      armRoomHardSeekSuppression(
        reconciliationProfile.postCanPlayHardSeekSuppressionMs,
        "media_recovery",
        video.currentTime,
      );
      emitObservedStateChange();
      publishRemotePlayerSnapshot("local-web", "video_loadedmetadata_event");
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleLoadedData = () => {
      updateLastMediaEvent("loadeddata");
      logPlayerDiagnosticsEvent({
        action: "state_sync",
        notes: "video_loadeddata_event",
      });
      publishRemotePlayerSnapshot("local-web", "video_loadeddata_event");
    };

    const handleRateChange = () => {
      emitObservedStateChange();
      logPlayerDiagnosticsEvent({
        action: "state_sync",
        notes: "video_ratechange_event",
      });
      publishRemotePlayerSnapshot("local-web", "video_ratechange_event");
      publishPipSnapshot("video_ratechange_event");
      void synchronizeExternalAudioWithVideo({
        allowDriftCorrection: true,
        publishDiagnostics: true,
      });
    };

    const handleWaiting = () => {
      updateLastMediaEvent("waiting");
      logPlayerDiagnosticsEvent({
        action: "custom",
        notes: "video_waiting_event",
        reason: "buffering",
        stage: "received",
        status: "warning",
      });
      publishRemotePlayerSnapshot("local-web", "video_waiting_event", {
        buffering: true,
      });
    };

    const handleVideoError = () => {
      updateLastMediaEvent("error");
      logPlayerDiagnosticsEvent({
        action: "custom",
        notes: "video_error_event",
        reason: "video_error",
        status: "warning",
      });
      publishRemotePlayerSnapshot("local-web", "video_error_event");
      publishMediaDiagnostics();
      emitSyncIssue(
        "The shared video could not finish loading in this browser session.",
      );
    };

    const handleAudioLoadedMetadata = () => {
      updateLastAudioEvent("loadedmetadata");
      if (
        shouldSuppressEquivalentAudioRecoveryEvent(
          "audio_loadedmetadata",
          audio.currentTime,
        )
      ) {
        publishMediaDiagnostics();
        return;
      }
      armRoomHardSeekSuppression(
        reconciliationProfile.postCanPlayHardSeekSuppressionMs,
        "media_recovery",
        audio.currentTime,
      );
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: !video.paused,
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleAudioCanPlay = () => {
      updateLastAudioEvent("canplay");
      if (
        shouldSuppressEquivalentAudioRecoveryEvent("audio_canplay", audio.currentTime)
      ) {
        publishMediaDiagnostics();
        return;
      }
      armRoomHardSeekSuppression(
        reconciliationProfile.postCanPlayHardSeekSuppressionMs,
        "media_recovery",
        audio.currentTime,
      );
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: !video.paused,
        allowDriftCorrection: true,
        publishDiagnostics: true,
      });
    };

    const handleAudioPlay = () => {
      updateLastAudioEvent("play");
      publishMediaDiagnostics();
      publishRemotePlayerSnapshot("local-web", "audio_play_event");
    };

    const handleAudioPause = () => {
      updateLastAudioEvent("pause");
      publishMediaDiagnostics();
      publishRemotePlayerSnapshot("local-web", "audio_pause_event");
    };

    const handleAudioSeeked = () => {
      updateLastAudioEvent("seeked");
      if (
        shouldSuppressEquivalentAudioRecoveryEvent("audio_seeked", audio.currentTime)
      ) {
        publishMediaDiagnostics();
        return;
      }
      armRoomHardSeekSuppression(
        reconciliationProfile.postSeekHardSeekSuppressionMs,
        "media_recovery",
        audio.currentTime,
      );
      publishMediaDiagnostics();
    };

    const handleAudioRateChange = () => {
      publishMediaDiagnostics();
      publishRemotePlayerSnapshot("local-web", "audio_ratechange_event");
    };

    const handleAudioError = () => {
      updateLastAudioEvent("error");
      updateExternalAudioIssue(
        "The selected external audio track could not finish loading in this browser session.",
      );
      publishMediaDiagnostics();
      publishRemotePlayerSnapshot("local-web", "audio_error_event");
    };

    const handleEnterPictureInPicture = () => {
      logPlayerDiagnosticsEvent({
        action: "pip_enter",
        notes: "video_enterpictureinpicture_event",
        source: "pip",
      });
      publishPipSnapshot("enterpictureinpicture", "video_enterpictureinpicture_event");
    };

    const handleLeavePictureInPicture = () => {
      logPlayerDiagnosticsEvent({
        action: "pip_exit",
        notes: "video_leavepictureinpicture_event",
        source: "pip",
      });
      publishPipSnapshot("leavepictureinpicture", "video_leavepictureinpicture_event");
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("ratechange", handleRateChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("error", handleVideoError);
    video.addEventListener(
      "enterpictureinpicture",
      handleEnterPictureInPicture as EventListener,
    );
    video.addEventListener(
      "leavepictureinpicture",
      handleLeavePictureInPicture as EventListener,
    );

    audio.addEventListener("loadedmetadata", handleAudioLoadedMetadata);
    audio.addEventListener("canplay", handleAudioCanPlay);
    audio.addEventListener("play", handleAudioPlay);
    audio.addEventListener("pause", handleAudioPause);
    audio.addEventListener("seeked", handleAudioSeeked);
    audio.addEventListener("ratechange", handleAudioRateChange);
    audio.addEventListener("error", handleAudioError);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("ratechange", handleRateChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener(
        "enterpictureinpicture",
        handleEnterPictureInPicture as EventListener,
      );
      video.removeEventListener(
        "leavepictureinpicture",
        handleLeavePictureInPicture as EventListener,
      );

      audio.removeEventListener("loadedmetadata", handleAudioLoadedMetadata);
      audio.removeEventListener("canplay", handleAudioCanPlay);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
      audio.removeEventListener("seeked", handleAudioSeeked);
      audio.removeEventListener("ratechange", handleAudioRateChange);
      audio.removeEventListener("error", handleAudioError);
    };
  }, [localSyncMode, reconciliationProfile]);

  useEffect(() => {
    publishPipSnapshot("player_effect_init", "initial_pip_snapshot");
    const intervalId = window.setInterval(() => {
      publishPipSnapshot("player_poll", "periodic_pip_snapshot");
    }, 1_500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void reconcileAuthoritativePlayback();
    }, playbackSynchronizationConfig.roomReconciliationIntervalMs);

    return () => {
      window.clearInterval(intervalId);
      clearScheduledSharedStart();
    };
  }, []);

  useEffect(() => {
    logDebugEvent({
      level: "info",
      category: "sync",
      message: "Selected the local room reconciliation profile.",
      source: "system",
      data: {
        leadershipMode,
        localSyncMode,
        reconciliationProfileKey,
        reconciliationProfile,
      },
    });
  }, [
    leadershipMode,
    localSyncMode,
    reconciliationProfile,
    reconciliationProfileKey,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot() {
        return buildSnapshot(
          videoRef.current,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playbackRate,
        );
      },
      async play() {
        clearScheduledSharedStart();
        return startPlayback();
      },
      pause() {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, null, playbackRate);
        }

        clearScheduledSharedStart();
        video.pause();
        applyPlaybackRateToMedia(playbackRate);
        void synchronizeExternalAudioWithVideo({
          publishDiagnostics: true,
        });
        emitSyncIssue(null);
        updateRoomCorrectionState(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playbackRate,
        );
      },
      stop() {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, null, playbackRate);
        }

        clearScheduledSharedStart();
        video.pause();
        armRoomHardSeekSuppression(
          reconciliationProfile.postSeekHardSeekSuppressionMs,
          "local_user_seek",
          0,
        );
        void repositionMediaToAuthoritativeTarget({
          publishDiagnostics: true,
          targetTime: 0,
        }).finally(() => {
          applyPlaybackRateToMedia(playbackRate);
        });
        emitSyncIssue(null);
        updateRoomCorrectionState(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playbackRate,
        );
      },
      seekTo(targetSeconds: number) {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, null, playbackRate);
        }

        const normalizedTargetTime = Math.max(0, targetSeconds);
        armRoomHardSeekSuppression(
          reconciliationProfile.postSeekHardSeekSuppressionMs,
          "local_user_seek",
          normalizedTargetTime,
        );
        void repositionMediaToAuthoritativeTarget({
          publishDiagnostics: true,
          targetTime: normalizedTargetTime,
        });
        emitSyncIssue(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playbackRate,
        );
      },
      seekBy(deltaSeconds: number) {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, null, playbackRate);
        }

        const nextTargetTime = normalizeSeekTarget(video, deltaSeconds);
        armRoomHardSeekSuppression(
          reconciliationProfile.postSeekHardSeekSuppressionMs,
          "local_user_seek",
          nextTargetTime,
        );
        void repositionMediaToAuthoritativeTarget({
          publishDiagnostics: true,
          targetTime: nextTargetTime,
        });
        emitSyncIssue(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playbackRate,
        );
      },
      async applySharedPlayback(playback: PlaybackStateSnapshot) {
        const video = videoRef.current;
        authoritativePlaybackRef.current = playback;
        setAuthoritativePlaybackDiagnostics(playback);

        if (!video) {
          return buildSnapshot(null, null, false, null, playback.playbackRate);
        }

        clearScheduledSharedStart();
        const nextCurrentTime =
          playback.status === "stopped"
            ? 0
            : resolveSynchronizedPlaybackTime(playback);
        const pauseConvergenceThresholdSeconds =
          playbackSynchronizationConfig.pauseConvergenceThresholdSeconds;
        const referenceCurrentTime = resolveReferenceCurrentTime(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
        );

        applyPlaybackRateToMedia(playback.playbackRate);

        if (
          playback.status === "stopped" ||
          Math.abs(referenceCurrentTime - nextCurrentTime) >
            pauseConvergenceThresholdSeconds
        ) {
          await repositionMediaToAuthoritativeTarget({
            publishDiagnostics: false,
            targetTime: nextCurrentTime,
          });
          armRoomHardSeekSuppression(
            reconciliationProfile.postSeekHardSeekSuppressionMs,
            "authoritative_reposition",
            nextCurrentTime,
          );
        }

        if (playback.status === "playing") {
          if (!isPlaybackActivelyRunning(playback)) {
            video.pause();
            await synchronizeExternalAudioWithVideo({
              forceSeek: true,
              targetTime: nextCurrentTime,
              publishDiagnostics: true,
            });
            scheduleSharedPlaybackStart(playback);
            emitSyncIssue(null);
            updateRoomCorrectionState({
              kind: "none",
              driftSeconds: 0,
              expectedTime: playback.anchorMediaTime,
              actualTime: nextCurrentTime,
              targetPlaybackRate: playback.playbackRate,
              targetTime: null,
            });
            return buildSnapshot(
              video,
              externalAudioRef.current,
              Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
              externalAudioIssue,
              playback.playbackRate,
            );
          }

          try {
            const snapshotAfterStart = await startPlayback({
              allowMutedFallback: true,
            });
            await reconcileAuthoritativePlayback();
            return snapshotAfterStart;
          } catch {
            emitSyncIssue(
              "This browser received a shared play command, but playback still needs a local interaction before it can start.",
            );
            return buildSnapshot(
              video,
              externalAudioRef.current,
              Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
              externalAudioIssue,
              playback.playbackRate,
            );
          }
        }

        video.pause();
        await synchronizeExternalAudioWithVideo({
          forceSeek: true,
          targetTime: nextCurrentTime,
          publishDiagnostics: true,
        });
        updateRoomCorrectionState(null);
        emitSyncIssue(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          externalAudioIssue,
          playback.playbackRate,
        );
      },
    }),
    [
      activeExternalAudioTrack,
      externalAudioIssue,
      playbackRate,
      reconciliationProfile,
      suppressLocalAudioOutput,
    ],
  );

  return (
    <div className={className ?? "h-full w-full"}>
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            data-debug-video-player="true"
            className="h-full w-full bg-[#020409] object-contain"
          >
            {renderableSubtitleTracks.map((track) => (
              <track
                key={track.id}
                kind="subtitles"
                src={track.url ?? undefined}
                srcLang={track.language === "und" ? "en" : track.language}
                label={track.label}
                default={
                  selectedSubtitleTrackId
                    ? track.id === selectedSubtitleTrackId
                    : track.isDefault
                }
              />
            ))}
          </video>
          <audio
            ref={externalAudioRef}
            preload="metadata"
            data-debug-external-audio-player="true"
            className="hidden"
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(160deg,#090d14,#181f2b)] px-6 text-center text-white">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/50">
              Media unavailable
            </p>
            <p className="mt-3 text-lg font-semibold">
              This room does not have a playable uploaded video yet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
