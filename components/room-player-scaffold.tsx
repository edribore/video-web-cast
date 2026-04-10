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
  syncRoomPlaybackToChromecast,
  useChromecastAvailability,
  type ChromecastAvailabilityStatus,
} from "@/lib/chromecast";
import {
  assessAudioTrackPlaybackSupport,
  isPlayableAudioTrackSupport,
  type AudioTrackPlaybackSupport,
} from "@/lib/audio-track-playback";
import { createSafeId } from "@/lib/create-safe-id";
import { formatPlaybackSeconds, syncObservedPlayback } from "@/lib/playback";
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
} from "@/types/room-sync";
import {
  RoomVideoPlayer,
  type RoomVideoPlayerHandle,
  type RoomVideoPlayerLocalAudioState,
  type RoomVideoPlayerSnapshot,
} from "@/components/room-video-player";

type RoomPlayerScaffoldProps = { snapshot: RoomScaffoldSnapshot };
type RoomConnectionStatus = "connecting" | "connected" | "disconnected";
type RoomActionSource =
  | "local_user"
  | "socket"
  | "socket_echo"
  | "hydration"
  | "cast"
  | "system";

type RoomPlayerState = {
  playback: PlaybackStateSnapshot;
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

function reducer(state: RoomPlayerState, action: RoomPlayerAction): RoomPlayerState {
  switch (action.type) {
    case "video_observed":
      return {
        ...state,
        playback: syncObservedPlayback(state.playback, {
          status: action.snapshot.status,
          currentTime: action.snapshot.currentTime,
          playbackRate: action.snapshot.playbackRate,
        }),
      };
    case "room_hydrated":
      return {
        ...state,
        playback: action.payload.playback,
        lastEvent: action.payload.lastEvent,
        syncIssue: null,
        lastActionSource: action.source,
      };
    case "room_playback_sync":
      return {
        ...state,
        playback: action.payload.playback,
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
): ParticipantMediaPreferences {
  const selectedSubtitleTrackId =
    snapshot.media?.subtitleTracks.find((track) => track.isDefault && track.isRenderable)?.id ??
    snapshot.media?.subtitleTracks.find((track) => track.isRenderable)?.id ??
    null;

  return {
    selectedAudioTrackId: null,
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

export function RoomPlayerScaffold({ snapshot }: RoomPlayerScaffoldProps) {
  const [state, dispatch] = useReducer(reducer, {
    playback: snapshot.playback,
    lastEvent: snapshot.lastEvent,
    connectionStatus: "connecting" as RoomConnectionStatus,
    syncIssue: null,
    lastActionSource: null,
  });
  const [participantSessionId] = useState(() =>
    typeof window !== "undefined" ? getOrCreateParticipantSessionId() : "",
  );
  const [participantPreferences, setParticipantPreferences] =
    useState<ParticipantMediaPreferences>(() => createInitialParticipantPreferences(snapshot));
  const [localAudioState, setLocalAudioState] = useState<RoomVideoPlayerLocalAudioState>(
    () => createInitialLocalAudioState(snapshot),
  );
  const [pendingCommandCount, setPendingCommandCount] = useState(0);
  const playerRef = useRef<RoomVideoPlayerHandle>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingClientEventIdsRef = useRef<Set<string>>(new Set());
  const authoritativePlaybackRef = useRef(snapshot.playback);
  const participantPreferencesRef = useRef(participantPreferences);
  const castStatusRef = useRef<ChromecastAvailabilityStatus>("unavailable");
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
    participantPreferences.selectedAudioTrackId &&
    isPlayableAudioTrackSupport(
      audioTrackSupport[participantPreferences.selectedAudioTrackId],
    )
      ? participantPreferences.selectedAudioTrackId
      : null;
  const selectedExternalAudioTrack =
    audioTracks.find(
      (track) => track.id === effectiveSelectedAudioTrackId,
    ) ?? null;

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
    sharePath: snapshot.sharePath,
    shareUrl: snapshot.shareUrl,
    origins: snapshot.origins,
    participantSessionId,
    connectionStatus: state.connectionStatus,
    playback: state.playback,
    playbackVersion: state.playback.version,
    lastEvent: state.lastEvent,
    syncIssue: state.syncIssue,
    participantPreferences,
    cast: {
      status: castDisplayStatus,
      issue: castIssue,
      issueCode: castIssueCode,
      active: isCastActive,
      canRequestSession,
    },
    localAudio: localAudioState,
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
          await syncRoomPlaybackToChromecast(
            snapshot.roomId,
            snapshot.media,
            playback,
            participantPreferencesRef.current.selectedAudioTrackId,
            participantPreferencesRef.current.selectedSubtitleTrackId,
          );
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

  async function dispatchSharedCommand(
    type: SharedRoomControlType,
    runPlayerAction: (
      player: RoomVideoPlayerHandle,
    ) => Promise<RoomVideoPlayerSnapshot> | RoomVideoPlayerSnapshot,
  ) {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    try {
      const playerSnapshot = await runPlayerAction(player);
      dispatch({ type: "video_observed", snapshot: playerSnapshot });
      dispatch({ type: "last_action_source", source: "local_user" });
      setDebugLastActionSource("local_user");

      const socket = socketRef.current;
      logDebugEvent({
        level: "info",
        category: "playback",
        message: `Local ${type}.`,
        source: "local_user",
        data: { roomId: snapshot.roomId, playerSnapshot },
      });

      if (!socket?.connected) {
        const message = "Room sync is offline, so this change stayed local.";
        dispatch({ type: "sync_issue", message });
        logDebugEvent({
          level: "warn",
          category: "socket",
          message,
          source: "local_user",
        });
        return;
      }

      const clientEventId = createSafeId("room-command");
      pendingClientEventIdsRef.current.add(clientEventId);
      setPendingCommandCount(pendingClientEventIdsRef.current.size);
      socket.emit("room:command", {
        roomId: snapshot.roomId,
        actorSessionId: participantSessionId,
        clientEventId,
        type,
        status: playerSnapshot.status,
        currentTime: playerSnapshot.currentTime,
        playbackRate: playerSnapshot.playbackRate,
      });
      logDebugEvent({
        level: "info",
        category: "sync",
        message: `Emitted shared ${type}.`,
        source: "local_user",
        data: { clientEventId, currentTime: playerSnapshot.currentTime },
      });
    } catch (error) {
      const message = "This browser could not apply the requested playback change.";
      dispatch({ type: "sync_issue", message });
      logDebugEvent({
        level: "error",
        category: "playback",
        message,
        source: "local_user",
        data: error,
      });
    }
  }

  useEffect(() => {
    participantPreferencesRef.current = participantPreferences;
  }, [participantPreferences]);

  useEffect(() => {
    castStatusRef.current = castStatus;
  }, [castStatus]);

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
      const source =
        payload.sourceClientEventId &&
        pendingClientEventIdsRef.current.has(payload.sourceClientEventId)
          ? "socket_echo"
          : "socket";

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
    participantPreferences.selectedAudioTrackId,
    participantPreferences.selectedSubtitleTrackId,
    snapshot.media,
    snapshot.roomId,
  ]);

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

    await requestChromecastSession();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
      <section
        data-debug-room-sync="true"
        className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
              Synchronized playback
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Shared room timeline, local language choices
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Play, pause, seek, and stop are shared across the room. Audio and
              subtitle choices stay per-participant, and the current Cast session
              uses the same selected tracks.
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
            <button
              type="button"
              onClick={() => void handleCastButton()}
              disabled={
                castDisplayStatus === "loading" ||
                castDisplayStatus === "connecting" ||
                (!isCastActive && !canRequestSession)
              }
              data-debug-cast-button="true"
              className="rounded-full border border-line bg-white/80 px-5 py-3 text-sm font-semibold transition hover:border-accent hover:text-accent-strong disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
            >
              {isCastActive
                ? "End Cast"
                : castDisplayStatus === "loading"
                  ? "Checking Cast..."
                  : castDisplayStatus === "connecting"
                  ? "Connecting Cast..."
                  : "Start Cast"}
            </button>
          </div>
        </div>

        <div className="mt-8">
          <RoomVideoPlayer
            ref={playerRef}
            roomId={snapshot.roomId}
            title={snapshot.media?.title ?? "Uploaded media"}
            videoUrl={snapshot.media?.videoUrl ?? null}
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
          />
        </div>

        <div data-debug-playback-controls="true" className="mt-6 grid gap-3 sm:grid-cols-5">
          <button
            type="button"
            onClick={() => void dispatchSharedCommand("play", (player) => player.play())}
            className="rounded-3xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong"
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => void dispatchSharedCommand("pause", (player) => player.pause())}
            className="rounded-3xl border border-line bg-white/80 px-4 py-3 text-sm font-semibold transition hover:border-accent"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => void dispatchSharedCommand("seek", (player) => player.seekBy(-10))}
            className="rounded-3xl border border-line bg-white/80 px-4 py-3 text-sm font-semibold transition hover:border-accent"
          >
            Seek -10s
          </button>
          <button
            type="button"
            onClick={() => void dispatchSharedCommand("seek", (player) => player.seekBy(10))}
            className="rounded-3xl border border-line bg-white/80 px-4 py-3 text-sm font-semibold transition hover:border-accent"
          >
            Seek +10s
          </button>
          <button
            type="button"
            onClick={() => void dispatchSharedCommand("stop", (player) => player.stop())}
            className="rounded-3xl border border-line bg-white/80 px-4 py-3 text-sm font-semibold transition hover:border-accent"
          >
            Stop
          </button>
        </div>

        {state.syncIssue ? (
          <div className="mt-6 rounded-3xl border border-[#d7b7a6] bg-[#fff3ec] px-5 py-4 text-sm leading-6 text-[#7f4022]">
            {state.syncIssue}
          </div>
        ) : null}

        {visibleCastIssue ? (
          <div className="mt-6 rounded-3xl border border-[#c9d5f0] bg-[#f1f6ff] px-5 py-4 text-sm leading-6 text-[#244f8f]">
            {visibleCastIssue}
          </div>
        ) : null}

        {!snapshot.media?.castVideoUrl ? (
          <div className="mt-6 rounded-3xl border border-line bg-white/70 px-5 py-4 text-sm leading-6 text-muted">
            Cast needs a reachable media origin. Set `PUBLIC_BASE_URL` or `CAST_BASE_URL` to an HTTPS tunnel such as ngrok for the most reliable sender setup.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 rounded-[2rem] border border-line bg-white/70 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-muted">
              Share this room
            </p>
            <div className="mt-3 rounded-2xl border border-line bg-panel px-4 py-3 font-mono text-sm">
              {snapshot.shareUrl}
            </div>
            <p className="mt-3 text-xs leading-6 text-muted">
              Shared controls affect everyone. Language selectors stay per participant and drive this browser plus its active Cast session.
            </p>
            <div className="mt-4 space-y-2 rounded-2xl border border-line bg-panel/80 px-4 py-3 text-xs leading-6 text-muted">
              <p>
                App origin: <span className="font-mono">{appOriginSummary}</span>
              </p>
              <p>
                Media origin: <span className="font-mono">{mediaOriginSummary}</span>
              </p>
              <p>
                Cast media origin:{" "}
                <span className="font-mono">{castOriginSummary}</span>
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
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong">
                Cast active
              </p>
            ) : null}
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="audio-select" className="text-sm font-semibold uppercase tracking-[0.25em] text-muted">
                Audio track
              </label>
              <select
                id="audio-select"
                value={effectiveSelectedAudioTrackId ?? "video"}
                disabled={playableAudioTracks.length === 0}
                onChange={(event) => {
                  const nextAudioTrackId =
                    event.target.value === "video" ? null : event.target.value;
                  setParticipantPreferences((currentPreferences) => ({
                    ...currentPreferences,
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
                }}
                className="mt-3 min-h-12 w-full rounded-2xl border border-line bg-panel px-4 outline-none transition focus:border-accent disabled:text-muted"
              >
                <option value="video">Embedded video audio</option>
                {audioTracks.map((track) => {
                  const trackSupport = audioTrackSupport[track.id];
                  const trackPlayable = isPlayableAudioTrackSupport(trackSupport);

                  return (
                    <option
                      key={track.id}
                      value={track.id}
                      disabled={!trackPlayable}
                    >
                      {track.label} ({track.language})
                      {trackPlayable ? "" : " - stored only / unavailable"}
                    </option>
                  );
                })}
              </select>
              <p className="mt-3 text-xs leading-6 text-muted">
                {localAudioState.activeSource === "external"
                  ? `External audio track active${selectedExternalAudioTrack ? `: ${selectedExternalAudioTrack.label}.` : "."}`
                  : localAudioState.activeSource === "embedded"
                    ? "Embedded video audio active."
                    : "No local audio source is active yet."}
              </p>
              {audioTracks.length > 0 ? (
                <p className="mt-2 text-xs leading-6 text-muted">
                  {playableAudioTracks.length > 0
                    ? `${playableAudioTracks.length} alternate audio track${playableAudioTracks.length === 1 ? "" : "s"} can play locally in this browser.${unavailableAudioTrackCount > 0 ? ` ${unavailableAudioTrackCount} stored track${unavailableAudioTrackCount === 1 ? "" : "s"} are unavailable.` : ""}`
                    : "Alternate audio files are stored for this room, but none are playable in this browser session."}
                </p>
              ) : null}
              {localAudioState.issue ? (
                <p className="mt-2 text-xs leading-6 text-[#8a342f]">
                  {localAudioState.issue}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="subtitle-select" className="text-sm font-semibold uppercase tracking-[0.25em] text-muted">
                Subtitle track
              </label>
              <select
                id="subtitle-select"
                value={participantPreferences.selectedSubtitleTrackId ?? "none"}
                onChange={(event) => {
                  const nextSubtitleTrackId = event.target.value === "none" ? null : event.target.value;
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
                }}
                className="mt-3 min-h-12 w-full rounded-2xl border border-line bg-panel px-4 outline-none transition focus:border-accent"
              >
                <option value="none">No subtitles selected</option>
                {(snapshot.media?.subtitleTracks ?? []).map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                    {track.isRenderable ? "" : " (stored, not renderable yet)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Playback snapshot
          </p>
          {snapshot.media ? (
            <div className="mt-6 rounded-3xl border border-line/80 bg-panel px-4 py-4">
              <p className="text-sm font-semibold">{snapshot.media.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">
                {snapshot.media.audioTrackCount} audio track
                {snapshot.media.audioTrackCount === 1 ? "" : "s"} and{" "}
                {snapshot.media.subtitleTrackCount} subtitle track
                {snapshot.media.subtitleTrackCount === 1 ? "" : "s"} available
              </p>
            </div>
          ) : null}
          <dl className="mt-6 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-line/80 bg-panel px-4 py-3">
              <dt className="text-sm text-muted">Status</dt>
              <dd className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${getStatusTone(state.playback.status)}`}>
                {state.playback.status}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-line/80 bg-panel px-4 py-3">
              <dt className="text-sm text-muted">Current time</dt>
              <dd className="text-sm font-semibold">{formatPlaybackSeconds(state.playback.currentTime)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-line/80 bg-panel px-4 py-3">
              <dt className="text-sm text-muted">Playback rate</dt>
              <dd className="text-sm font-semibold">{state.playback.playbackRate.toFixed(2)}x</dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-line/80 bg-panel px-4 py-3">
              <dt className="text-sm text-muted">Version</dt>
              <dd className="text-sm font-semibold">{state.playback.version}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-line/80 bg-panel px-4 py-3">
              <dt className="text-sm text-muted">Last source</dt>
              <dd className="text-sm font-semibold">{state.lastActionSource ?? "unknown"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Last room event
          </p>
          {state.lastEvent ? (
            <div className="mt-6 rounded-3xl border border-line/80 bg-panel p-5">
              <p className="text-base font-semibold capitalize">
                {state.lastEvent.type.replace("_", " ")}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">{state.lastEvent.occurredAt}</p>
              <pre className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-muted whitespace-pre-wrap">
                {JSON.stringify(state.lastEvent, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="mt-6 rounded-3xl border border-line/80 bg-panel p-5 text-sm leading-6 text-muted">
              No room events have been persisted yet.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
