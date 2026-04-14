"use client";

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { logDebugEvent } from "@/lib/debug-store";
import {
  isPlayableAudioTrackSupport,
  type AudioTrackPlaybackSupport,
} from "@/lib/audio-track-playback";
import {
  createInitialPlaybackState,
  isPlaybackActivelyRunning,
  playbackSynchronizationConfig,
  resolvePlaybackDriftCorrection,
  resolvePlaybackStartDelayMs,
  resolveSynchronizedPlaybackTime,
} from "@/lib/playback";
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
  avDriftSeconds: number | null;
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
  seekBy(deltaSeconds: number): RoomVideoPlayerSnapshot;
  applySharedPlayback(
    playback: PlaybackStateSnapshot,
  ): Promise<RoomVideoPlayerSnapshot>;
};

type RoomVideoPlayerProps = {
  title: string;
  roomId: string;
  videoUrl: string | null;
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

function buildSnapshot(
  video: HTMLVideoElement | null,
  externalAudio: HTMLAudioElement | null,
  externalAudioIsActive: boolean,
  fallbackPlaybackRate: number,
): RoomVideoPlayerSnapshot {
  if (!video) {
    return {
      currentTime: 0,
      videoCurrentTime: 0,
      audibleCurrentTime: null,
      avDriftSeconds: null,
      playbackRate: fallbackPlaybackRate,
      status: "stopped",
    };
  }

  const videoCurrentTime = video.currentTime;
  const audibleCurrentTime =
    externalAudioIsActive && externalAudio?.currentSrc
      ? externalAudio.currentTime
      : null;
  const avDriftSeconds =
    audibleCurrentTime === null
      ? null
      : Number(Math.abs(audibleCurrentTime - videoCurrentTime).toFixed(3));

  return {
    currentTime: audibleCurrentTime ?? videoCurrentTime,
    videoCurrentTime,
    audibleCurrentTime,
    avDriftSeconds,
    playbackRate: video.playbackRate,
    status: resolvePlaybackStatus(video),
  };
}

function resolveReferenceCurrentTime(
  video: HTMLVideoElement | null,
  externalAudio: HTMLAudioElement | null,
  externalAudioIsActive: boolean,
) {
  if (externalAudioIsActive && externalAudio?.currentSrc) {
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
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const externalAudioRef = useRef<HTMLAudioElement>(null);
  const lastExternalAudioCorrectionAtRef = useRef(0);
  const lastLoggedCorrectionSignatureRef = useRef<string | null>(null);
  const requestedExternalAudioUrlRef = useRef<string | null>(null);
  const scheduledSharedStartTimerRef = useRef<number | null>(null);
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
  const [authoritativePlaybackDiagnostics, setAuthoritativePlaybackDiagnostics] =
    useState<PlaybackStateSnapshot>(() => createInitialPlaybackState());
  const [roomCorrectionDiagnostics, setRoomCorrectionDiagnostics] =
    useState<RoomCorrectionDiagnostics>(null);
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

  const emitObservedStateChange = useEffectEvent(() => {
    onObservedStateChange(
      buildSnapshot(
        videoRef.current,
        externalAudioRef.current,
        Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
        playbackRate,
      ),
    );
  });

  const emitSyncIssue = useEffectEvent((message: string | null) => {
    onSyncIssueChange(message);
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

      applyPlaybackRateToMedia(video.playbackRate);

      const driftSeconds = Math.abs(audio.currentTime - video.currentTime);
      const shouldCorrectForDrift =
        !shouldLoadNewTrack &&
        !audio.seeking &&
        !video.seeking &&
        (options?.forceSeek ||
          (options?.allowDriftCorrection !== false &&
            driftSeconds >
              playbackSynchronizationConfig.localMediaCorrectionThresholdSeconds &&
            Date.now() - lastExternalAudioCorrectionAtRef.current >=
              playbackSynchronizationConfig.localMediaCorrectionThrottleMs));

      if (shouldLoadNewTrack || shouldCorrectForDrift) {
        try {
          if (shouldLoadNewTrack || options?.forceSeek) {
            audio.currentTime = video.currentTime;
          } else {
            video.currentTime = audio.currentTime;
          }
          lastExternalAudioCorrectionAtRef.current = Date.now();
        } catch {
          // Ignore early seek failures while metadata is still loading.
        }
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

  const startPlayback = useEffectEvent(
    async (options?: { allowMutedFallback?: boolean }) => {
      const video = videoRef.current;
      const targetPlaybackRate =
        authoritativePlaybackRef.current.playbackRate || playbackRate;

      if (!video) {
        return buildSnapshot(null, null, false, targetPlaybackRate);
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

    if (!video) {
      return;
    }

    if (playback.status !== "playing") {
      applyPlaybackRateToMedia(playback.playbackRate);
      updateRoomCorrectionState(null);
      return;
    }

    if (!isPlaybackActivelyRunning(playback)) {
      applyPlaybackRateToMedia(playback.playbackRate);
      updateRoomCorrectionState({
        kind: "none",
        driftSeconds: 0,
        expectedTime: playback.anchorMediaTime,
        actualTime: resolveReferenceCurrentTime(
          video,
          audio,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
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
    );
    const correction = resolvePlaybackDriftCorrection({
      actualTime,
      basePlaybackRate: playback.playbackRate,
      expectedTime,
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
      video.currentTime = correction.targetTime;
      await synchronizeExternalAudioWithVideo({
        attemptPlayback: true,
        forceSeek: true,
        publishDiagnostics: true,
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
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: true,
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handlePause = () => {
      updateLastMediaEvent("pause");
      emitObservedStateChange();
      void synchronizeExternalAudioWithVideo({
        publishDiagnostics: true,
      });
      emitSyncIssue(null);
    };

    const handleEnded = () => {
      updateLastMediaEvent("ended");
      emitObservedStateChange();
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
      emitSyncIssue(null);
    };

    const handleSeeked = () => {
      updateLastMediaEvent("seeked");
      emitObservedStateChange();
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleLoadedMetadata = () => {
      updateLastMediaEvent("loadedmetadata");
      emitObservedStateChange();
      void synchronizeExternalAudioWithVideo({
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleRateChange = () => {
      emitObservedStateChange();
      void synchronizeExternalAudioWithVideo({
        allowDriftCorrection: true,
        publishDiagnostics: true,
      });
    };

    const handleVideoError = () => {
      updateLastMediaEvent("error");
      publishMediaDiagnostics();
      emitSyncIssue(
        "The shared video could not finish loading in this browser session.",
      );
    };

    const handleAudioLoadedMetadata = () => {
      updateLastAudioEvent("loadedmetadata");
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: !video.paused,
        forceSeek: true,
        publishDiagnostics: true,
      });
    };

    const handleAudioCanPlay = () => {
      updateLastAudioEvent("canplay");
      void synchronizeExternalAudioWithVideo({
        attemptPlayback: !video.paused,
        allowDriftCorrection: true,
        publishDiagnostics: true,
      });
    };

    const handleAudioPlay = () => {
      updateLastAudioEvent("play");
      publishMediaDiagnostics();
    };

    const handleAudioPause = () => {
      updateLastAudioEvent("pause");
      publishMediaDiagnostics();
    };

    const handleAudioSeeked = () => {
      updateLastAudioEvent("seeked");
      publishMediaDiagnostics();
    };

    const handleAudioRateChange = () => {
      publishMediaDiagnostics();
    };

    const handleAudioError = () => {
      updateLastAudioEvent("error");
      updateExternalAudioIssue(
        "The selected external audio track could not finish loading in this browser session.",
      );
      publishMediaDiagnostics();
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("ratechange", handleRateChange);
    video.addEventListener("error", handleVideoError);

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
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("ratechange", handleRateChange);
      video.removeEventListener("error", handleVideoError);

      audio.removeEventListener("loadedmetadata", handleAudioLoadedMetadata);
      audio.removeEventListener("canplay", handleAudioCanPlay);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
      audio.removeEventListener("seeked", handleAudioSeeked);
      audio.removeEventListener("ratechange", handleAudioRateChange);
      audio.removeEventListener("error", handleAudioError);
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

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot() {
        return buildSnapshot(
          videoRef.current,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
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
          return buildSnapshot(null, null, false, playbackRate);
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
          playbackRate,
        );
      },
      stop() {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, playbackRate);
        }

        clearScheduledSharedStart();
        video.pause();
        video.currentTime = 0;
        applyPlaybackRateToMedia(playbackRate);
        void synchronizeExternalAudioWithVideo({
          forceSeek: true,
          publishDiagnostics: true,
        });
        emitSyncIssue(null);
        updateRoomCorrectionState(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          playbackRate,
        );
      },
      seekBy(deltaSeconds: number) {
        const video = videoRef.current;

        if (!video) {
          return buildSnapshot(null, null, false, playbackRate);
        }

        video.currentTime = normalizeSeekTarget(video, deltaSeconds);
        void synchronizeExternalAudioWithVideo({
          forceSeek: true,
          publishDiagnostics: true,
        });
        emitSyncIssue(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          playbackRate,
        );
      },
      async applySharedPlayback(playback: PlaybackStateSnapshot) {
        const video = videoRef.current;
        authoritativePlaybackRef.current = playback;
        setAuthoritativePlaybackDiagnostics(playback);

        if (!video) {
          return buildSnapshot(null, null, false, playback.playbackRate);
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
        );

        applyPlaybackRateToMedia(playback.playbackRate);

        if (
          playback.status === "stopped" ||
          Math.abs(referenceCurrentTime - nextCurrentTime) >
            pauseConvergenceThresholdSeconds
        ) {
          video.currentTime = nextCurrentTime;
        }

        if (playback.status === "playing") {
          if (!isPlaybackActivelyRunning(playback)) {
            video.pause();
            await synchronizeExternalAudioWithVideo({
              forceSeek: true,
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
              playback.playbackRate,
            );
          }
        }

        video.pause();
        await synchronizeExternalAudioWithVideo({
          forceSeek: true,
          publishDiagnostics: true,
        });
        updateRoomCorrectionState(null);
        emitSyncIssue(null);
        return buildSnapshot(
          video,
          externalAudioRef.current,
          Boolean(activeExternalAudioTrack) && !suppressLocalAudioOutput,
          playback.playbackRate,
        );
      },
    }),
    [activeExternalAudioTrack, playbackRate, suppressLocalAudioOutput],
  );

  return (
    <div className="rounded-[2rem] border border-dashed border-line bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(234,220,206,0.84))] p-6">
      {videoUrl ? (
        <div className="space-y-4">
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            data-debug-video-player="true"
            className="aspect-video w-full rounded-[1.5rem] bg-[#120d0a] shadow-[0_20px_50px_rgba(18,13,10,0.32)]"
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

          <div className="flex flex-col gap-3 rounded-[1.5rem] bg-[linear-gradient(160deg,#251913,#51352b)] px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
                Now loaded
              </p>
              <p className="mt-2 text-lg font-semibold">{title}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <div className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                Room {roomId}
              </div>
              <div className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                Audio target: {activeExternalAudioTrack ? "external track" : "embedded video"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-[1.5rem] bg-[linear-gradient(160deg,#251913,#51352b)] px-6 text-center text-white">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/60">
              Media unavailable
            </p>
            <p className="mt-3 text-lg font-semibold">
              This room does not have a playable uploaded video yet.
            </p>
          </div>
        </div>
      )}

      {subtitleTracks.length > 0 && renderableSubtitleTracks.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm leading-6 text-muted">
          Subtitle files were uploaded for this media asset, but none are in a
          browser-renderable WebVTT form yet.
        </p>
      ) : null}
    </div>
  );
});
