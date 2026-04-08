export const playbackStatuses = ["stopped", "playing", "paused"] as const;

export type PlaybackStatus = (typeof playbackStatuses)[number];

export type PlaybackStateSnapshot = {
  status: PlaybackStatus;
  currentTime: number;
  playbackRate: number;
  version: number;
  updatedAt: string;
};

export type ParticipantMediaPreferences = {
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
};
