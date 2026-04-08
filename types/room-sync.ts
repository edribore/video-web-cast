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

type BaseRoomSyncEvent = {
  roomId: string;
  actorSessionId: string | null;
  occurredAt: string;
  version: number;
};

export type JoinRoomSyncEvent = BaseRoomSyncEvent & {
  type: "join";
  currentTime: number;
  playbackRate: number;
};

export type SharedPlaybackRoomSyncEvent = BaseRoomSyncEvent & {
  type: SharedRoomControlType;
  currentTime: number;
  playbackRate: number;
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
  posterUrl: string | null;
  videoUrl: string;
  absoluteVideoUrl: string;
  castVideoUrl: string | null;
  audioTrackCount: number;
  subtitleTrackCount: number;
  audioTracks: RoomAudioTrackSummary[];
  subtitleTracks: RoomSubtitleTrackSummary[];
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
  media: RoomMediaSummary | null;
};
