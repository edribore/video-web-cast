import type { PlaybackStateSnapshot, PlaybackStatus } from "@/types/playback";

export const roomSyncEventTypes = [
  "join",
  "play",
  "pause",
  "stop",
  "seek",
] as const;

export const sharedRoomControlTypes = [
  "play",
  "pause",
  "stop",
  "seek",
] as const;

export type RoomSyncEventType = (typeof roomSyncEventTypes)[number];
export type SharedRoomControlType = (typeof sharedRoomControlTypes)[number];
export type SharedRoomControlSource =
  | "local_user"
  | "cast_local_command"
  | "cast_remote";

type BaseRoomSyncEvent = {
  roomId: string;
  actorSessionId: string | null;
  occurredAt: string;
  version: number;
  status: PlaybackStatus;
  currentTime: number;
  anchorMediaTime: number;
  anchorWallClockMs: number;
  scheduledStartWallClockMs: number | null;
  playbackRate: number;
  sourceClientEventId: string | null;
  commandSource: SharedRoomControlSource | null;
};

export type JoinRoomSyncEvent = BaseRoomSyncEvent & {
  type: "join";
};

export type SharedPlaybackRoomSyncEvent = BaseRoomSyncEvent & {
  type: SharedRoomControlType;
};

export type RoomSyncEvent =
  | JoinRoomSyncEvent
  | SharedPlaybackRoomSyncEvent;

export type SharedRoomControlCommand = {
  roomId: string;
  actorSessionId: string;
  clientEventId: string;
  type: SharedRoomControlType;
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  commandSource?: SharedRoomControlSource | null;
};

export type RoomSocketHydrationPayload = {
  playback: PlaybackStateSnapshot;
  lastEvent: RoomSyncEvent | null;
};

export type RoomSocketPlaybackSyncPayload = {
  playback: PlaybackStateSnapshot;
  event: RoomSyncEvent;
  sourceClientEventId: string | null;
};

export type RoomAudioTrackSummary = {
  id: string;
  label: string;
  language: string;
  originalFormat: string;
  url: string;
  absoluteUrl: string;
  isDefault: boolean;
};

export type RoomSubtitleTrackSummary = {
  id: string;
  label: string;
  language: string;
  originalFormat: string;
  url: string | null;
  absoluteUrl: string | null;
  castUrl: string | null;
  isDefault: boolean;
  isRenderable: boolean;
};

export type RoomMediaSummary = {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  durationSeconds: number | null;
  posterUrl: string | null;
  videoUrl: string;
  absoluteVideoUrl: string;
  castVideoUrl: string | null;
  audioTrackCount: number;
  subtitleTrackCount: number;
  audioTracks: RoomAudioTrackSummary[];
  subtitleTracks: RoomSubtitleTrackSummary[];
};

export type RoomCatalogMovieSummary = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  posterUrl: string | null;
  releaseLabel: string | null;
  languageAvailabilityLabel: string | null;
};

export type RoomOriginSummary = {
  appOrigin: string | null;
  mediaOrigin: string | null;
  castMediaOrigin: string | null;
  effectiveAppBaseUrl: string | null;
  effectiveCastBaseUrl: string | null;
};

export type RoomScaffoldSnapshot = {
  roomId: string;
  sharePath: string;
  shareUrl: string;
  origins: RoomOriginSummary;
  playback: PlaybackStateSnapshot;
  lastEvent: RoomSyncEvent | null;
  movie: RoomCatalogMovieSummary | null;
  media: RoomMediaSummary | null;
};
