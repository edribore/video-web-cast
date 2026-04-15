"use client";

import { io, type Socket } from "socket.io-client";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  prepareChromecastMediaForSession,
  subscribeToChromecastRemotePlayback,
  subscribeToChromecastRuntime,
  syncRoomPlaybackToChromecast,
  useChromecastAvailability,
  type ChromecastRemotePlaybackEvent,
  type ChromecastAvailabilityStatus,
} from "@/lib/chromecast";
import {
  getPreferredBrowserLanguages,
  resolvePreferredExternalAudioTrack,
} from "@/lib/audio-preferences";
import {
  assessAudioTrackPlaybackSupport,
  isPlayableAudioTrackSupport,
  type AudioTrackPlaybackSupport,
} from "@/lib/audio-track-playback";
import { createSafeId } from "@/lib/create-safe-id";
import {
  formatPlaybackSeconds,
  isPlaybackActivelyRunning,
  resolvePlaybackReconciliationProfileKey,
  resolveSynchronizedPlaybackTime,
  resolvePlaybackStartDelayMs,
  type PlaybackLeadershipMode,
} from "@/lib/playback";
import { getOrCreateParticipantSessionId } from "@/lib/participant-session";
import { logDebugEvent, setDebugLastActionSource } from "@/lib/debug-store";
import { useDebugFeatureFlags, useDebugRuntimeState } from "@/components/debug-runtime";
import type {
  ParticipantMediaPreferences,
  PlaybackStateSnapshot,
  PlaybackStatus,
} from "@/types/playback";
import type {
  RoomAudioTrackSummary,
  RoomScaffoldSnapshot,
  RoomSocketHydrationPayload,
  RoomSocketPlaybackSyncPayload,
  RoomSyncEvent,
  SharedRoomControlType,
  SharedRoomControlSource,
} from "@/types/room-sync";
import {
  RoomVideoPlayer,
  type RoomVideoPlayerHandle,
  type RoomVideoPlayerLocalAudioState,
  type RoomVideoPlayerSnapshot,
} from "@/components/room-video-player";
import { RoomPlaybackSurface } from "@/components/room-playback-surface";
import { useRoomPlaybackController } from "@/components/use-room-playback-controller";

type RoomPlayerScaffoldProps = { snapshot: RoomScaffoldSnapshot };
type RoomConnectionStatus = "connecting" | "connected" | "disconnected";
type PlaybackTarget = "local" | "cast";
type RoomActionSource =
  | "local_user"
  | "socket"
  | "socket_echo"
  | "cast_remote"
  | "cast_local_command"
  | "reconciliation"
  | "hydration"
  | "cast"
  | "system";

type RoomPlayerState = {
  playback: PlaybackStateSnapshot;
  observedPlayback: RoomVideoPlayerSnapshot | null;
  lastEvent: RoomSyncEvent | null;
  connectionStatus: RoomConnectionStatus;
  syncIssue: string | null;
  lastActionSource: RoomActionSource | null;
};

type RoomPlayerAction =
  | { type: "video_observed"; snapshot: RoomVideoPlayerSnapshot }
  | { type: "room_hydrated"; payload: RoomSocketHydrationPayload; source: RoomActionSource }
  | {
      type: "room_playback_sync";
      payload: RoomSocketPlaybackSyncPayload;
      source: RoomActionSource;
    }
  | { type: "connection_status"; status: RoomConnectionStatus }
  | { type: "sync_issue"; message: string | null }
  | { type: "last_action_source"; source: RoomActionSource | null };

const EMPTY_AUDIO_TRACKS: RoomAudioTrackSummary[] = [];
const EMPTY_LANGUAGES: string[] = [];

function buildSyntheticPlaybackSnapshot(
  playback: PlaybackStateSnapshot,
  type: SharedRoomControlType,
  options?: {
    deltaSeconds?: number;
    targetTimeSeconds?: number;
  },
) {
  const resolvedCurrentTime = resolveSynchronizedPlaybackTime(playback);
  const nextSeekTargetTime =
    typeof options?.targetTimeSeconds === "number"
      ? Math.max(0, options.targetTimeSeconds)
      : Math.max(0, resolvedCurrentTime + (options?.deltaSeconds ?? 0));

  switch (type) {
    case "play":
      return {
        status: "playing" as const,
        currentTime: resolvedCurrentTime,
        playbackRate: playback.playbackRate,
      };
    case "pause":
      return {
        status: "paused" as const,
        currentTime: resolvedCurrentTime,
        playbackRate: playback.playbackRate,
      };
    case "stop":
      return {
        status: "stopped" as const,
        currentTime: 0,
        playbackRate: playback.playbackRate,
      };
    case "seek":
      return {
        status: playback.status,
        currentTime: nextSeekTargetTime,
        playbackRate: playback.playbackRate,
      };
  }
}

