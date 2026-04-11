export const castSuccessModes = [
  "direct_video",
  "muxed_variant",
  "fallback_base_video_no_external_audio",
  "hls_variant",
] as const;

export const castFailureModes = [
  "blocked_missing_ffmpeg",
  "resolver_error",
] as const;

export const castModes = [
  ...castSuccessModes,
  ...castFailureModes,
] as const;

export type CastSuccessMode = (typeof castSuccessModes)[number];
export type CastFailureMode = (typeof castFailureModes)[number];
export type CastMode = (typeof castModes)[number];

export type CastTextTrack = {
  trackId: number;
  trackContentId: string;
  trackContentType: string;
  name: string;
  language: string;
  subtype: "SUBTITLES";
};

export type CastResolverWarning = {
  code: string;
  message: string;
};

export type CastVariantStatus =
  | "not_needed"
  | "created"
  | "reused"
  | "skipped_ffmpeg_unavailable"
  | "blocked_ffmpeg_unavailable"
  | "failed";

export type CastFfmpegStatus =
  | "not_needed"
  | "created"
  | "reused"
  | "unavailable"
  | "failed";

export type CastResolvedMediaDiagnostics = {
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
  effectiveAudioTrackId: string | null;
  effectiveSubtitleTrackId: string | null;
  subtitlesIncluded: boolean;
  variantCacheKey: string | null;
  variantId: string | null;
  variantStoragePath: string | null;
  variantStatus: CastVariantStatus;
  ffmpegStatus: CastFfmpegStatus;
  ffmpegAvailable: boolean | null;
  ffmpegBinary: string | null;
  ffmpegFailureReason: string | null;
};

export type CastResolvedMediaSuccessPayload = {
  ok: true;
  contentUrl: string;
  contentType: string;
  streamType: "BUFFERED";
  title: string;
  posterUrl: string | null;
  textTracks: CastTextTrack[];
  activeTrackIds: number[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  resolvedEffectiveAudioTrackId: string | null;
  resolvedEffectiveSubtitleTrackId: string | null;
  castMode: CastSuccessMode;
  castFallbackApplied: boolean;
  castFallbackReason: string | null;
  warnings: CastResolverWarning[];
  selectionSignature: string;
  diagnostics: CastResolvedMediaDiagnostics;
};

export type CastResolvedMediaFailurePayload = {
  ok: false;
  errorCode: string;
  message: string;
  castMode: CastFailureMode;
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  resolvedEffectiveAudioTrackId: string | null;
  resolvedEffectiveSubtitleTrackId: string | null;
  castFallbackApplied: boolean;
  castFallbackReason: string | null;
  warnings: CastResolverWarning[];
  diagnostics: CastResolvedMediaDiagnostics;
};

export type CastResolvedMediaResponse =
  | CastResolvedMediaSuccessPayload
  | CastResolvedMediaFailurePayload;
