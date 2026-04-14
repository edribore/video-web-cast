export const playbackStatuses = ["stopped", "playing", "paused"] as const;

export type PlaybackStatus = (typeof playbackStatuses)[number];

export type PlaybackStateSnapshot = {
  status: PlaybackStatus;
  currentTime: number;
  anchorMediaTime: number;
  anchorWallClockMs: number;
  scheduledStartWallClockMs: number | null;
  playbackRate: number;
  version: number;
  updatedAt: string;
  sourceClientEventId: string | null;
};

export type ParticipantMediaPreferences = {
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
};
