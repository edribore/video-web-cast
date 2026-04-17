"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createSafeId } from "@/lib/create-safe-id";
import {
  createEmptyRawInput,
} from "@/lib/remote-diagnostics";
import {
  logRemoteDiagnosticsEvent,
  recordRemoteDiagnosticsOverlaySnapshot,
} from "@/lib/remote-diagnostics-store";
import { logDebugEvent } from "@/lib/debug-store";
import {
  clampTimelineValue,
  createIdlePlaybackScrubState,
  createInitialMobileOverlayState,
  playbackControllerUiConfig,
  previewPlaybackScrub,
  reduceMobileOverlayState,
  resolvePlaybackScrubCommit,
  resolveTimelineDuration,
  shouldRenderMiniPlaybackShell,
  shouldScheduleMobileOverlayHide,
  startPlaybackScrub,
  type PlaybackControllerDebugInput,
  type MobileOverlayEvent,
  type MobileOverlayState,
  type PlaybackControllerCommand,
  type PlaybackControllerMenu,
  type PlaybackScrubState,
} from "@/lib/playback-controller";
import type { PlaybackStatus } from "@/types/playback";

type UseRoomPlaybackControllerInput = {
  currentTimeSeconds: number;
  durationSeconds: number | null;
  isMobileClient: boolean;
  playbackStatus: PlaybackStatus;
  onCastToggle(): void;
  onRequestCommand(command: PlaybackControllerCommand): void;
  onSelectAudioTrack(trackId: string | null): void;
  onSelectSubtitleTrack(trackId: string | null): void;
};

function logOverlayTransition(
  previousState: MobileOverlayState,
  nextState: MobileOverlayState,
) {
  if (
    previousState.visibility === nextState.visibility &&
    previousState.pinnedReason === nextState.pinnedReason
  ) {
    return;
  }

  if (nextState.visibility === "hidden") {
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "mobile_overlay_hidden",
      source: "local_user",
      data: {
        previousState,
      },
    });
    return;
  }

  if (nextState.visibility === "pinned" && nextState.pinnedReason === "paused") {
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "mobile_overlay_pinned_due_to_pause",
      source: "local_user",
    });
    return;
  }

  if (nextState.visibility === "pinned" && nextState.pinnedReason === "scrub") {
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "mobile_overlay_kept_visible_due_to_scrub",
      source: "local_user",
    });
    return;
  }

  if (
    nextState.visibility === "visible" &&
    previousState.visibility !== "visible"
  ) {
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "mobile_overlay_shown",
      source: "local_user",
      data: {
        previousState,
      },
    });
  }
}

export type RoomPlaybackController = {
  activeMenu: PlaybackControllerMenu | null;
  effectiveCurrentTime: number;
  isFullscreen: boolean;
  overlayState: MobileOverlayState;
  resolvedDurationSeconds: number;
  scrubState: PlaybackScrubState;
  shouldRenderMiniShell: boolean;
  timelineProgressPercent: number;
  timelineValue: number;
  closeMenus(): void;
  handleActivity(): void;
  handleCastToggle(input?: PlaybackControllerDebugInput | null): void;
  handlePlayPause(input?: PlaybackControllerDebugInput | null): void;
  handleSeekRelative(
    deltaSeconds: number,
    input?: PlaybackControllerDebugInput | null,
  ): void;
  handleSelectAudioTrack(
    trackId: string | null,
    input?: PlaybackControllerDebugInput | null,
  ): void;
  handleSelectSubtitleTrack(
    trackId: string | null,
    input?: PlaybackControllerDebugInput | null,
  ): void;
  scrubCancel(): void;
  scrubCommit(
    requestedTimeSeconds?: number | null,
    input?: PlaybackControllerDebugInput | null,
  ): void;
  scrubPreview(requestedTimeSeconds: number): void;
  scrubStart(input?: PlaybackControllerDebugInput | null): void;
  toggleFullscreen(surfaceRef: RefObject<HTMLElement | null>): Promise<void>;
  toggleMenu(menu: PlaybackControllerMenu): void;
};

