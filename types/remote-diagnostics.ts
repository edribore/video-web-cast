import type { PlaybackStatus } from "./playback";

export const remoteDiagnosticsClientTypes = [
  "chromecast",
  "receiver",
  "web",
  "mobile-web",
  "pip",
  "server",
  "unknown",
] as const;

export const remoteDiagnosticsSources = [
  "remote",
  "keyboard",
  "pointer",
  "ui-button",
  "cast-input",
  "message-bus",
  "transport",
  "pip",
  "timer",
  "player",
  "custom",
] as const;

export const remoteDiagnosticsActions = [
  "up",
  "down",
  "left",
  "right",
  "select",
  "back",
  "play_pause",
  "play",
  "pause",
  "seek_forward",
  "seek_backward",
  "seek_to",
  "mute",
  "unmute",
  "volume_up",
  "volume_down",
  "show_controls",
  "hide_controls",
  "focus_change",
  "pip_enter",
  "pip_exit",
  "state_sync",
  "custom",
] as const;

export const remoteDiagnosticsLifecycleStages = [
  "captured",
  "normalized",
  "queued",
  "sent",
  "server_received",
  "broadcast",
  "received",
  "applied",
  "rendered",
  "ack",
  "ignored",
  "dropped",
  "stale",
  "duplicate",
  "out_of_order",
] as const;

export type RemoteDiagnosticsClientType =
  (typeof remoteDiagnosticsClientTypes)[number];
export type RemoteDiagnosticsSource =
  (typeof remoteDiagnosticsSources)[number];
export type RemoteDiagnosticsAction =
  (typeof remoteDiagnosticsActions)[number];
export type RemoteDiagnosticsLifecycleStage =
  (typeof remoteDiagnosticsLifecycleStages)[number];

export type RemoteDiagnosticsEventStatus =
  | "pending"
  | "observed"
  | "applied"
  | "rendered"
  | "ignored"
  | "dropped"
  | "warning";

export type RemoteDiagnosticsTransportDirection =
  | "local"
  | "outbound"
  | "inbound";

export type RemoteDiagnosticsRawInput = {
  key: string | null;
  code: string | null;
  keyCode: number | null;
  which: number | null;
  repeat: boolean | null;
  eventType: string | null;
  defaultPrevented: boolean | null;
  target: string | null;
  targetTag: string | null;
  targetRole: string | null;
  button: number | null;
  pointerType: string | null;
  detail: string | null;
  playerState: string | null;
};

export type RemoteDiagnosticsEvent = {
  eventId: string;
  parentEventId: string | null;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  source: RemoteDiagnosticsSource;
  action: RemoteDiagnosticsAction;
  rawInput: RemoteDiagnosticsRawInput | null;
  wallClockTs: number;
  monotonicTs: number | null;
  estimatedServerOffsetMs: number | null;
  estimatedServerTimeMs: number | null;
  stage: RemoteDiagnosticsLifecycleStage;
  sequenceNumber: number | null;
  roomVersion: number | null;
  stateVersion: number | null;
  playbackStateVersion: number | null;
  currentTimeSec: number | null;
  durationSec: number | null;
  paused: boolean | null;
  playbackRate: number | null;
  buffering: boolean | null;
  seeking: boolean | null;
  module: string | null;
  functionName: string | null;
  notes: string | null;
  reason: string | null;
  status: RemoteDiagnosticsEventStatus | null;
  actorSessionId: string | null;
  transportDirection: RemoteDiagnosticsTransportDirection | null;
  extra: Record<string, unknown> | null;
};

export type RemoteDiagnosticsCommandTrace = {
  eventId: string;
  parentEventId: string | null;
  source: RemoteDiagnosticsSource;
  action: RemoteDiagnosticsAction;
  clientType: RemoteDiagnosticsClientType;
  rawInput: RemoteDiagnosticsRawInput | null;
  wallClockTs: number;
  monotonicTs: number | null;
  estimatedServerOffsetMs: number | null;
  roomVersion: number | null;
  playbackStateVersion: number | null;
  notes: string | null;
  reason: string | null;
};

export type RemoteDiagnosticsTransportMeta = {
  eventId: string;
  parentEventId: string | null;
  serverReceivedAtMs: number;
  serverBroadcastAtMs: number;
  serverSequenceNumber: number | null;
  serverRoomVersion: number | null;
  actorSessionId: string | null;
  commandSource: string | null;
  sourceClientEventId: string | null;
  debugClientWallClockTs: number | null;
  debugClientMonotonicTs: number | null;
  debugClientType: RemoteDiagnosticsClientType | null;
  debugSource: RemoteDiagnosticsSource | null;
  debugAction: RemoteDiagnosticsAction | null;
  rawInput: RemoteDiagnosticsRawInput | null;
};

export type RemoteDiagnosticsClockSyncSample = {
  id: string;
  sampleId: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  clientSentAtMs: number;
  clientReceivedAtMs: number;
  serverReceivedAtMs: number;
  serverSentAtMs: number;
  roundTripMs: number;
  estimatedOffsetMs: number;
  estimatedServerTimeMs: number;
  estimatedOneWayLatencyMs: number;
};

