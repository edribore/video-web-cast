export const castModes = [
  "direct_video",
  "muxed_variant",
  "hls_variant",
] as const;

export type CastMode = (typeof castModes)[number];

export type CastTextTrack = {
  trackId: number;
  trackContentId: string;
  trackContentType: string;
  name: string;
  language: string;
  subtype: "SUBTITLES";
};

export type CastVariantStatus =
  | "not_needed"
  | "created"
  | "reused"
  | "failed";

export type CastFfmpegStatus =
  | "not_needed"
  | "created"
  | "reused"
  | "failed";

export type CastResolvedMediaDiagnostics = {
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  subtitlesIncluded: boolean;
  variantCacheKey: string | null;
  variantId: string | null;
  variantStatus: CastVariantStatus;
  ffmpegStatus: CastFfmpegStatus;
  ffmpegFailureReason: string | null;
};

export type CastResolvedMediaPayload = {
  contentUrl: string;
  contentType: string;
  streamType: "BUFFERED";
  title: string;
  posterUrl: string | null;
  textTracks: CastTextTrack[];
  activeTrackIds: number[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  castMode: CastMode;
  selectionSignature: string;
  diagnostics: CastResolvedMediaDiagnostics;
};
