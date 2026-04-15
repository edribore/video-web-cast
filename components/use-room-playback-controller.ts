"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  handleCastToggle(): void;
  handlePlayPause(): void;
  handleSeekRelative(deltaSeconds: number): void;
  handleSelectAudioTrack(trackId: string | null): void;
  handleSelectSubtitleTrack(trackId: string | null): void;
  scrubCancel(): void;
  scrubCommit(requestedTimeSeconds?: number | null): void;
  scrubPreview(requestedTimeSeconds: number): void;
  scrubStart(): void;
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

  const clearOverlayTimers = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  const applyOverlayEvent = useCallback((event: MobileOverlayEvent) => {
    const nextState = reduceMobileOverlayState(overlayStateRef.current, event);
    logOverlayTransition(overlayStateRef.current, nextState);
    overlayStateRef.current = nextState;
    setOverlayState(nextState);
  }, []);

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
      applyOverlayEvent({ type: "hide_timeout" });
    }, playbackControllerUiConfig.mobileOverlayHideDelayMs);

    return clearOverlayTimers;
  }, [
    activeMenu,
    applyOverlayEvent,
    clearOverlayTimers,
    isMobileClient,
    playbackStatus,
    overlayState,
    scrubState,
  ]);

  useEffect(() => {
    if (!isMobileClient || overlayState.visibility !== "fading") {
      return;
    }

    fadeTimerRef.current = window.setTimeout(() => {
      applyOverlayEvent({ type: "fade_complete" });
    }, playbackControllerUiConfig.mobileOverlayFadeDurationMs);

    return () => {
      if (fadeTimerRef.current != null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [applyOverlayEvent, isMobileClient, overlayState.visibility]);

  useEffect(() => clearOverlayTimers, [clearOverlayTimers]);

  const closeMenus = useCallback(() => {
    if (activeMenuRef.current == null) {
      return;
    }

    setActiveMenu(null);
    activeMenuRef.current = null;
    applyOverlayEvent({ type: "menu_closed" });
  }, [applyOverlayEvent]);

  const handlePlayPause = useCallback(() => {
    handleActivity();
    closeMenus();
    onRequestCommand({
      type: playbackStatus === "playing" ? "pause" : "play",
    });
  }, [closeMenus, handleActivity, onRequestCommand, playbackStatus]);

  const handleSeekRelative = useCallback((deltaSeconds: number) => {
    handleActivity();
    closeMenus();
    onRequestCommand({
      type: "seek",
      deltaSeconds,
    });
  }, [closeMenus, handleActivity, onRequestCommand]);

  const scrubStart = useCallback(() => {
    handleActivity();
    closeMenus();
    const nextScrubState = startPlaybackScrub({
      currentTimeSeconds,
      nowMs: Date.now(),
    });
    scrubStateRef.current = nextScrubState;
    setScrubState(nextScrubState);
    applyOverlayEvent({ type: "scrub_started" });
  }, [applyOverlayEvent, closeMenus, currentTimeSeconds, handleActivity]);

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

  const scrubCommit = useCallback((requestedTimeSeconds?: number | null) => {
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

  const handleCastToggle = useCallback(() => {
    handleActivity();
    onCastToggle();
  }, [handleActivity, onCastToggle]);

  const handleSelectAudioTrack = useCallback((trackId: string | null) => {
    handleActivity();
    onSelectAudioTrack(trackId);
    closeMenus();
  }, [closeMenus, handleActivity, onSelectAudioTrack]);

  const handleSelectSubtitleTrack = useCallback((trackId: string | null) => {
    handleActivity();
    onSelectSubtitleTrack(trackId);
    closeMenus();
  }, [closeMenus, handleActivity, onSelectSubtitleTrack]);

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
