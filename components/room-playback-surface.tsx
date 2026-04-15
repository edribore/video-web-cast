"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  isPlayableAudioTrackSupport,
  type AudioTrackPlaybackSupport,
} from "@/lib/audio-track-playback";
import { formatPlaybackSeconds } from "@/lib/playback";
import type { RoomPlaybackController } from "@/components/use-room-playback-controller";
import type { AudioSelectionMode } from "@/lib/audio-preferences";
import type { ChromecastAvailabilityStatus } from "@/lib/chromecast";
import type { PlaybackStatus } from "@/types/playback";
import type {
  RoomAudioTrackSummary,
  RoomSubtitleTrackSummary,
} from "@/types/room-sync";

type RoomPlaybackSurfaceProps = {
  controller: RoomPlaybackController;
  title: string;
  subtitle: string;
  isMobileClient: boolean;
  playbackTarget: "local" | "cast";
  playbackStatus: PlaybackStatus;
  audioTracks: readonly RoomAudioTrackSummary[];
  audioTrackSupport: Record<string, AudioTrackPlaybackSupport>;
  selectedAudioTrackId: string | null;
  audioSelectionMode: AudioSelectionMode;
  subtitleTracks: readonly RoomSubtitleTrackSummary[];
  selectedSubtitleTrackId: string | null;
  audioStatusMessage: string;
  subtitleStatusMessage: string;
  playbackStatusMessage: string;
  castStatus: ChromecastAvailabilityStatus;
  canToggleCast: boolean;
  primaryClockLabel: string;
  syncModeLabel: string;
  syncIssue: string | null;
  castRemoteObserved: boolean;
  children: ReactNode;
};
const seekStepSeconds = 10;

function getCastPillClasses(status: ChromecastAvailabilityStatus) {
  switch (status) {
    case "connected":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-100";
    case "connecting":
    case "loading":
      return "border-amber-300/35 bg-amber-400/15 text-amber-50";
    case "available":
      return "border-sky-300/35 bg-sky-400/15 text-sky-50";
    case "error":
      return "border-rose-400/35 bg-rose-500/15 text-rose-50";
    case "unavailable":
      return "border-white/10 bg-white/6 text-white/65";
  }
}

function getPlaybackPillClasses(status: PlaybackStatus) {
  switch (status) {
    case "playing":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-100";
    case "paused":
      return "border-amber-300/35 bg-amber-400/15 text-amber-50";
    case "stopped":
      return "border-white/10 bg-white/6 text-white/70";
  }
}

function PlaybackIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.42-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current" aria-hidden="true">
      <path d="M7 5.5A1.5 1.5 0 0 1 8.5 4h1A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20h-1A1.5 1.5 0 0 1 7 18.5v-13Zm6 0A1.5 1.5 0 0 1 14.5 4h1A1.5 1.5 0 0 1 17 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-1A1.5 1.5 0 0 1 13 18.5v-13Z" />
    </svg>
  );
}

function SeekIcon({
  direction,
  seconds,
}: {
  direction: "backward" | "forward";
  seconds: number;
}) {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9 fill-none" aria-hidden="true">
      <path
        d={
          direction === "backward"
            ? "M20 12 10 19l10 7"
            : "m28 12 10 7-10 7"
        }
        className="stroke-current"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.5"
      />
      <path
        d="M36.7 15.4A18 18 0 1 1 14 12.1"
        className="stroke-current"
        strokeLinecap="round"
        strokeWidth="3.5"
      />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        className="fill-current text-[11px] font-semibold"
      >
        {seconds}
      </text>
    </svg>
  );
}

function CaptionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2.5"
        className="stroke-current"
        strokeWidth="1.8"
      />
      <path
        d="M8 11.5h3m-3 2.5h6m2-2.5h.5m-.5 2.5h.5"
        className="stroke-current"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <path
        d="M11 6 8.5 8.5H6A1.5 1.5 0 0 0 4.5 10v4A1.5 1.5 0 0 0 6 15.5h2.5L11 18V6Z"
        className="stroke-current"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M15.5 9.5a4 4 0 0 1 0 5m2.5-7.5a7 7 0 0 1 0 10"
        className="stroke-current"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <path
        d="m12 3.75 1.1 1.65a1 1 0 0 0 .77.44l1.98.12.6 1.9a1 1 0 0 0 .57.63l1.8.73v1.88l-1.8.73a1 1 0 0 0-.57.63l-.6 1.9-1.98.12a1 1 0 0 0-.77.44L12 20.25l-1.1-1.65a1 1 0 0 0-.77-.44l-1.98-.12-.6-1.9a1 1 0 0 0-.57-.63l-1.8-.73V12.9l1.8-.73a1 1 0 0 0 .57-.63l.6-1.9 1.98-.12a1 1 0 0 0 .77-.44L12 3.75Z"
        className="stroke-current"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
      <circle cx="12" cy="12" r="2.8" className="stroke-current" strokeWidth="1.8" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <path
        d="M8.5 3.5H4.75A1.25 1.25 0 0 0 3.5 4.75V8.5m17-5h-3.75A1.25 1.25 0 0 0 15.5 4.75V8.5m5 7v3.75a1.25 1.25 0 0 1-1.25 1.25H15.5m-12-5v3.75a1.25 1.25 0 0 0 1.25 1.25H8.5"
        className="stroke-current"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <path
        d="M9 4H4v5m11-5h5v5M9 20H4v-5m16 5h-5v-5"
        className="stroke-current"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CastIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" aria-hidden="true">
      <path
        d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H9"
        className="stroke-current"
        strokeWidth="1.8"
      />
      <path
        d="M4 18a2 2 0 0 1 2 2m-2-6a6 6 0 0 1 6 6m-6-10a10 10 0 0 1 10 10"
        className="stroke-current"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SurfaceActionButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-white/12 bg-black/28 text-white shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:scale-[1.02] hover:border-white/35 hover:bg-black/42 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-[5rem] sm:w-[5rem]"
    >
      {children}
    </button>
  );
}

function OverlayToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
        active
          ? "border-white/30 bg-white/18 text-white"
          : "border-white/12 bg-black/28 text-white/85 hover:border-white/25 hover:bg-black/38"
      } disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-black/18 disabled:text-white/35`}
    >
      {children}
    </button>
  );
}

function MenuPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="w-[min(24rem,calc(100vw-2.5rem))] rounded-[1.4rem] border border-white/12 bg-[#11161f]/94 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/50">
        {title}
      </p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

export function RoomPlaybackSurface({
  controller,
  title,
  subtitle,
  isMobileClient,
  playbackTarget,
  playbackStatus,
  audioTracks,
  audioTrackSupport,
  selectedAudioTrackId,
  audioSelectionMode,
  subtitleTracks,
  selectedSubtitleTrackId,
  audioStatusMessage,
  subtitleStatusMessage,
  playbackStatusMessage,
  castStatus,
  canToggleCast,
  primaryClockLabel,
  syncModeLabel,
  syncIssue,
  castRemoteObserved,
  children,
}: RoomPlaybackSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const timelineInputRef = useRef<HTMLInputElement>(null);
  const isScrubbing = controller.scrubState.phase === "scrubbing";
  const closeMenus = controller.closeMenus;
  const scrubCancel = controller.scrubCancel;
  const scrubCommit = controller.scrubCommit;
  const scrubPhase = controller.scrubState.phase;
  const scrubPreviewTime =
    controller.scrubState.phase === "scrubbing"
      ? controller.scrubState.previewTime
      : null;
  const controlsVisible =
    !isMobileClient || controller.overlayState.visibility !== "hidden";

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement
    ) {
      return;
    }

    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      controller.handlePlayPause();
      return;
    }

    if (event.key.toLowerCase() === "j" || event.key === "ArrowLeft") {
      event.preventDefault();
      controller.handleSeekRelative(-seekStepSeconds);
      return;
    }

    if (event.key.toLowerCase() === "l" || event.key === "ArrowRight") {
      event.preventDefault();
      controller.handleSeekRelative(seekStepSeconds);
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void controller.toggleFullscreen(surfaceRef);
      return;
    }

    if (event.key === "Escape") {
      controller.closeMenus();
      controller.scrubCancel();
      controller.handleActivity();
    }
  };

  const timelineTrackStyle = {
    width: `${controller.timelineProgressPercent}%`,
  } satisfies CSSProperties;

  const timelinePreviewStyle = {
    left: `${controller.timelineProgressPercent}%`,
  } satisfies CSSProperties;

  useEffect(() => {
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (
        surfaceRef.current &&
        event.target instanceof Node &&
        !surfaceRef.current.contains(event.target)
      ) {
        closeMenus();
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [closeMenus]);

  useEffect(() => {
    if (scrubPhase !== "scrubbing") {
      return;
    }

    const commitFromInput = () => {
      const requestedTimeSeconds =
        timelineInputRef.current == null
          ? null
          : Number(timelineInputRef.current.value);
      scrubCommit(requestedTimeSeconds);
    };
    const cancelScrub = () => {
      scrubCancel();
    };

    window.addEventListener("pointerup", commitFromInput);
    window.addEventListener("mouseup", commitFromInput);
    window.addEventListener("touchend", commitFromInput);
    window.addEventListener("pointercancel", cancelScrub);
    window.addEventListener("touchcancel", cancelScrub);

    return () => {
      window.removeEventListener("pointerup", commitFromInput);
      window.removeEventListener("mouseup", commitFromInput);
      window.removeEventListener("touchend", commitFromInput);
      window.removeEventListener("pointercancel", cancelScrub);
      window.removeEventListener("touchcancel", cancelScrub);
    };
  }, [scrubCancel, scrubCommit, scrubPhase]);

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      onKeyDown={handleSurfaceKeyDown}
      onPointerMove={controller.handleActivity}
      onPointerDown={controller.handleActivity}
      onFocus={controller.handleActivity}
      onTouchStart={controller.handleActivity}
      onDoubleClick={() => void controller.toggleFullscreen(surfaceRef)}
      className={`group relative aspect-video overflow-hidden rounded-[2rem] border border-white/10 bg-[#020409] shadow-[0_26px_90px_rgba(3,5,11,0.42)] outline-none ${
        controller.isFullscreen ? "max-h-screen rounded-none" : ""
      }`}
    >
      <div className="absolute inset-0">{children}</div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_28%,rgba(0,0,0,0.28)_72%,rgba(0,0,0,0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(0,0,0,0.74),rgba(0,0,0,0.24),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(0deg,rgba(0,0,0,0.9),rgba(0,0,0,0.4),transparent)]" />

      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          controlsVisible || playbackStatus !== "playing"
            ? "pointer-events-auto opacity-100"
            : controller.overlayState.visibility === "fading"
              ? "pointer-events-none opacity-0"
              : "pointer-events-none opacity-0"
        }`}
      >
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-6">
          <div className="pointer-events-auto flex items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] ${getPlaybackPillClasses(
                playbackStatus,
              )}`}
            >
              {playbackTarget === "cast" ? "TV companion" : playbackStatus}
            </span>
            {playbackTarget === "cast" ? (
              <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white/70">
                Room authoritative
              </span>
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-4 px-20 text-center sm:top-6">
            <p className="truncate text-2xl font-semibold tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.5)] sm:text-[2rem]">
              {title}
            </p>
            <p className="mt-1 text-sm text-white/72 sm:text-xl">{subtitle}</p>
          </div>

          <div className="pointer-events-auto relative flex items-center gap-2">
            <button
              type="button"
              disabled={!canToggleCast}
              onClick={controller.handleCastToggle}
              className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold backdrop-blur-xl transition ${getCastPillClasses(
                castStatus,
              )} disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-black/18 disabled:text-white/35`}
            >
              <CastIcon />
              <span>{castStatus === "connected" ? "End Cast" : "Cast"}</span>
            </button>
            <OverlayToolbarButton
              label="Subtitles"
              active={controller.activeMenu === "subtitles"}
              onClick={() => controller.toggleMenu("subtitles")}
            >
              <CaptionIcon />
            </OverlayToolbarButton>
            <OverlayToolbarButton
              label="Audio"
              active={controller.activeMenu === "audio"}
              onClick={() => controller.toggleMenu("audio")}
            >
              <AudioIcon />
            </OverlayToolbarButton>
            <OverlayToolbarButton
              label="Playback settings"
              active={controller.activeMenu === "settings"}
              onClick={() => controller.toggleMenu("settings")}
            >
              <SettingsIcon />
            </OverlayToolbarButton>
            <OverlayToolbarButton
              label={controller.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={() => void controller.toggleFullscreen(surfaceRef)}
            >
              <FullscreenIcon active={controller.isFullscreen} />
            </OverlayToolbarButton>

            {controller.activeMenu ? (
              <div className="absolute right-0 top-14 z-10">
                {controller.activeMenu === "audio" ? (
                  <MenuPanel title="Audio">
                    <div className="rounded-2xl border border-white/8 bg-white/4 p-1.5">
                      <button
                        type="button"
                        onClick={() => controller.handleSelectAudioTrack(null)}
                        className={`flex w-full items-center justify-between rounded-[1rem] px-3 py-3 text-left text-sm transition ${
                          selectedAudioTrackId == null
                            ? "bg-white/12 text-white"
                            : "text-white/72 hover:bg-white/8 hover:text-white"
                        }`}
                      >
                        <span>Embedded video audio</span>
                        {selectedAudioTrackId == null ? <span>Selected</span> : null}
                      </button>
                      {audioTracks.map((track) => {
                        const playable = isPlayableAudioTrackSupport(
                          audioTrackSupport[track.id],
                        );
                        const selected = selectedAudioTrackId === track.id;

                        return (
                          <button
                            key={track.id}
                            type="button"
                            disabled={!playable}
                            onClick={() => controller.handleSelectAudioTrack(track.id)}
                            className={`mt-1 flex w-full items-center justify-between rounded-[1rem] px-3 py-3 text-left text-sm transition ${
                              selected
                                ? "bg-white/12 text-white"
                                : "text-white/72 hover:bg-white/8 hover:text-white"
                            } disabled:cursor-not-allowed disabled:text-white/30`}
                          >
                            <span>
                              {track.label}
                              <span className="ml-2 text-xs text-white/40">
                                {track.language}
                              </span>
                            </span>
                            <span className="text-xs">
                              {selected ? "Selected" : playable ? "" : "Stored only"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-sm leading-6 text-white/65">
                      {audioStatusMessage}
                    </p>
                    {audioSelectionMode === "auto" && selectedAudioTrackId ? (
                      <p className="text-xs leading-5 text-[#d1c5b8]">
                        System language matching selected the current external
                        audio track automatically.
                      </p>
                    ) : null}
                  </MenuPanel>
                ) : null}
                {controller.activeMenu === "subtitles" ? (
                  <MenuPanel title="Subtitles">
                    <div className="rounded-2xl border border-white/8 bg-white/4 p-1.5">
                      <button
                        type="button"
                        onClick={() => controller.handleSelectSubtitleTrack(null)}
                        className={`flex w-full items-center justify-between rounded-[1rem] px-3 py-3 text-left text-sm transition ${
                          selectedSubtitleTrackId == null
                            ? "bg-white/12 text-white"
                            : "text-white/72 hover:bg-white/8 hover:text-white"
                        }`}
                      >
                        <span>Off</span>
                        {selectedSubtitleTrackId == null ? <span>Selected</span> : null}
                      </button>
                      {subtitleTracks.map((track) => {
                        const selected = selectedSubtitleTrackId === track.id;
                        const selectable = track.isRenderable && Boolean(track.url);

                        return (
                          <button
                            key={track.id}
                            type="button"
                            disabled={!selectable}
                            onClick={() =>
                              controller.handleSelectSubtitleTrack(track.id)
                            }
                            className={`mt-1 flex w-full items-center justify-between rounded-[1rem] px-3 py-3 text-left text-sm transition ${
                              selected
                                ? "bg-white/12 text-white"
                                : "text-white/72 hover:bg-white/8 hover:text-white"
                            } disabled:cursor-not-allowed disabled:text-white/30`}
                          >
                            <span>
                              {track.label}
                              <span className="ml-2 text-xs text-white/40">
                                {track.language}
                              </span>
                            </span>
                            <span className="text-xs">
                              {selected ? "Selected" : selectable ? "" : "Stored only"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-sm leading-6 text-white/65">
                      {subtitleStatusMessage}
                    </p>
                  </MenuPanel>
                ) : null}
                {controller.activeMenu === "settings" ? (
                  <MenuPanel title="Playback">
                    <div className="grid gap-2 rounded-2xl border border-white/8 bg-white/4 p-3 text-sm text-white/72">
                      <div className="flex items-center justify-between gap-4">
                        <span>Target</span>
                        <span className="font-semibold text-white">
                          {playbackTarget === "cast" ? "Chromecast" : "Local player"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Primary clock</span>
                        <span className="font-semibold text-white">
                          {primaryClockLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Sync mode</span>
                        <span className="font-semibold text-white">
                          {syncModeLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Cast observer</span>
                        <span className="font-semibold text-white">
                          {castRemoteObserved ? "Listening" : "Waiting"}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-white/65">
                      {playbackStatusMessage}
                    </p>
                    {syncIssue ? (
                      <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm leading-6 text-rose-50">
                        {syncIssue}
                      </p>
                    ) : null}
                    <p className="text-xs leading-5 text-white/45">
                      Keyboard: Space or K play or pause, J or L or Left or Right
                      seek, F fullscreen.
                    </p>
                  </MenuPanel>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-4 sm:gap-8">
            <SurfaceActionButton
              label={`Seek backward ${seekStepSeconds} seconds`}
              onClick={() => controller.handleSeekRelative(-seekStepSeconds)}
            >
              <SeekIcon direction="backward" seconds={seekStepSeconds} />
            </SurfaceActionButton>
            <button
              type="button"
              aria-label={playbackStatus === "playing" ? "Pause" : "Play"}
              onClick={controller.handlePlayPause}
              className="flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-full border border-white/15 bg-white/12 text-white shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-2xl transition hover:scale-[1.02] hover:border-white/35 hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-[6rem] sm:w-[6rem]"
            >
              <PlaybackIcon paused={playbackStatus !== "playing"} />
            </button>
            <SurfaceActionButton
              label={`Seek forward ${seekStepSeconds} seconds`}
              onClick={() => controller.handleSeekRelative(seekStepSeconds)}
            >
              <SeekIcon direction="forward" seconds={seekStepSeconds} />
            </SurfaceActionButton>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
          <div className="rounded-[1.6rem] border border-white/10 bg-black/28 p-4 shadow-[0_12px_50px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
            <div className="relative">
              {isScrubbing && scrubPreviewTime != null ? (
                <div
                  className="pointer-events-none absolute bottom-7 -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-3 py-1 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
                  style={timelinePreviewStyle}
                >
                  {formatPlaybackSeconds(scrubPreviewTime)}
                </div>
              ) : null}
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
              <div
                className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white"
                style={timelineTrackStyle}
              />
              <input
                ref={timelineInputRef}
                type="range"
                min={0}
                max={controller.resolvedDurationSeconds}
                step={0.1}
                value={controller.timelineValue}
                onPointerDown={controller.scrubStart}
                onMouseDown={controller.scrubStart}
                onTouchStart={controller.scrubStart}
                onInput={(event) =>
                  controller.scrubPreview(Number(event.currentTarget.value))
                }
                onChange={(event) =>
                  controller.scrubPreview(Number(event.currentTarget.value))
                }
                onPointerUp={(event) =>
                  controller.scrubCommit(Number(event.currentTarget.value))
                }
                onMouseUp={(event) =>
                  controller.scrubCommit(Number(event.currentTarget.value))
                }
                onTouchEnd={(event) =>
                  controller.scrubCommit(Number(event.currentTarget.value))
                }
                onPointerCancel={controller.scrubCancel}
                onKeyUp={(event) => {
                  if (
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "Home" ||
                    event.key === "End" ||
                    event.key === "PageUp" ||
                    event.key === "PageDown"
                  ) {
                    controller.scrubCommit(Number(event.currentTarget.value));
                  }
                }}
                onBlur={() => {
                  if (controller.scrubState.phase === "scrubbing") {
                    controller.scrubCommit(Number(timelineInputRef.current?.value ?? 0));
                  }
                }}
                className="syncpass-timeline relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent"
                aria-label="Seek timeline"
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 text-sm text-white/76">
              <div className="flex items-center gap-3">
                <span className="min-w-[3.5rem] font-semibold text-white">
                  {formatPlaybackSeconds(controller.effectiveCurrentTime)}
                </span>
                <span className="text-white/40">/</span>
                <span>{formatPlaybackSeconds(controller.resolvedDurationSeconds)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.22em] text-white/48">
                <span>{playbackTarget === "cast" ? "Chromecast" : "Local"}</span>
                <span>{castStatus}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {controller.shouldRenderMiniShell ? (
        <div
          className="absolute inset-x-3 bottom-3 z-20 rounded-[1.4rem] border border-white/12 bg-black/72 p-3 shadow-[0_12px_36px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:hidden"
          onPointerDown={controller.handleActivity}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{title}</p>
              <p className="mt-1 text-xs text-white/62">
                {formatPlaybackSeconds(controller.effectiveCurrentTime)} /{" "}
                {formatPlaybackSeconds(controller.resolvedDurationSeconds)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => controller.handleSeekRelative(-seekStepSeconds)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white"
                aria-label={`Seek backward ${seekStepSeconds} seconds`}
              >
                <SeekIcon direction="backward" seconds={seekStepSeconds} />
              </button>
              <button
                type="button"
                onClick={controller.handlePlayPause}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/12 text-white"
                aria-label={playbackStatus === "playing" ? "Pause" : "Play"}
              >
                <PlaybackIcon paused={playbackStatus !== "playing"} />
              </button>
              <button
                type="button"
                onClick={() => controller.handleSeekRelative(seekStepSeconds)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white"
                aria-label={`Seek forward ${seekStepSeconds} seconds`}
              >
                <SeekIcon direction="forward" seconds={seekStepSeconds} />
              </button>
            </div>
          </div>
          <div className="mt-3 h-1 rounded-full bg-white/12">
            <div
              className="h-1 rounded-full bg-white"
              style={timelineTrackStyle}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
