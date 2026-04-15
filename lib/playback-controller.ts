import type { PlaybackStatus } from "@/types/playback";
import type { SharedRoomControlType } from "@/types/room-sync";

export type PlaybackControllerCommand = {
  type: SharedRoomControlType;
  deltaSeconds?: number;
  targetTimeSeconds?: number;
};

export type PlaybackControllerMenu =
  | "audio"
  | "settings"
  | "subtitles";

export type MobileOverlayVisibilityState =
  | "visible"
  | "fading"
  | "hidden"
  | "pinned";

export type MobileOverlayPinnedReason =
  | "menu"
  | "paused"
  | "scrub"
  | null;

export type MobileOverlayState = {
  visibility: MobileOverlayVisibilityState;
  pinnedReason: MobileOverlayPinnedReason;
};

export type MobileOverlayEvent =
  | { type: "activity" }
  | { type: "fade_complete" }
  | { type: "hide_timeout" }
  | { type: "menu_closed" }
  | { type: "menu_opened" }
  | { type: "playback_paused" }
  | { type: "playback_resumed" }
  | { type: "scrub_finished" }
  | { type: "scrub_started" };

export type PlaybackScrubState =
  | {
      phase: "idle";
      previewTime: null;
      startedAtMs: null;
    }
  | {
      phase: "scrubbing";
      previewTime: number;
      startedAtMs: number;
    };

export const playbackControllerUiConfig = {
  mobileOverlayFadeDurationMs: 220,
  mobileOverlayHideDelayMs: 2200,
  mobilePostScrubVisibleDelayMs: 2400,
  scrubCommitThresholdSeconds: 0.2,
} as const;

export function createInitialMobileOverlayState(
  playbackStatus: PlaybackStatus,
): MobileOverlayState {
  return playbackStatus === "playing"
    ? {
        visibility: "visible",
        pinnedReason: null,
      } satisfies MobileOverlayState
    : {
        visibility: "pinned",
        pinnedReason: "paused",
      } satisfies MobileOverlayState;
}

export function reduceMobileOverlayState(
  state: MobileOverlayState,
  event: MobileOverlayEvent,
): MobileOverlayState {
  switch (event.type) {
    case "playback_paused":
      return {
        visibility: "pinned",
        pinnedReason: "paused",
      } satisfies MobileOverlayState;
    case "scrub_started":
      return {
        visibility: "pinned",
        pinnedReason: "scrub",
      } satisfies MobileOverlayState;
    case "menu_opened":
      return {
        visibility: "pinned",
        pinnedReason: "menu",
      } satisfies MobileOverlayState;
    case "playback_resumed":
      return {
        visibility: "visible",
        pinnedReason: null,
      } satisfies MobileOverlayState;
    case "scrub_finished":
      return state.pinnedReason === "scrub"
        ? {
            visibility: "visible",
            pinnedReason: null,
          }
        : state;
    case "menu_closed":
      return state.pinnedReason === "menu"
        ? {
            visibility: "visible",
            pinnedReason: null,
          }
        : state;
    case "activity":
      return state.visibility === "visible" && state.pinnedReason == null
        ? state
        : {
            visibility: "visible",
            pinnedReason: null,
          };
    case "hide_timeout":
      return state.visibility === "visible" && state.pinnedReason == null
        ? {
            visibility: "fading",
            pinnedReason: null,
          }
        : state;
    case "fade_complete":
      return state.visibility === "fading"
        ? {
            visibility: "hidden",
            pinnedReason: null,
          }
        : state;
    default:
      return state;
  }
}

export function shouldScheduleMobileOverlayHide(input: {
  activeMenu: PlaybackControllerMenu | null;
  isMobileClient: boolean;
  overlayState: MobileOverlayState;
  playbackStatus: PlaybackStatus;
  scrubState: PlaybackScrubState;
}) {
  if (!input.isMobileClient) {
    return false;
  }

  if (input.playbackStatus !== "playing") {
    return false;
  }

  if (input.activeMenu != null || input.scrubState.phase === "scrubbing") {
    return false;
  }

  return input.overlayState.visibility === "visible";
}

export function shouldRenderMiniPlaybackShell(input: {
  isMobileClient: boolean;
  overlayState: MobileOverlayState;
  playbackStatus: PlaybackStatus;
}) {
  return (
    input.isMobileClient &&
    input.playbackStatus === "playing" &&
    input.overlayState.visibility === "hidden"
  );
}

export function clampTimelineValue(value: number, durationSeconds: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(value, durationSeconds));
}

export function resolveTimelineDuration(
  durationSeconds: number | null,
  currentTimeSeconds: number,
) {
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
    return Math.max(durationSeconds, currentTimeSeconds, 1);
  }

  return Math.max(currentTimeSeconds, 1);
}

export function createIdlePlaybackScrubState(): PlaybackScrubState {
  return {
    phase: "idle",
    previewTime: null,
    startedAtMs: null,
  };
}

export function startPlaybackScrub(input: {
  currentTimeSeconds: number;
  nowMs: number;
}) {
  return {
    phase: "scrubbing",
    previewTime: input.currentTimeSeconds,
    startedAtMs: input.nowMs,
  } satisfies PlaybackScrubState;
}

export function previewPlaybackScrub(input: {
  durationSeconds: number;
  scrubState: PlaybackScrubState;
  valueSeconds: number;
}) {
  if (input.scrubState.phase !== "scrubbing") {
    return input.scrubState;
  }

  return {
    ...input.scrubState,
    previewTime: clampTimelineValue(input.valueSeconds, input.durationSeconds),
  } satisfies PlaybackScrubState;
}

export function resolvePlaybackScrubCommit(input: {
  currentTimeSeconds: number;
  durationSeconds: number;
  scrubState: PlaybackScrubState;
}) {
  if (input.scrubState.phase !== "scrubbing") {
    return {
      committedTimeSeconds: null,
      nextState: createIdlePlaybackScrubState(),
    };
  }

  const normalizedTime = clampTimelineValue(
    input.scrubState.previewTime,
    input.durationSeconds,
  );

  return {
    committedTimeSeconds:
      Math.abs(normalizedTime - input.currentTimeSeconds) >=
      playbackControllerUiConfig.scrubCommitThresholdSeconds
        ? normalizedTime
        : null,
    nextState: createIdlePlaybackScrubState(),
  };
}