function SocialCallPanel({
  playbackTarget,
  roomTitle,
}: {
  playbackTarget: PlaybackTarget;
  roomTitle: string;
}) {
  return (
    <section className="rounded-[1.8rem] border border-white/10 bg-[#17131a]/88 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
            Video call
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Companion stage
          </h3>
        </div>
        <span className="rounded-full bg-[#1b2838] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#cde0ff]">
          {playbackTarget === "cast" ? "TV mode" : "Local mode"}
        </span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(145deg,#2f3447,#161c28)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#d7c19d]">
            Host
          </p>
          <p className="mt-6 text-lg font-semibold text-white">Room control seat</p>
          <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
            {roomTitle} stays synchronized here while the call layer remains
            ready for the planned WebRTC surface.
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(145deg,#403027,#1f1714)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#d7c19d]">
            Guest
          </p>
          <p className="mt-6 text-lg font-semibold text-white">Reaction feed</p>
          <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
            This pane is reserved for face cams and reactions while playback
            stays anchored to a single destination.
          </p>
        </div>
      </div>
    </section>
  );
}

function SocialChatPanel({
  roomId,
  lastEventType,
}: {
  roomId: string;
  lastEventType: string | null;
}) {
  return (
    <section className="rounded-[1.8rem] border border-white/10 bg-[#17131a]/88 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.2)]">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
        Chat
      </p>
      <h3 className="mt-2 text-xl font-semibold text-white">
        Watch-room conversation
      </h3>
      <div className="mt-5 space-y-3">
        <div className="rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d7c19d]">
            Host notes
          </p>
          <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
            Room <span className="font-mono text-white">{roomId}</span> is ready
            for synchronized playback and companion-screen reactions.
          </p>
        </div>
        <div className="rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d7c19d]">
            Room activity
          </p>
          <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
            Latest shared event:{" "}
            <span className="font-semibold text-white">
              {lastEventType ?? "No shared action yet"}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function reducer(state: RoomPlayerState, action: RoomPlayerAction): RoomPlayerState {
  switch (action.type) {
    case "video_observed":
      return {
        ...state,
        observedPlayback: action.snapshot,
      };
    case "room_hydrated":
      return {
        ...state,
        playback: action.payload.playback,
        observedPlayback: state.observedPlayback,
        lastEvent: action.payload.lastEvent,
        syncIssue: null,
        lastActionSource: action.source,
      };
    case "room_playback_sync":
      return {
        ...state,
        playback: action.payload.playback,
        observedPlayback: state.observedPlayback,
        lastEvent: action.payload.event,
        syncIssue: null,
        lastActionSource: action.source,
      };
    case "connection_status":
      return { ...state, connectionStatus: action.status };
    case "sync_issue":
      return { ...state, syncIssue: action.message };
    case "last_action_source":
      return { ...state, lastActionSource: action.source };
  }
}

function getStatusTone(status: PlaybackStatus) {
  switch (status) {
    case "playing":
      return "bg-[#dff4e8] text-[#1e6a44]";
    case "paused":
      return "bg-[#fff0d6] text-[#8b5b11]";
    case "stopped":
      return "bg-[#efe3d6] text-[#6f5135]";
  }
}

function getConnectionTone(status: RoomConnectionStatus) {
  switch (status) {
    case "connected":
      return "bg-[#dff4e8] text-[#1e6a44]";
    case "connecting":
      return "bg-[#fff0d6] text-[#8b5b11]";
    case "disconnected":
      return "bg-[#f9dfdd] text-[#8a342f]";
  }
}

function getCastTone(status: ChromecastAvailabilityStatus) {
  switch (status) {
    case "connected":
      return "bg-[#dff4e8] text-[#1e6a44]";
    case "connecting":
      return "bg-[#fff0d6] text-[#8b5b11]";
    case "loading":
      return "bg-[#efeaf8] text-[#5b3f86]";
    case "available":
      return "bg-[#e7ecfb] text-[#244f8f]";
    case "error":
      return "bg-[#f9dfdd] text-[#8a342f]";
    case "unavailable":
      return "bg-[#efe3d6] text-[#6f5135]";
  }
}

function isHttpsUrl(urlValue: string | null | undefined) {
  return typeof urlValue === "string" && urlValue.startsWith("https://");
}

function createInitialParticipantPreferences(
  snapshot: RoomScaffoldSnapshot,
  preferredAudioLanguages: readonly string[],
): ParticipantMediaPreferences {
  const selectedSubtitleTrackId =
    snapshot.media?.subtitleTracks.find((track) => track.isDefault && track.isRenderable)?.id ??
    snapshot.media?.subtitleTracks.find((track) => track.isRenderable)?.id ??
    null;
  const resolvedAudioTrack = resolvePreferredExternalAudioTrack({
    audioTracks: snapshot.media?.audioTracks ?? EMPTY_AUDIO_TRACKS,
    preferredLanguages: preferredAudioLanguages,
  });

  return {
    audioSelectionMode: "auto",
    selectedAudioTrackId: resolvedAudioTrack.trackId,
    selectedSubtitleTrackId,
  };
}

function createInitialLocalAudioState(
  snapshot: RoomScaffoldSnapshot,
): RoomVideoPlayerLocalAudioState {
  return {
    selectedSource: "embedded",
    selectedAudioTrackId: null,
    activeSource: snapshot.media?.videoUrl ? "embedded" : "none",
    activeTrackId: null,
    intendedAudibleSource: snapshot.media?.videoUrl ? "embedded" : "none",
    embeddedAudioActive: Boolean(snapshot.media?.videoUrl),
    externalAudioActive: false,
    externalAudioAttached: false,
    externalAudioSynchronized: false,
    suppressLocalAudioOutput: false,
    videoMuted: false,
    externalAudioMuted: true,
    issue: null,
  };
}

function areLocalAudioStatesEqual(
  left: RoomVideoPlayerLocalAudioState,
  right: RoomVideoPlayerLocalAudioState,
) {
  return (
    left.selectedSource === right.selectedSource &&
    left.selectedAudioTrackId === right.selectedAudioTrackId &&
    left.activeSource === right.activeSource &&
    left.activeTrackId === right.activeTrackId &&
    left.intendedAudibleSource === right.intendedAudibleSource &&
    left.embeddedAudioActive === right.embeddedAudioActive &&
    left.externalAudioActive === right.externalAudioActive &&
    left.externalAudioAttached === right.externalAudioAttached &&
    left.externalAudioSynchronized === right.externalAudioSynchronized &&
    left.suppressLocalAudioOutput === right.suppressLocalAudioOutput &&
    left.videoMuted === right.videoMuted &&
    left.externalAudioMuted === right.externalAudioMuted &&
    left.issue === right.issue
  );
}

function resolveSharedRoomCommandSource(
  source: RoomActionSource,
): SharedRoomControlSource | null {
  if (
    source === "local_user" ||
    source === "cast_local_command" ||
    source === "cast_remote"
  ) {
    return source;
  }

  return null;
}

function resolvePlaybackSyncActionSource(input: {
  eventCommandSource: SharedRoomControlSource | null;
  pendingSource: RoomActionSource | null;
}): RoomActionSource {
  if (input.pendingSource === "cast_remote") {
    return "cast_remote";
  }

  if (input.pendingSource === "cast_local_command") {
    return "cast_local_command";
  }

  if (input.pendingSource) {
    return "socket_echo";
  }

  if (input.eventCommandSource === "cast_remote") {
    return "cast_remote";
  }

  if (input.eventCommandSource === "cast_local_command") {
    return "cast_local_command";
  }

  return "socket";
}

function resolvePlaybackLeadershipMode(input: {
  authoritativeCommandSource: SharedRoomControlSource | null;
  castRuntimeLeadershipMode: string | null;
  hasExternalAudio: boolean;
  isCastActive: boolean;
  isMobileClient: boolean;
  lastActionSource: RoomActionSource | null;
  lastEventActorSessionId: string | null;
  participantSessionId: string;
}): PlaybackLeadershipMode {
  if (input.isCastActive) {
    if (
      input.castRuntimeLeadershipMode === "cast_handoff" ||
      input.castRuntimeLeadershipMode === "cast_leader_stabilizing" ||
      input.castRuntimeLeadershipMode === "cast_leader_stable"
    ) {
      return input.castRuntimeLeadershipMode;
    }

    return "cast_leader_stabilizing";
  }

  if (
    input.authoritativeCommandSource === "cast_remote" ||
    input.authoritativeCommandSource === "cast_local_command"
  ) {
    return input.hasExternalAudio && input.isMobileClient
      ? "mobile_external_audio_follower"
      : input.hasExternalAudio
        ? "cast_driven_external_audio_follower"
        : "cast_driven_local_follower";
  }

  if (
    input.lastEventActorSessionId === input.participantSessionId &&
    (input.lastActionSource === "local_user" ||
      input.lastActionSource === "socket_echo")
  ) {
    return "local_leader";
  }

  if (input.hasExternalAudio && input.isMobileClient) {
    return "mobile_external_audio_follower";
  }

  return input.hasExternalAudio
    ? "local_external_audio_follower"
    : "local_follower";
}

export function RoomPlayerScaffold({ snapshot }: RoomPlayerScaffoldProps) {
  const [state, dispatch] = useReducer(reducer, {
    playback: snapshot.playback,
    observedPlayback: null,
    lastEvent: snapshot.lastEvent,
    connectionStatus: "connecting" as RoomConnectionStatus,
    syncIssue: null,
    lastActionSource: null,
  });
  const [participantSessionId] = useState(() =>
    typeof window !== "undefined" ? getOrCreateParticipantSessionId() : "",
  );
  const [preferredAudioLanguages] = useState(() =>
    getPreferredBrowserLanguages(),
  );
  const [isMobileClient] = useState(() =>
    typeof navigator !== "undefined"
      ? /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
      : false,
  );
  const [participantPreferences, setParticipantPreferences] =
    useState<ParticipantMediaPreferences>(() =>
      createInitialParticipantPreferences(snapshot, preferredAudioLanguages),
    );
  const [localAudioState, setLocalAudioState] = useState<RoomVideoPlayerLocalAudioState>(
    () => createInitialLocalAudioState(snapshot),
  );
  const [pendingCommandCount, setPendingCommandCount] = useState(0);
  const [castRuntimeState, setCastRuntimeState] = useState<Record<string, unknown>>(
    {},
  );
  const playerRef = useRef<RoomVideoPlayerHandle>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingClientEventIdsRef = useRef<Map<string, RoomActionSource>>(new Map());
  const authoritativePlaybackRef = useRef(snapshot.playback);
  const participantPreferencesRef = useRef(participantPreferences);
  const castStatusRef = useRef<ChromecastAvailabilityStatus>("unavailable");
  const scheduledCastPlaybackTimerRef = useRef<number | null>(null);
  const {
    castStatus,
    castIssue,
    castIssueCode,
    canRequestSession,
    isCastActive,
    requestChromecastSession,
    endChromecastSession,
  } = useChromecastAvailability();
  const castDisplayStatus: ChromecastAvailabilityStatus = castStatus;
  const playbackTarget: PlaybackTarget = isCastActive ? "cast" : "local";
  const roomDisplayTitle =
    snapshot.movie?.title ?? snapshot.media?.title ?? "SyncPass room";
  const visibleCastIssue =
    castDisplayStatus === "loading" || castDisplayStatus === "available"
      ? null
      : castIssue;
  const appUsesSecurePublicOrigin = isHttpsUrl(snapshot.shareUrl);
  const castUsesSecurePublicOrigin = isHttpsUrl(snapshot.media?.castVideoUrl);
  const castOriginSummary = snapshot.origins.castMediaOrigin ?? "not configured";
  const mediaOriginSummary = snapshot.origins.mediaOrigin ?? "local relative URLs";
  const appOriginSummary = snapshot.origins.appOrigin ?? "local relative URLs";
  const audioTracks = snapshot.media?.audioTracks ?? EMPTY_AUDIO_TRACKS;
  const resolvedAutomaticAudioTrack = resolvePreferredExternalAudioTrack({
    audioTracks,
    preferredLanguages: preferredAudioLanguages,
  });
  const requestedAudioTrackId =
    participantPreferences.audioSelectionMode === "auto"
      ? resolvedAutomaticAudioTrack.trackId
      : participantPreferences.selectedAudioTrackId;
  const castPreferredAudioLanguages =
    participantPreferences.audioSelectionMode === "auto"
      ? preferredAudioLanguages
      : EMPTY_LANGUAGES;
  const audioTrackSupport = useMemo<Record<string, AudioTrackPlaybackSupport>>(() => {
    if (typeof document === "undefined") {
      return {};
    }

    const audioProbe = document.createElement("audio");

    return Object.fromEntries(
      audioTracks.map((track) => [
        track.id,
        assessAudioTrackPlaybackSupport(track, (mimeType) =>
          audioProbe.canPlayType(mimeType),
        ),
      ]),
    );
  }, [audioTracks]);
  const playableAudioTracks = audioTracks.filter((track) =>
    isPlayableAudioTrackSupport(audioTrackSupport[track.id]),
  );
  const unavailableAudioTrackCount = audioTracks.length - playableAudioTracks.length;
  const effectiveSelectedAudioTrackId =
    requestedAudioTrackId &&
    isPlayableAudioTrackSupport(audioTrackSupport[requestedAudioTrackId])
      ? requestedAudioTrackId
      : null;
  const selectedExternalAudioTrack =
    audioTracks.find(
      (track) => track.id === effectiveSelectedAudioTrackId,
    ) ?? null;
  const castFallbackApplied = castRuntimeState.castFallbackApplied === true;
  const castFallbackReason =
    typeof castRuntimeState.castFallbackReason === "string"
      ? castRuntimeState.castFallbackReason
      : null;
  const resolvedEffectiveCastAudioTrackId =
    typeof castRuntimeState.resolvedEffectiveAudioTrackId === "string"
      ? castRuntimeState.resolvedEffectiveAudioTrackId
      : null;
  const resolvedEffectiveCastSubtitleTrackId =
    typeof castRuntimeState.resolvedEffectiveSubtitleTrackId === "string"
      ? castRuntimeState.resolvedEffectiveSubtitleTrackId
      : null;
  const resolvedEffectiveCastSubtitleTrack =
    (snapshot.media?.subtitleTracks ?? []).find(
      (track) => track.id === resolvedEffectiveCastSubtitleTrackId,
    ) ?? null;
  const castRemotePlayerObserved = castRuntimeState.remotePlayerObserved === true;
  const effectiveCastAudioTrack =
    audioTracks.find((track) => track.id === resolvedEffectiveCastAudioTrackId) ?? null;
  const localSelectedSubtitleTrack =
    (snapshot.media?.subtitleTracks ?? []).find(
      (track) => track.id === participantPreferences.selectedSubtitleTrackId,
    ) ?? null;
  const castAudioFallbackVisible =
    isCastActive &&
    requestedAudioTrackId != null &&
    castFallbackApplied;
  const castAudioStatusMessage = !isCastActive
    ? null
    : effectiveCastAudioTrack
      ? `Chromecast audio is using ${effectiveCastAudioTrack.label}.`
      : requestedAudioTrackId
        ? castFallbackApplied
          ? "Chromecast is using the base video audio instead of the selected external audio."
          : "Chromecast audio is using the resolved base video audio."
        : "Chromecast audio is using the base video audio.";
  const displayedLocalAudioState =
    playbackTarget === "cast"
      ? {
          ...localAudioState,
          activeSource: "none" as const,
          activeTrackId: null,
          intendedAudibleSource: "none" as const,
          embeddedAudioActive: false,
          externalAudioActive: false,
          externalAudioAttached: false,
          externalAudioSynchronized: false,
          suppressLocalAudioOutput: true,
          videoMuted: true,
          externalAudioMuted: true,
          issue: null,
        }
      : localAudioState;
  const resolvedAuthoritativeCurrentTime = resolveSynchronizedPlaybackTime(
    state.playback,
  );
  const playbackAwaitingScheduledStart =
    state.playback.status === "playing" &&
    !isPlaybackActivelyRunning(state.playback);
  const authoritativeCommandSource = state.lastEvent?.commandSource ?? null;
  const castRuntimeLeadershipMode =
    typeof castRuntimeState.castRemoteLeadershipMode === "string"
      ? castRuntimeState.castRemoteLeadershipMode
      : null;
  const playbackLeadershipMode = resolvePlaybackLeadershipMode({
    authoritativeCommandSource,
    castRuntimeLeadershipMode,
    hasExternalAudio: Boolean(selectedExternalAudioTrack),
    isCastActive,
    isMobileClient,
    lastActionSource: state.lastActionSource,
    lastEventActorSessionId: state.lastEvent?.actorSessionId ?? null,
    participantSessionId,
  });
  const reconciliationProfileKey = resolvePlaybackReconciliationProfileKey({
    hasExternalAudio: Boolean(selectedExternalAudioTrack),
    isMobile: isMobileClient,
    leadershipMode: playbackLeadershipMode,
  });
  const surfaceCurrentTime =
    state.observedPlayback?.currentTime ?? resolvedAuthoritativeCurrentTime;
  const surfaceDurationSeconds =
    state.observedPlayback?.duration ?? snapshot.media?.durationSeconds ?? null;
  const surfaceSubtitleStatusMessage = isCastActive
    ? `Chromecast subtitles are using ${resolvedEffectiveCastSubtitleTrack?.label ?? "no subtitle track"}.`
    : `Local subtitles are using ${localSelectedSubtitleTrack?.label ?? "no subtitle track"}.`;
  const surfacePlaybackStatusMessage = playbackTarget === "cast"
    ? castRemotePlayerObserved
      ? "Chromecast remote actions and web controls both flow back through the authoritative room playback anchor."
      : "Chromecast is holding the room timeline while the receiver observer finishes attaching."
    : playbackAwaitingScheduledStart
      ? `Shared playback is staged and will start together in about ${Math.ceil(resolvePlaybackStartDelayMs(state.playback) / 100) / 10}s.`
      : "Shared controls update the room anchor first, then local playback reconciles to that authoritative state.";
  const surfacePrimaryClockLabel = playbackTarget === "cast"
    ? "Chromecast receiver"
    : state.observedPlayback?.primaryClockSource === "external_audio"
      ? "External audio"
      : "Embedded video";
  const surfaceSyncModeLabel = playbackTarget === "cast"
    ? "Authoritative room sync mirrored to Chromecast"
    : state.observedPlayback?.syncMode === "external_audio_mode"
      ? "External audio clock with gentle video follow"
      : "Embedded media clock";

  function handleAudioTrackSelection(nextAudioTrackId: string | null) {
    setParticipantPreferences((currentPreferences) => ({
      ...currentPreferences,
      audioSelectionMode: "manual",
      selectedAudioTrackId: nextAudioTrackId,
    }));
    setDebugLastActionSource("local_user");
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "Changed local audio source.",
      source: "local_user",
      data: { nextAudioTrackId },
    });
  }

  function handleSubtitleTrackSelection(nextSubtitleTrackId: string | null) {
    setParticipantPreferences((currentPreferences) => ({
      ...currentPreferences,
      selectedSubtitleTrackId: nextSubtitleTrackId,
    }));
    setDebugLastActionSource("local_user");
    logDebugEvent({
      level: "info",
      category: "playback",
      message: "Changed local subtitles.",
      source: "local_user",
      data: { nextSubtitleTrackId },
    });
  }

  const clearScheduledCastPlaybackTimer = useEffectEvent(() => {
    if (scheduledCastPlaybackTimerRef.current != null) {
      window.clearTimeout(scheduledCastPlaybackTimerRef.current);
      scheduledCastPlaybackTimerRef.current = null;
    }
  });

  useDebugFeatureFlags({
    localPlaybackEnabled: true,
    roomSyncEnabled: true,
    castEnabled: true,
    debugExportEnabled: true,
    subtitleRenderingEnabled: true,
    alternateAudioTrackSupportEnabled: true,
  });

  useDebugRuntimeState("room/live", {
    roomId: snapshot.roomId,
    playbackTarget,
    movie: snapshot.movie,
    sharePath: snapshot.sharePath,
    shareUrl: snapshot.shareUrl,
    origins: snapshot.origins,
    participantSessionId,
    connectionStatus: state.connectionStatus,
    playback: state.playback,
    resolvedAuthoritativeCurrentTime,
    playbackAwaitingScheduledStart,
    playbackVersion: state.playback.version,
    authoritativeCommandSource,
    playbackLeadershipMode,
    reconciliationProfileKey,
    playbackAnchor: {
      anchorMediaTime: state.playback.anchorMediaTime,
      anchorWallClockMs: state.playback.anchorWallClockMs,
      scheduledStartWallClockMs: state.playback.scheduledStartWallClockMs,
      sourceClientEventId: state.playback.sourceClientEventId,
    },
    observedPlayback: state.observedPlayback,
    lastEvent: state.lastEvent,
    syncIssue: state.syncIssue,
    participantPreferences,
    cast: {
      status: castDisplayStatus,
      issue: castIssue,
      issueCode: castIssueCode,
      active: isCastActive,
      canRequestSession,
      fallbackApplied: castFallbackApplied,
      fallbackReason: castFallbackReason,
      resolvedEffectiveAudioTrackId: resolvedEffectiveCastAudioTrackId,
      resolvedEffectiveSubtitleTrackId: resolvedEffectiveCastSubtitleTrackId,
      remotePlayerObserved: castRemotePlayerObserved,
    },
    castRuntimeState,
    localAudio: displayedLocalAudioState,
    media: snapshot.media,
    videoUrl: snapshot.media?.videoUrl ?? null,
    absoluteVideoUrl: snapshot.media?.absoluteVideoUrl ?? null,
    castVideoUrl: snapshot.media?.castVideoUrl ?? null,
    subtitleTracks: snapshot.media?.subtitleTracks ?? [],
    audioTracks,
    audioTrackSupport,
    lastActionSource: state.lastActionSource,
    pendingCommandCount,
  });

  const applyAuthoritativePlayback = useEffectEvent(
    async (playback: PlaybackStateSnapshot, source: RoomActionSource) => {
      authoritativePlaybackRef.current = playback;
      setDebugLastActionSource(source);
      const player = playerRef.current;

      if (player) {
        await player.applySharedPlayback(playback);
      }

      if (castStatusRef.current === "connected") {
        try {
          clearScheduledCastPlaybackTimer();
          await syncRoomPlaybackToChromecast(
            snapshot.roomId,
            snapshot.media,
            playback,
            participantPreferencesRef.current.selectedAudioTrackId,
            participantPreferencesRef.current.selectedSubtitleTrackId,
            participantPreferencesRef.current.audioSelectionMode === "auto"
              ? preferredAudioLanguages
              : [],
          );

          const scheduledCastStartDelayMs = resolvePlaybackStartDelayMs(playback);

          if (scheduledCastStartDelayMs > 0) {
            scheduledCastPlaybackTimerRef.current = window.setTimeout(() => {
              scheduledCastPlaybackTimerRef.current = null;
              void syncRoomPlaybackToChromecast(
                snapshot.roomId,
                snapshot.media,
                authoritativePlaybackRef.current,
                participantPreferencesRef.current.selectedAudioTrackId,
                participantPreferencesRef.current.selectedSubtitleTrackId,
                participantPreferencesRef.current.audioSelectionMode === "auto"
                  ? preferredAudioLanguages
                  : [],
              ).catch((error) => {
                logDebugEvent({
                  level: "error",
                  category: "cast",
                  message:
                    "Chromecast could not apply the scheduled shared playback start.",
                  source,
                  data: error,
                });
              });
            }, scheduledCastStartDelayMs);
          }
        } catch (error) {
          const message = "Room playback updated, but Chromecast could not mirror it.";
          logDebugEvent({
            level: "error",
            category: "cast",
            message,
            source,
            data: error,
          });
        }
      }
    },
  );

  function emitSharedRoomCommand(
    command: {
      type: SharedRoomControlType;
      status: PlaybackStatus;
      currentTime: number;
      playbackRate: number;
    },
    source: RoomActionSource,
  ) {
    dispatch({ type: "last_action_source", source });
    setDebugLastActionSource(source);

    const socket = socketRef.current;

    if (!socket?.connected) {
      const message = "Room sync is offline, so this change stayed local.";
      dispatch({ type: "sync_issue", message });
      logDebugEvent({
        level: "warn",
        category: "socket",
        message,
        source,
      });
      return false;
    }

    const clientEventId = createSafeId("room-command");
    pendingClientEventIdsRef.current.set(clientEventId, source);
    setPendingCommandCount(pendingClientEventIdsRef.current.size);
    socket.emit("room:command", {
      roomId: snapshot.roomId,
      actorSessionId: participantSessionId,
      clientEventId,
      type: command.type,
      status: command.status,
      currentTime: command.currentTime,
      playbackRate: command.playbackRate,
      commandSource: resolveSharedRoomCommandSource(source),
    });
    logDebugEvent({
      level: "info",
      category: "sync",
      message:
        source === "cast_remote"
          ? `Emitted shared ${command.type} from Chromecast remote input.`
          : `Emitted shared ${command.type}.`,
      source,
      data: { clientEventId, currentTime: command.currentTime },
    });
    return true;
  }

  function getCurrentPlaybackCommandSnapshot() {
    const player = playerRef.current;

    if (player) {
      return player.getSnapshot();
    }

    return (
      state.observedPlayback ?? {
        currentTime: resolvedAuthoritativeCurrentTime,
        videoCurrentTime: resolvedAuthoritativeCurrentTime,
        audibleCurrentTime: null,
        duration: snapshot.media?.durationSeconds ?? null,
        avDriftSeconds: null,
        primaryClockSource: selectedExternalAudioTrack ? "external_audio" : "video",
        syncMode: selectedExternalAudioTrack
          ? "external_audio_mode"
          : "embedded_audio_mode",
        playbackRate: state.playback.playbackRate,
        status: state.playback.status,
      }
    );
  }

  async function applyLocalPlaybackIntent(
    type: SharedRoomControlType,
    options?: {
      deltaSeconds?: number;
      targetTimeSeconds?: number;
    },
  ) {
    const player = playerRef.current;

    if (!player) {
      return null;
    }

    if (type === "play") {
      return player.play();
    }

    if (type === "pause") {
      return player.pause();
    }

    if (type === "stop") {
      return player.stop();
    }

    if (typeof options?.targetTimeSeconds === "number") {
      return player.seekTo(options.targetTimeSeconds);
    }

    return player.seekBy(options?.deltaSeconds ?? 0);
  }

  async function dispatchSharedCommand(
    type: SharedRoomControlType,
    options?: {
      deltaSeconds?: number;
      targetTimeSeconds?: number;
    },
  ) {
    const player = playerRef.current;
    const commandSource: RoomActionSource =
      playbackTarget === "cast" ? "cast_local_command" : "local_user";
    const socketConnected = Boolean(socketRef.current?.connected);

    if (!player || playbackTarget === "cast") {
      const syntheticSnapshot = buildSyntheticPlaybackSnapshot(
        authoritativePlaybackRef.current,
        type,
        options,
      );

      dispatch({
        type: "last_action_source",
        source: commandSource,
      });
      setDebugLastActionSource(commandSource);
      logDebugEvent({
        level: "info",
        category: "playback",
        message:
          playbackTarget === "cast"
            ? `Issued ${type} while Chromecast is the active playback destination.`
            : `Issued ${type} from the shared room controls.`,
        source: commandSource,
        data: {
          roomId: snapshot.roomId,
          syntheticSnapshot,
          playbackTarget,
        },
      });

      emitSharedRoomCommand(
        {
          type,
          status: syntheticSnapshot.status,
          currentTime: syntheticSnapshot.currentTime,
          playbackRate: syntheticSnapshot.playbackRate,
        },
        commandSource,
      );
      return;
    }

    try {
      if (!socketConnected) {
        const offlineSnapshot = await applyLocalPlaybackIntent(type, options);

        if (offlineSnapshot) {
          dispatch({ type: "video_observed", snapshot: offlineSnapshot });
        }

        dispatch({
          type: "sync_issue",
          message: "Room sync is offline, so this change stayed local.",
        });
        logDebugEvent({
          level: "warn",
          category: "socket",
          message: "Applied a local playback change while room sync was offline.",
          source: commandSource,
          data: {
            roomId: snapshot.roomId,
            type,
            offlineSnapshot,
          },
        });
        return;
      }

      const currentSnapshot = getCurrentPlaybackCommandSnapshot();
      const shouldOptimisticallyApplyLocally =
        type === "pause" ||
        type === "stop" ||
        (type === "seek" && authoritativePlaybackRef.current.status !== "playing");
      const optimisticSnapshot = shouldOptimisticallyApplyLocally
        ? await applyLocalPlaybackIntent(type, options)
        : null;

      if (optimisticSnapshot) {
        dispatch({ type: "video_observed", snapshot: optimisticSnapshot });
      }

      const nextCurrentTime =
        type === "stop"
          ? 0
          : type === "seek"
            ? optimisticSnapshot?.currentTime ??
              (typeof options?.targetTimeSeconds === "number"
                ? Math.max(0, options.targetTimeSeconds)
                : Math.max(0, currentSnapshot.currentTime + (options?.deltaSeconds ?? 0)))
            : optimisticSnapshot?.currentTime ?? currentSnapshot.currentTime;
      const nextStatus =
        type === "play"
          ? "playing"
          : type === "pause"
            ? "paused"
            : type === "stop"
              ? "stopped"
              : authoritativePlaybackRef.current.status;
      const nextPlaybackRate =
        optimisticSnapshot?.playbackRate ?? currentSnapshot.playbackRate;

      logDebugEvent({
        level: "info",
        category: "playback",
        message:
          shouldOptimisticallyApplyLocally
            ? `Issued ${type} and applied the local room player optimistically.`
            : `Issued ${type} and waited for the authoritative room anchor.`,
        source: commandSource,
        data: {
          roomId: snapshot.roomId,
          currentSnapshot,
          optimisticSnapshot,
          playbackTarget,
          type,
        },
      });

      emitSharedRoomCommand(
        {
          type,
          status: nextStatus,
          currentTime: nextCurrentTime,
          playbackRate: nextPlaybackRate,
        },
        commandSource,
      );
    } catch (error) {
      const message = "This browser could not apply the requested playback change.";
      dispatch({ type: "sync_issue", message });
      logDebugEvent({
        level: "error",
        category: "playback",
        message,
        source: commandSource,
        data: error,
      });
    }
  }

  function handlePlaybackSurfaceCommand(command: {
    type: SharedRoomControlType;
    deltaSeconds?: number;
    targetTimeSeconds?: number;
  }) {
    void dispatchSharedCommand(command.type, {
      deltaSeconds: command.deltaSeconds,
      targetTimeSeconds: command.targetTimeSeconds,
    });
  }

  const handleCastRemotePlayback = useEffectEvent(
    async (event: ChromecastRemotePlaybackEvent) => {
      if (castStatusRef.current !== "connected") {
        return;
      }

      logDebugEvent({
        level: "info",
        category: "cast",
        message: `Forwarding Chromecast remote ${event.type} into shared room sync.`,
        source: "cast_remote",
        data: event,
      });

      emitSharedRoomCommand(
        {
          type: event.type,
          status: event.status,
          currentTime: event.currentTime,
          playbackRate: event.playbackRate,
        },
        "cast_remote",
      );
    },
  );

  useEffect(() => {
    participantPreferencesRef.current = participantPreferences;
  }, [participantPreferences]);

  useEffect(() => {
    castStatusRef.current = castStatus;

    if (castStatus !== "connected") {
      clearScheduledCastPlaybackTimer();
    }
  }, [castStatus]);

  useEffect(() => {
    return subscribeToChromecastRuntime((snapshot) => {
      setCastRuntimeState(snapshot);
    });
  }, []);

  useEffect(() => {
    return subscribeToChromecastRemotePlayback((event) => {
      void handleCastRemotePlayback(event);
    });
  }, []);

  useEffect(() => {
    void applyAuthoritativePlayback(snapshot.playback, "hydration");

    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => {
      dispatch({ type: "connection_status", status: "connected" });
      logDebugEvent({
        level: "info",
        category: "socket",
        message: "Socket connected.",
        source: "system",
        data: { roomId: snapshot.roomId, socketId: socket.id },
      });
      socket.emit("room:join", {
        roomId: snapshot.roomId,
        actorSessionId: participantSessionId,
      });
    });

    socket.on("disconnect", (reason: string) => {
      dispatch({ type: "connection_status", status: "disconnected" });
      logDebugEvent({
        level: "warn",
        category: "socket",
        message: "Socket disconnected.",
        source: "system",
        data: { reason },
      });
    });

    socket.on("room:error", (payload: { message?: string }) => {
      const message = payload.message ?? "The room sync channel reported an error.";
      dispatch({ type: "sync_issue", message });
      logDebugEvent({
        level: "warn",
        category: "sync",
        message,
        source: "system",
        data: payload,
      });
    });

    socket.on("room:hydrated", async (payload: RoomSocketHydrationPayload) => {
      dispatch({ type: "room_hydrated", payload, source: "hydration" });
      logDebugEvent({
        level: "info",
        category: "sync",
        message: "Room hydrated from server state.",
        source: "hydration",
        data: payload,
      });
      await applyAuthoritativePlayback(payload.playback, "hydration");
    });

    socket.on("room:playback-sync", async (payload: RoomSocketPlaybackSyncPayload) => {
      const pendingSource = payload.sourceClientEventId
        ? pendingClientEventIdsRef.current.get(payload.sourceClientEventId) ?? null
        : null;
      const source = resolvePlaybackSyncActionSource({
        eventCommandSource: payload.event.commandSource,
        pendingSource,
      });

      if (payload.sourceClientEventId) {
        pendingClientEventIdsRef.current.delete(payload.sourceClientEventId);
        setPendingCommandCount(pendingClientEventIdsRef.current.size);
      }

      dispatch({ type: "room_playback_sync", payload, source });
      logDebugEvent({
        level: "info",
        category: "sync",
        message: `Applied shared ${payload.event.type}.`,
        source,
        data: payload,
      });
      await applyAuthoritativePlayback(payload.playback, source);
    });

    return () => {
      clearScheduledCastPlaybackTimer();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [participantSessionId, snapshot.playback, snapshot.roomId]);

  useEffect(() => {
    if (!castIssue || castStatus === "loading" || castStatus === "available") {
      return;
    }

    logDebugEvent({
      level: "warn",
      category: "cast",
      message: castIssue,
      source: "system",
    });
  }, [castIssue, castStatus]);

  useEffect(() => {
    logDebugEvent({
      level: "info",
      category: "cast",
      message: `Cast status: ${castDisplayStatus}.`,
      source: "system",
    });
  }, [castDisplayStatus]);

  useEffect(() => {
    if (castStatus !== "connected") {
      return;
    }

    void syncRoomPlaybackToChromecast(
      snapshot.roomId,
      snapshot.media,
      authoritativePlaybackRef.current,
      participantPreferences.selectedAudioTrackId,
      participantPreferences.selectedSubtitleTrackId,
      castPreferredAudioLanguages,
    )
      .catch((error) => {
        const message =
          "Cast stayed connected, but the selected audio or subtitle variant could not reload.";
        logDebugEvent({
          level: "error",
          category: "cast",
          message,
          source: "cast",
          data: error,
        });
      });
  }, [
    castStatus,
    participantPreferences.audioSelectionMode,
    participantPreferences.selectedAudioTrackId,
    participantPreferences.selectedSubtitleTrackId,
    castPreferredAudioLanguages,
    preferredAudioLanguages,
    snapshot.media,
    snapshot.roomId,
  ]);

  useEffect(() => {
    if (playbackTarget !== "local") {
      return;
    }

    void applyAuthoritativePlayback(authoritativePlaybackRef.current, "system");
  }, [playbackTarget]);

  async function handleCastButton() {
    if (isCastActive) {
      await endChromecastSession();
      return;
    }

    if (!snapshot.media?.castVideoUrl) {
      const message =
        "No LAN-safe Cast URL is available. Open the app from a LAN host or set PUBLIC_BASE_URL / PUBLIC_LAN_BASE_URL.";
      logDebugEvent({
        level: "warn",
        category: "cast",
        message,
        source: "local_user",
      });
      return;
    }

    try {
      await prepareChromecastMediaForSession(
        snapshot.roomId,
        snapshot.media,
        participantPreferences.selectedAudioTrackId,
        participantPreferences.selectedSubtitleTrackId,
        castPreferredAudioLanguages,
      );
    } catch (error) {
      logDebugEvent({
        level: "warn",
        category: "cast",
        message:
          "Cast start was blocked before requesting a session because the selected media variant could not be prepared.",
        source: "local_user",
        data: error,
      });
      return;
    }

    await requestChromecastSession();
  }

  const playbackController = useRoomPlaybackController({
    currentTimeSeconds: surfaceCurrentTime,
    durationSeconds: surfaceDurationSeconds,
    isMobileClient,
    playbackStatus: state.playback.status,
    onCastToggle: () => {
      void handleCastButton();
    },
    onRequestCommand: handlePlaybackSurfaceCommand,
    onSelectAudioTrack: handleAudioTrackSelection,
    onSelectSubtitleTrack: handleSubtitleTrackSelection,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
      <section
        data-debug-room-sync="true"
        className="rounded-[2rem] border border-white/10 bg-[#151117]/90 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-[#1d2a3a] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#cde0ff]">
                Playback {playbackTarget}
              </span>
              {snapshot.movie?.releaseLabel ? (
                <span className="rounded-full bg-[#2a1d1a] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#f2c99a]">
                  {snapshot.movie.releaseLabel}
                </span>
              ) : null}
            </div>
            <p className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
              SyncPass room
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {roomDisplayTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#c7c2ca]">
              {playbackTarget === "local"
                ? "The browser is the active playback destination. Shared room controls, alternate audio, subtitles, and sync all land directly on this local player."
                : "Chromecast is the active playback destination. The browser is now the companion control surface for playback, call, and chat while the TV holds the media session."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${getConnectionTone(
                state.connectionStatus,
              )}`}
            >
              Room {state.connectionStatus}
            </div>
            <div
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${getCastTone(
                castDisplayStatus,
              )}`}
            >
              Cast {castDisplayStatus}
            </div>
            {playbackTarget === "cast" || !snapshot.media?.videoUrl ? (
              <button
                type="button"
                onClick={() => void handleCastButton()}
                disabled={
                  castDisplayStatus === "loading" ||
                  castDisplayStatus === "connecting" ||
                  (!isCastActive && !canRequestSession)
                }
                data-debug-cast-button="true"
                className="rounded-full border border-white/10 bg-black/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-[#8c8a91]"
              >
                {isCastActive
                  ? "End Cast"
                  : castDisplayStatus === "loading"
                    ? "Checking Cast..."
                    : castDisplayStatus === "connecting"
                    ? "Connecting Cast..."
                    : "Start Cast"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-8">
          <RoomPlaybackSurface
            controller={playbackController}
            title={roomDisplayTitle}
            subtitle={
              snapshot.movie?.releaseLabel ??
              (playbackTarget === "cast"
                ? "Chromecast companion controls"
                : "Shared room playback")
            }
            isMobileClient={isMobileClient}
            playbackTarget={playbackTarget}
            playbackStatus={state.playback.status}
            audioTracks={audioTracks}
            audioTrackSupport={audioTrackSupport}
            selectedAudioTrackId={effectiveSelectedAudioTrackId}
            audioSelectionMode={participantPreferences.audioSelectionMode}
            subtitleTracks={snapshot.media?.subtitleTracks ?? []}
            selectedSubtitleTrackId={participantPreferences.selectedSubtitleTrackId}
            audioStatusMessage={
              playbackTarget === "cast"
                ? castAudioStatusMessage ?? "Chromecast is using the base video audio."
                : displayedLocalAudioState.activeSource === "external"
                  ? `External audio track active${selectedExternalAudioTrack ? `: ${selectedExternalAudioTrack.label}.` : "."}`
                  : displayedLocalAudioState.activeSource === "embedded"
                    ? "Embedded video audio active."
                    : "No local audio source is active yet."
            }
            subtitleStatusMessage={surfaceSubtitleStatusMessage}
            playbackStatusMessage={surfacePlaybackStatusMessage}
            castStatus={castDisplayStatus}
            canToggleCast={
              !(
                castDisplayStatus === "loading" ||
                castDisplayStatus === "connecting" ||
                (!isCastActive && !canRequestSession)
              )
            }
            primaryClockLabel={surfacePrimaryClockLabel}
            syncModeLabel={surfaceSyncModeLabel}
            syncIssue={state.syncIssue}
            castRemoteObserved={castRemotePlayerObserved}
          >
            {playbackTarget === "local" ? (
              <RoomVideoPlayer
                ref={playerRef}
                roomId={snapshot.roomId}
                title={snapshot.media?.title ?? "Uploaded media"}
                videoUrl={snapshot.media?.videoUrl ?? null}
                leadershipMode={playbackLeadershipMode}
                reconciliationProfileKey={reconciliationProfileKey}
                audioTracks={audioTracks}
                audioTrackSupport={audioTrackSupport}
                selectedAudioTrackId={effectiveSelectedAudioTrackId}
                subtitleTracks={snapshot.media?.subtitleTracks ?? []}
                selectedSubtitleTrackId={participantPreferences.selectedSubtitleTrackId}
                playbackRate={state.playback.playbackRate}
                suppressLocalAudioOutput={false}
                onAudioStateChange={(nextLocalAudioState) =>
                  setLocalAudioState((currentLocalAudioState) =>
                    areLocalAudioStatesEqual(currentLocalAudioState, nextLocalAudioState)
                      ? currentLocalAudioState
                      : nextLocalAudioState,
                  )
                }
                onObservedStateChange={(playerSnapshot) =>
                  dispatch({ type: "video_observed", snapshot: playerSnapshot })
                }
                onSyncIssueChange={(message) =>
                  dispatch({ type: "sync_issue", message })
                }
                className="h-full w-full"
              />
            ) : (
              <div
                className="relative h-full w-full bg-[radial-gradient(circle_at_top,#152033,#04070d_62%)]"
                style={
                  snapshot.movie?.posterUrl
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(4,7,13,0.82), rgba(4,7,13,0.4)), url(${snapshot.movie.posterUrl})`,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }
                    : undefined
                }
              >
                <div className="absolute left-6 top-6 max-w-sm rounded-[1.5rem] border border-white/10 bg-black/30 px-5 py-4 backdrop-blur-xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#8fa7c7]">
                    Cast companion mode
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    The TV is holding the room timeline.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#d4d0d8]">
                    Shared room commands, scrub commits, and Chromecast remote actions
                    all converge through the same authoritative playback anchor.
                  </p>
                </div>
                <div className="absolute bottom-6 left-6 max-w-md rounded-[1.5rem] border border-white/10 bg-black/32 px-5 py-4 backdrop-blur-xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#d7c19d]">
                    Effective Cast media
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#d4d0d8]">
                    {castAudioStatusMessage}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#d4d0d8]">
                    {surfaceSubtitleStatusMessage}
                  </p>
                </div>
              </div>
            )}
          </RoomPlaybackSurface>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.6rem] border border-white/10 bg-black/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#8fa7c7]">
              Audio routing
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d4d0d8]">
              {playbackTarget === "cast"
                ? castAudioStatusMessage
                : displayedLocalAudioState.activeSource === "external"
                  ? `External audio remains the audible clock${selectedExternalAudioTrack ? ` through ${selectedExternalAudioTrack.label}.` : "."}`
                  : "Embedded video audio is currently the audible clock."}
            </p>
            {participantPreferences.audioSelectionMode === "auto" &&
            requestedAudioTrackId ? (
              <p className="mt-2 text-xs leading-6 text-[#9e9aa2]">
                System language matching selected this external audio track automatically.
              </p>
            ) : null}
            {displayedLocalAudioState.issue && playbackTarget === "local" ? (
              <p className="mt-2 text-xs leading-6 text-[#ffd6d5]">
                {displayedLocalAudioState.issue}
              </p>
            ) : null}
          </div>
          <div className="rounded-[1.6rem] border border-white/10 bg-black/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#8fa7c7]">
              Subtitle routing
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d4d0d8]">
              {surfaceSubtitleStatusMessage}
            </p>
            {(snapshot.media?.subtitleTracks ?? []).length > 0 &&
            (snapshot.media?.subtitleTracks ?? []).every((track) => !track.isRenderable) ? (
              <p className="mt-2 text-xs leading-6 text-[#9e9aa2]">
                Subtitle files are stored for this room, but none are in a browser-renderable WebVTT form yet.
              </p>
            ) : null}
          </div>
          <div className="rounded-[1.6rem] border border-white/10 bg-black/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#8fa7c7]">
              Room sync
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d4d0d8]">
              {playbackTarget === "cast"
                ? castRemotePlayerObserved
                  ? "Chromecast remote play, pause, and seek actions are actively feeding back into the room state."
                  : "Waiting for the remote player observer to attach to the current Cast media session."
                : "Local playback still follows the room anchor, and scrub commits only emit a single authoritative shared seek when you release the timeline."}
            </p>
          </div>
        </div>

        {playbackAwaitingScheduledStart ? (
          <div className="mt-6 rounded-3xl border border-[#27415f]/35 bg-[#111d2c] px-5 py-4 text-sm leading-6 text-[#d9e8ff]">
            Shared playback has been staged and will begin together in about{" "}
            {Math.ceil(resolvePlaybackStartDelayMs(state.playback) / 100) / 10}s.
          </div>
        ) : null}

        {state.syncIssue ? (
          <div className="mt-6 rounded-3xl border border-[#6e2a2e]/35 bg-[#2d1417] px-5 py-4 text-sm leading-6 text-[#ffd6d5]">
            {state.syncIssue}
          </div>
        ) : null}

        {visibleCastIssue ? (
          <div className="mt-6 rounded-3xl border border-[#27415f]/35 bg-[#111d2c] px-5 py-4 text-sm leading-6 text-[#d9e8ff]">
            {visibleCastIssue}
          </div>
        ) : null}

        {castAudioFallbackVisible ? (
          <div className="mt-6 rounded-3xl border border-[#6e2a2e]/35 bg-[#2d1417] px-5 py-4 text-sm leading-6 text-[#ffd6d5]">
            {castFallbackReason ??
              "Chromecast is using the base video audio because the selected external audio could not be prepared for Cast."}
          </div>
        ) : null}

        {!snapshot.media?.castVideoUrl ? (
          <div className="mt-6 rounded-3xl border border-white/10 bg-black/20 px-5 py-4 text-sm leading-6 text-[#c7c2ca]">
            Cast needs a reachable media origin. Set `PUBLIC_BASE_URL` or `CAST_BASE_URL` to an HTTPS tunnel such as ngrok for the most reliable sender setup.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 rounded-[2rem] border border-white/10 bg-black/20 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[#8fa7c7]">
              Share this room
            </p>
            <div className="mt-3 rounded-2xl border border-white/10 bg-[#120e13] px-4 py-3 font-mono text-sm text-white">
              {snapshot.shareUrl}
            </div>
            <p className="mt-3 text-xs leading-6 text-[#c7c2ca]">
              Shared controls affect everyone. Language selectors stay per participant and drive this browser plus its active Cast session.
            </p>
            <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-[#120e13] px-4 py-3 text-xs leading-6 text-[#b3afba]">
              <p>
                App origin: <span className="font-mono text-white">{appOriginSummary}</span>
              </p>
              <p>
                Media origin: <span className="font-mono text-white">{mediaOriginSummary}</span>
              </p>
              <p>
                Cast media origin:{" "}
                <span className="font-mono text-white">{castOriginSummary}</span>
              </p>
              <p>
                {castUsesSecurePublicOrigin
                  ? "Secure Cast media origin is configured for tunnel-based testing."
                  : snapshot.media?.castVideoUrl
                    ? "Cast currently relies on a non-HTTPS or local-network media origin. Configure PUBLIC_BASE_URL or CAST_BASE_URL for HTTPS tunnel testing."
                    : "No Cast media URL is configured yet."}
              </p>
              <p>
                {appUsesSecurePublicOrigin
                  ? "Room links are using the configured secure public origin."
                  : "Room links are still using the current local origin."}
              </p>
            </div>
            {isCastActive ? (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d7c19d]">
                  Cast active
                </p>
                <p className="text-xs leading-6 text-[#c7c2ca]">
                  {castRemotePlayerObserved
                    ? "Chromecast remote playback observation is active."
                    : "Chromecast remote playback observation is waiting for an active media session."}
                </p>
              </div>
            ) : null}
          </div>
          <div className="grid gap-4">
            <div className="rounded-[1.4rem] border border-white/10 bg-[#120e13] px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d7c19d]">
                Player menus
              </p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Audio, subtitles, settings, fullscreen, and Cast controls now live directly on the player surface instead of separate page selects.
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-[#120e13] px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d7c19d]">
                Available tracks
              </p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                {audioTracks.length > 0
                  ? playableAudioTracks.length > 0
                    ? `${playableAudioTracks.length} alternate audio track${playableAudioTracks.length === 1 ? "" : "s"} can play locally in this browser.${unavailableAudioTrackCount > 0 ? ` ${unavailableAudioTrackCount} stored track${unavailableAudioTrackCount === 1 ? "" : "s"} are unavailable.` : ""}`
                    : "Alternate audio files are stored for this room, but none are playable in this browser session."
                  : "This room currently uses the embedded video audio only."}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                {(snapshot.media?.subtitleTracks ?? []).length > 0
                  ? `${(snapshot.media?.subtitleTracks ?? []).length} subtitle track${(snapshot.media?.subtitleTracks ?? []).length === 1 ? "" : "s"} are available from the on-player subtitle menu.`
                  : "No uploaded subtitle tracks are available for this room yet."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-[#17131a]/88 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
            Video call
          </p>
          <SocialCallPanel playbackTarget={playbackTarget} roomTitle={roomDisplayTitle} />
          <dl className="mt-6 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-sm text-[#c7c2ca]">Playback status</dt>
              <dd className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${getStatusTone(state.playback.status)}`}>
                {state.playback.status}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-sm text-[#c7c2ca]">Current time</dt>
              <dd className="text-sm font-semibold text-white">
                {formatPlaybackSeconds(resolvedAuthoritativeCurrentTime)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-sm text-[#c7c2ca]">Playback rate</dt>
              <dd className="text-sm font-semibold text-white">{state.playback.playbackRate.toFixed(2)}x</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#17131a]/88 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
            Chat
          </p>
          <SocialChatPanel
            roomId={snapshot.roomId}
            lastEventType={state.lastEvent?.type ?? null}
          />
          {state.lastEvent ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-black/20 p-5">
              <p className="text-base font-semibold capitalize text-white">
                {state.lastEvent.type.replace("_", " ")}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">{state.lastEvent.occurredAt}</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#a9a5ae]">
                {JSON.stringify(state.lastEvent, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="mt-6 rounded-3xl border border-white/10 bg-black/20 p-5 text-sm leading-6 text-[#c7c2ca]">
              No room events have been persisted yet.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