export function useRoomPlaybackController(
  input: UseRoomPlaybackControllerInput,
): RoomPlaybackController {
  const {
    currentTimeSeconds,
    durationSeconds,
    isMobileClient,
    playbackStatus,
    onCastToggle,
    onRequestCommand,
    onSelectAudioTrack,
    onSelectSubtitleTrack,
  } = input;
  const hideTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const hideTimerStartedAtRef = useRef<number | null>(null);
  const fadeTimerStartedAtRef = useRef<number | null>(null);
  const lastOverlayKeepAliveActionRef = useRef<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<PlaybackControllerMenu | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrubState, setScrubState] = useState<PlaybackScrubState>(
    createIdlePlaybackScrubState,
  );
  const [overlayState, setOverlayState] = useState(() =>
    createInitialMobileOverlayState(input.playbackStatus),
  );
  const activeMenuRef = useRef(activeMenu);
  const scrubStateRef = useRef(scrubState);
  const overlayStateRef = useRef(overlayState);
  const resolvedDurationSeconds = useMemo(
    () => resolveTimelineDuration(durationSeconds, currentTimeSeconds),
    [currentTimeSeconds, durationSeconds],
  );
  const effectiveCurrentTime =
    scrubState.phase === "scrubbing"
      ? scrubState.previewTime
      : currentTimeSeconds;
  const timelineValue = clampTimelineValue(
    effectiveCurrentTime,
    resolvedDurationSeconds,
  );
  const timelineProgressPercent = Math.max(
    0,
    Math.min(100, (timelineValue / resolvedDurationSeconds) * 100),
  );
  const shouldRenderMiniShell = shouldRenderMiniPlaybackShell({
    isMobileClient,
    overlayState,
    playbackStatus,
  });

  const recordOverlaySnapshot = useCallback(
    (
      eventType: string,
      reason: string | null,
      nextState: MobileOverlayState,
      options?: {
        hideTimerState?: "idle" | "scheduled" | "cleared" | "fired";
        fadeTimerState?: "idle" | "scheduled" | "cleared" | "fired";
      },
    ) => {
      recordRemoteDiagnosticsOverlaySnapshot({
        recordedAtMs: Date.now(),
        visibility: nextState.visibility,
        pinnedReason: nextState.pinnedReason,
        eventType,
        reason,
        hideTimerState:
          options?.hideTimerState ??
          (hideTimerRef.current != null ? "scheduled" : "idle"),
        fadeTimerState:
          options?.fadeTimerState ??
          (fadeTimerRef.current != null ? "scheduled" : "idle"),
        hideTimerDurationMs:
          hideTimerStartedAtRef.current != null
            ? Date.now() - hideTimerStartedAtRef.current
            : null,
        fadeTimerDurationMs:
          fadeTimerStartedAtRef.current != null
            ? Date.now() - fadeTimerStartedAtRef.current
            : null,
        activeMenu: activeMenuRef.current,
        lastKeepAliveAction: lastOverlayKeepAliveActionRef.current,
        playbackStatus,
        isMobileClient,
      });
    },
    [isMobileClient, playbackStatus],
  );

  const clearOverlayTimers = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      hideTimerStartedAtRef.current = null;
      recordOverlaySnapshot(
        "hide_timer_cleared",
        "overlay_timer_reset",
        overlayStateRef.current,
        {
          hideTimerState: "cleared",
        },
      );
    }

    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
      fadeTimerStartedAtRef.current = null;
      recordOverlaySnapshot(
        "fade_timer_cleared",
        "overlay_fade_reset",
        overlayStateRef.current,
        {
          fadeTimerState: "cleared",
        },
      );
    }
  }, [recordOverlaySnapshot]);

  const applyOverlayEvent = useCallback((event: MobileOverlayEvent) => {
    const nextState = reduceMobileOverlayState(overlayStateRef.current, event);
    logOverlayTransition(overlayStateRef.current, nextState);
    if (
      event.type === "activity" ||
      event.type === "menu_opened" ||
      event.type === "menu_closed" ||
      event.type === "scrub_started" ||
      event.type === "scrub_finished" ||
      event.type === "playback_paused" ||
      event.type === "playback_resumed"
    ) {
      lastOverlayKeepAliveActionRef.current = event.type;
    }

    if (
      overlayStateRef.current.visibility !== nextState.visibility ||
      overlayStateRef.current.pinnedReason !== nextState.pinnedReason ||
      event.type === "hide_timeout" ||
      event.type === "fade_complete"
    ) {
      const overlayAction =
        nextState.visibility === "hidden" ||
        event.type === "hide_timeout" ||
        event.type === "fade_complete"
          ? "hide_controls"
          : "show_controls";
      const overlayEventId = createSafeId("overlay");

      logRemoteDiagnosticsEvent({
        eventId: overlayEventId,
        parentEventId: null,
        source:
          event.type === "hide_timeout" || event.type === "fade_complete"
            ? "timer"
            : "custom",
        action: overlayAction,
        rawInput: createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage:
          event.type === "fade_complete"
            ? "rendered"
            : event.type === "hide_timeout"
              ? "captured"
              : "normalized",
        sequenceNumber: null,
        roomVersion: null,
        stateVersion: null,
        playbackStateVersion: null,
        currentTimeSec: currentTimeSeconds,
        durationSec: resolvedDurationSeconds,
        paused: playbackStatus !== "playing",
        playbackRate: null,
        buffering: null,
        seeking: scrubStateRef.current.phase === "scrubbing",
        module: "components/use-room-playback-controller",
        functionName: "applyOverlayEvent",
        notes: event.type,
        reason:
          event.type === "hide_timeout"
            ? "overlay_hide_timeout_elapsed"
            : event.type === "fade_complete"
              ? "overlay_fade_completed"
              : nextState.pinnedReason,
        status:
          event.type === "fade_complete"
            ? "rendered"
            : event.type === "hide_timeout"
              ? "pending"
              : "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: {
          previousState: overlayStateRef.current,
          nextState,
        },
      });
    }

    recordOverlaySnapshot(event.type, nextState.pinnedReason, nextState);
    overlayStateRef.current = nextState;
    setOverlayState(nextState);
  }, [
    currentTimeSeconds,
    playbackStatus,
    recordOverlaySnapshot,
    resolvedDurationSeconds,
  ]);

  useEffect(() => {
    activeMenuRef.current = activeMenu;
  }, [activeMenu]);

  useEffect(() => {
    scrubStateRef.current = scrubState;
  }, [scrubState]);

  useEffect(() => {
    overlayStateRef.current = overlayState;
  }, [overlayState]);

  const handleActivity = useCallback(() => {
    applyOverlayEvent({ type: "activity" });
  }, [applyOverlayEvent]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (playbackStatus === "playing") {
      applyOverlayEvent({ type: "playback_resumed" });
      return;
    }

    applyOverlayEvent({ type: "playback_paused" });
  }, [applyOverlayEvent, playbackStatus]);

  useEffect(() => {
    clearOverlayTimers();

    if (
      !shouldScheduleMobileOverlayHide({
        activeMenu,
        isMobileClient,
        overlayState,
        playbackStatus,
        scrubState,
      })
    ) {
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerStartedAtRef.current = null;
      recordOverlaySnapshot(
        "hide_timer_fired",
        "overlay_hide_delay_elapsed",
        overlayStateRef.current,
        {
          hideTimerState: "fired",
        },
      );
      applyOverlayEvent({ type: "hide_timeout" });
    }, playbackControllerUiConfig.mobileOverlayHideDelayMs);
    hideTimerStartedAtRef.current = Date.now();
    recordOverlaySnapshot(
      "hide_timer_started",
      "overlay_hide_scheduled",
      overlayState,
      {
        hideTimerState: "scheduled",
      },
    );

    return clearOverlayTimers;
  }, [
    activeMenu,
    applyOverlayEvent,
    clearOverlayTimers,
    isMobileClient,
    playbackStatus,
    overlayState,
    recordOverlaySnapshot,
    scrubState,
  ]);

  useEffect(() => {
    if (!isMobileClient || overlayState.visibility !== "fading") {
      return;
    }

    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerStartedAtRef.current = null;
      recordOverlaySnapshot(
        "fade_timer_fired",
        "overlay_fade_duration_elapsed",
        overlayStateRef.current,
        {
          fadeTimerState: "fired",
        },
      );
      applyOverlayEvent({ type: "fade_complete" });
    }, playbackControllerUiConfig.mobileOverlayFadeDurationMs);
    fadeTimerStartedAtRef.current = Date.now();
    recordOverlaySnapshot(
      "fade_timer_started",
      "overlay_fade_scheduled",
      overlayState,
      {
        fadeTimerState: "scheduled",
      },
    );

    return () => {
      if (fadeTimerRef.current != null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
        fadeTimerStartedAtRef.current = null;
        recordOverlaySnapshot(
          "fade_timer_cleared",
          "overlay_fade_reset",
          overlayStateRef.current,
          {
            fadeTimerState: "cleared",
          },
        );
      }
    };
  }, [
    applyOverlayEvent,
    isMobileClient,
    overlayState,
    overlayState.visibility,
    recordOverlaySnapshot,
  ]);

  useEffect(() => clearOverlayTimers, [clearOverlayTimers]);

  const closeMenus = useCallback(() => {
    if (activeMenuRef.current == null) {
      return;
    }

    setActiveMenu(null);
    activeMenuRef.current = null;
    applyOverlayEvent({ type: "menu_closed" });
  }, [applyOverlayEvent]);

  const handlePlayPause = useCallback((inputMeta?: PlaybackControllerDebugInput | null) => {
    handleActivity();
    closeMenus();
    onRequestCommand({
      type: playbackStatus === "playing" ? "pause" : "play",
      debugInput: inputMeta ?? null,
    });
  }, [closeMenus, handleActivity, onRequestCommand, playbackStatus]);

  const handleSeekRelative = useCallback((
    deltaSeconds: number,
    inputMeta?: PlaybackControllerDebugInput | null,
  ) => {
    handleActivity();
    closeMenus();
    onRequestCommand({
      type: "seek",
      deltaSeconds,
      debugInput: inputMeta ?? null,
    });
  }, [closeMenus, handleActivity, onRequestCommand]);

  const scrubStart = useCallback((inputMeta?: PlaybackControllerDebugInput | null) => {
    handleActivity();
    closeMenus();
    const nextScrubState = startPlaybackScrub({
      currentTimeSeconds,
      nowMs: Date.now(),
    });
    scrubStateRef.current = nextScrubState;
    setScrubState(nextScrubState);
    applyOverlayEvent({ type: "scrub_started" });
    if (inputMeta) {
      logRemoteDiagnosticsEvent({
        eventId: inputMeta.eventId,
        parentEventId: inputMeta.parentEventId ?? null,
        source: inputMeta.source,
        action: "show_controls",
        rawInput: inputMeta.rawInput ?? createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage: "captured",
        sequenceNumber: null,
        roomVersion: null,
        stateVersion: null,
        playbackStateVersion: null,
        currentTimeSec: currentTimeSeconds,
        durationSec: resolvedDurationSeconds,
        paused: playbackStatus !== "playing",
        playbackRate: null,
        buffering: null,
        seeking: true,
        module: "components/use-room-playback-controller",
        functionName: "scrubStart",
        notes: inputMeta.notes ?? "scrub_started",
        reason: inputMeta.reason ?? null,
        status: "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: null,
      });
    }
  }, [
    applyOverlayEvent,
    closeMenus,
    currentTimeSeconds,
    handleActivity,
    playbackStatus,
    resolvedDurationSeconds,
  ]);

  const scrubPreview = useCallback((requestedTimeSeconds: number) => {
    handleActivity();
    const nextScrubState = previewPlaybackScrub({
      durationSeconds: resolvedDurationSeconds,
      scrubState: scrubStateRef.current,
      valueSeconds: requestedTimeSeconds,
    });
    scrubStateRef.current = nextScrubState;
    setScrubState(nextScrubState);
  }, [handleActivity, resolvedDurationSeconds]);

  const scrubCommit = useCallback((
    requestedTimeSeconds?: number | null,
    inputMeta?: PlaybackControllerDebugInput | null,
  ) => {
    handleActivity();
    const scrubStateForCommit =
      scrubStateRef.current.phase === "scrubbing" &&
      typeof requestedTimeSeconds === "number"
        ? {
            ...scrubStateRef.current,
            previewTime: clampTimelineValue(
              requestedTimeSeconds,
              resolvedDurationSeconds,
            ),
          }
        : scrubStateRef.current;
    const commit = resolvePlaybackScrubCommit({
      currentTimeSeconds,
      durationSeconds: resolvedDurationSeconds,
      scrubState: scrubStateForCommit,
    });

    scrubStateRef.current = commit.nextState;
    setScrubState(commit.nextState);

    if (commit.committedTimeSeconds != null) {
      onRequestCommand({
        type: "seek",
        targetTimeSeconds: commit.committedTimeSeconds,
        debugInput: inputMeta ?? null,
      });
    }

    applyOverlayEvent({ type: "scrub_finished" });
  }, [
    applyOverlayEvent,
    currentTimeSeconds,
    handleActivity,
    onRequestCommand,
    resolvedDurationSeconds,
  ]);

  const scrubCancel = useCallback(() => {
    const nextScrubState = createIdlePlaybackScrubState();
    scrubStateRef.current = nextScrubState;
    setScrubState(nextScrubState);
    applyOverlayEvent({ type: "scrub_finished" });
  }, [applyOverlayEvent]);

  const toggleMenu = useCallback((menu: PlaybackControllerMenu) => {
    handleActivity();
    const nextMenu = activeMenuRef.current === menu ? null : menu;

    activeMenuRef.current = nextMenu;
    setActiveMenu(nextMenu);
    applyOverlayEvent({
      type: nextMenu == null ? "menu_closed" : "menu_opened",
    });
  }, [applyOverlayEvent, handleActivity]);

  const toggleFullscreen = useCallback(
    async (surfaceRef: RefObject<HTMLElement | null>) => {
      handleActivity();

      if (!surfaceRef.current) {
        return;
      }

      if (document.fullscreenElement === surfaceRef.current) {
        await document.exitFullscreen().catch(() => undefined);
        return;
      }

      await surfaceRef.current.requestFullscreen().catch(() => undefined);
    },
    [handleActivity],
  );

  const handleCastToggle = useCallback((inputMeta?: PlaybackControllerDebugInput | null) => {
    handleActivity();
    if (inputMeta) {
      logRemoteDiagnosticsEvent({
        eventId: inputMeta.eventId,
        parentEventId: inputMeta.parentEventId ?? null,
        source: inputMeta.source,
        action: inputMeta.action,
        rawInput: inputMeta.rawInput ?? createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage: "captured",
        sequenceNumber: null,
        roomVersion: null,
        stateVersion: null,
        playbackStateVersion: null,
        currentTimeSec: currentTimeSeconds,
        durationSec: resolvedDurationSeconds,
        paused: playbackStatus !== "playing",
        playbackRate: null,
        buffering: null,
        seeking: scrubStateRef.current.phase === "scrubbing",
        module: "components/use-room-playback-controller",
        functionName: "handleCastToggle",
        notes: inputMeta.notes ?? null,
        reason: inputMeta.reason ?? null,
        status: "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: null,
      });
    }
    onCastToggle();
  }, [
    currentTimeSeconds,
    handleActivity,
    onCastToggle,
    playbackStatus,
    resolvedDurationSeconds,
  ]);

  const handleSelectAudioTrack = useCallback((
    trackId: string | null,
    inputMeta?: PlaybackControllerDebugInput | null,
  ) => {
    handleActivity();
    if (inputMeta) {
      logRemoteDiagnosticsEvent({
        eventId: inputMeta.eventId,
        parentEventId: inputMeta.parentEventId ?? null,
        source: inputMeta.source,
        action: inputMeta.action,
        rawInput: inputMeta.rawInput ?? createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage: "captured",
        sequenceNumber: null,
        roomVersion: null,
        stateVersion: null,
        playbackStateVersion: null,
        currentTimeSec: currentTimeSeconds,
        durationSec: resolvedDurationSeconds,
        paused: playbackStatus !== "playing",
        playbackRate: null,
        buffering: null,
        seeking: scrubStateRef.current.phase === "scrubbing",
        module: "components/use-room-playback-controller",
        functionName: "handleSelectAudioTrack",
        notes: inputMeta.notes ?? null,
        reason: inputMeta.reason ?? null,
        status: "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: {
          trackId,
        },
      });
    }
    onSelectAudioTrack(trackId);
    closeMenus();
  }, [
    closeMenus,
    currentTimeSeconds,
    handleActivity,
    onSelectAudioTrack,
    playbackStatus,
    resolvedDurationSeconds,
  ]);

  const handleSelectSubtitleTrack = useCallback((
    trackId: string | null,
    inputMeta?: PlaybackControllerDebugInput | null,
  ) => {
    handleActivity();
    if (inputMeta) {
      logRemoteDiagnosticsEvent({
        eventId: inputMeta.eventId,
        parentEventId: inputMeta.parentEventId ?? null,
        source: inputMeta.source,
        action: inputMeta.action,
        rawInput: inputMeta.rawInput ?? createEmptyRawInput(),
        wallClockTs: Date.now(),
        stage: "captured",
        sequenceNumber: null,
        roomVersion: null,
        stateVersion: null,
        playbackStateVersion: null,
        currentTimeSec: currentTimeSeconds,
        durationSec: resolvedDurationSeconds,
        paused: playbackStatus !== "playing",
        playbackRate: null,
        buffering: null,
        seeking: scrubStateRef.current.phase === "scrubbing",
        module: "components/use-room-playback-controller",
        functionName: "handleSelectSubtitleTrack",
        notes: inputMeta.notes ?? null,
        reason: inputMeta.reason ?? null,
        status: "observed",
        actorSessionId: null,
        transportDirection: "local",
        extra: {
          trackId,
        },
      });
    }
    onSelectSubtitleTrack(trackId);
    closeMenus();
  }, [
    closeMenus,
    currentTimeSeconds,
    handleActivity,
    onSelectSubtitleTrack,
    playbackStatus,
    resolvedDurationSeconds,
  ]);

  return useMemo(
    () => ({
      activeMenu,
      effectiveCurrentTime,
      isFullscreen,
      overlayState,
      resolvedDurationSeconds,
      scrubState,
      shouldRenderMiniShell,
      timelineProgressPercent,
      timelineValue,
      closeMenus,
      handleActivity,
      handleCastToggle,
      handlePlayPause,
      handleSeekRelative,
      handleSelectAudioTrack,
      handleSelectSubtitleTrack,
      scrubCancel,
      scrubCommit,
      scrubPreview,
      scrubStart,
      toggleFullscreen,
      toggleMenu,
    }),
    [
      activeMenu,
      closeMenus,
      effectiveCurrentTime,
      handleActivity,
      handleCastToggle,
      handlePlayPause,
      handleSeekRelative,
      handleSelectAudioTrack,
      handleSelectSubtitleTrack,
      isFullscreen,
      overlayState,
      resolvedDurationSeconds,
      scrubCancel,
      scrubCommit,
      scrubPreview,
      scrubStart,
      scrubState,
      shouldRenderMiniShell,
      timelineProgressPercent,
      timelineValue,
      toggleFullscreen,
      toggleMenu,
    ],
  );
}