export type RemoteDiagnosticsDriftSnapshot = {
  id: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  authoritativeRoomTimeSec: number | null;
  chromecastTimeSec: number | null;
  webClientTimeSec: number | null;
  pipTimeSec: number | null;
  chromecastMinusRoomMs: number | null;
  webMinusRoomMs: number | null;
  pipMinusRoomMs: number | null;
  chromecastMinusWebMs: number | null;
  authoritativeStatus: PlaybackStatus | null;
  chromecastStatus: PlaybackStatus | null;
  webStatus: PlaybackStatus | null;
  pipStatus: PlaybackStatus | null;
  authoritativePlaybackVersion: number | null;
  lastSequenceNumber: number | null;
  lastAppliedStateVersion: number | null;
  lastSeekSource: string | null;
  lastPlayPauseSource: string | null;
  staleWarning: boolean;
  outOfOrderWarning: boolean;
};

export type RemoteDiagnosticsOverlaySnapshot = {
  id: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  visibility: string;
  pinnedReason: string | null;
  eventType: string;
  reason: string | null;
  hideTimerState: "idle" | "scheduled" | "cleared" | "fired";
  fadeTimerState: "idle" | "scheduled" | "cleared" | "fired";
  hideTimerDurationMs: number | null;
  fadeTimerDurationMs: number | null;
  activeMenu: string | null;
  lastKeepAliveAction: string | null;
  playbackStatus: PlaybackStatus;
  isMobileClient: boolean;
};

export type RemoteDiagnosticsPipSnapshot = {
  id: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  supported: boolean;
  active: boolean;
  mode: "video-element" | "document" | "unavailable";
  pipCurrentTimeSec: number | null;
  mainPlayerCurrentTimeSec: number | null;
  authoritativeRoomTimeSec: number | null;
  pipMinusRoomMs: number | null;
  pipMinusMainMs: number | null;
  pipStatus: PlaybackStatus | null;
  mainStatus: PlaybackStatus | null;
  authoritativeStatus: PlaybackStatus | null;
  followingCanonicalState: boolean | null;
  lastCommandEventId: string | null;
  lastCommandAction: RemoteDiagnosticsAction | null;
  lastCommandReceivedAtMs: number | null;
  notes: string | null;
};

export type RemoteDiagnosticsSequenceRelation =
  | "initial"
  | "in_order"
  | "duplicate"
  | "out_of_order"
  | "gap"
  | "stale";

export type RemoteDiagnosticsSequenceSnapshot = {
  id: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  eventId: string | null;
  sequenceNumber: number | null;
  previousSequenceNumber: number | null;
  relation: RemoteDiagnosticsSequenceRelation;
  gapSize: number | null;
  roomVersion: number | null;
  stateVersion: number | null;
  previousStateVersion: number | null;
  sourceClientEventId: string | null;
  notes: string | null;
};

export type RemoteDiagnosticsPlayerSnapshot = {
  id: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  playerKind: "local-web" | "chromecast-remote" | "pip";
  currentTimeSec: number | null;
  durationSec: number | null;
  status: PlaybackStatus | null;
  playbackRate: number | null;
  paused: boolean | null;
  buffering: boolean | null;
  seeking: boolean | null;
  primaryClockSource: string | null;
  extra: Record<string, unknown> | null;
};

export type RemoteDiagnosticsTimeline = {
  eventId: string;
  parentEventId: string | null;
  action: RemoteDiagnosticsAction;
  source: RemoteDiagnosticsSource;
  clientType: RemoteDiagnosticsClientType;
  stageTimes: Partial<Record<RemoteDiagnosticsLifecycleStage, number>>;
  events: RemoteDiagnosticsEvent[];
  totalDurationMs: number | null;
};

export type RemoteDiagnosticsActivation = {
  enabled: boolean;
  debugRemote: boolean;
  debugSync: boolean;
  persisted: boolean;
  sources: string[];
};

export type RemoteDiagnosticsSession = {
  sessionId: string;
  startedAt: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  activation: RemoteDiagnosticsActivation;
};

export type RemoteDiagnosticsExport = {
  exportedAt: string;
  session: RemoteDiagnosticsSession;
  events: RemoteDiagnosticsEvent[];
  correlatedTimelines: RemoteDiagnosticsTimeline[];
  driftSnapshots: RemoteDiagnosticsDriftSnapshot[];
  sequenceSnapshots: RemoteDiagnosticsSequenceSnapshot[];
  overlaySnapshots: RemoteDiagnosticsOverlaySnapshot[];
  pipSnapshots: RemoteDiagnosticsPipSnapshot[];
  clockSyncSamples: RemoteDiagnosticsClockSyncSample[];
  playerSnapshots: RemoteDiagnosticsPlayerSnapshot[];
  legacyDebugSnapshot: unknown;
};
