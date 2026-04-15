import "server-only";

import { createHash } from "node:crypto";
import { CastFfmpegError } from "@/server/cast/cast-ffmpeg-service";
import { ensureCastVariant } from "@/server/cast/cast-variant-service";
import { getFfmpegAvailability } from "@/server/cast/ffmpeg-availability";
import {
  buildCastTextTrackPayload,
  resolveSelectedAudioTrack,
  resolveSelectedSubtitleTrack,
} from "@/server/cast/cast-track-mapper";
import { getPrismaClient } from "@/server/prisma";
import { isCastableAbsoluteUrl } from "@/lib/public-origin";
import { storedUploadAbsoluteHref } from "@/lib/routes";
import type {
  CastResolvedMediaDiagnostics,
  CastResolvedMediaFailurePayload,
  CastResolvedMediaResponse,
  CastResolvedMediaSuccessPayload,
  CastResolverWarning,
} from "@/types/cast";

type ResolveCastMediaInput = {
  castBaseUrl: string | null;
  preferredAudioLanguages: readonly string[];
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
  roomId: string;
};

type ResolverFfmpegSettings = {
  allowBaseVideoFallbackWhenMissing: boolean;
  failHardWhenMissing: boolean;
};

function normalizeTrackId(trackId: string | null | undefined) {
  if (!trackId) {
    return null;
  }

  const normalizedTrackId = trackId.trim();
  return normalizedTrackId.length > 0 ? normalizedTrackId : null;
}

function readBooleanEnv(name: string, defaultValue: boolean) {
  const rawValue = process.env[name];

  if (rawValue == null) {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return defaultValue;
}

function getResolverFfmpegSettings(): ResolverFfmpegSettings {
  const failHardWhenMissing = readBooleanEnv(
    "CAST_FAIL_HARD_WHEN_FFMPEG_MISSING",
    false,
  );
  const allowBaseVideoFallbackWhenMissing = failHardWhenMissing
    ? false
    : readBooleanEnv(
        "CAST_ALLOW_BASE_VIDEO_FALLBACK_WHEN_FFMPEG_MISSING",
        true,
      );

  return {
    allowBaseVideoFallbackWhenMissing,
    failHardWhenMissing,
  };
}

function createDiagnostics(
  diagnostics: CastResolvedMediaDiagnostics,
): CastResolvedMediaDiagnostics {
  return diagnostics;
}

function createFailurePayload(input: {
  diagnostics: CastResolvedMediaDiagnostics;
  errorCode: string;
  message: string;
  selectedAudioTrackId?: string | null;
  selectedSubtitleTrackId?: string | null;
  resolvedEffectiveAudioTrackId?: string | null;
  resolvedEffectiveSubtitleTrackId?: string | null;
  castFallbackApplied?: boolean;
  castFallbackReason?: string | null;
  castMode?: CastResolvedMediaFailurePayload["castMode"];
  warnings?: CastResolverWarning[];
}): CastResolvedMediaFailurePayload {
  return {
    ok: false,
    errorCode: input.errorCode,
    message: input.message,
    castMode: input.castMode ?? "resolver_error",
    selectedAudioTrackId: input.selectedAudioTrackId ?? null,
    selectedSubtitleTrackId: input.selectedSubtitleTrackId ?? null,
    resolvedEffectiveAudioTrackId: input.resolvedEffectiveAudioTrackId ?? null,
    resolvedEffectiveSubtitleTrackId:
      input.resolvedEffectiveSubtitleTrackId ?? null,
    castFallbackApplied: input.castFallbackApplied ?? false,
    castFallbackReason: input.castFallbackReason ?? null,
    warnings: input.warnings ?? [],
    diagnostics: input.diagnostics,
  };
}

function buildSelectionSignature(payload: {
  contentType: string;
  contentUrl: string;
  effectiveAudioTrackId: string | null;
  effectiveSubtitleTrackId: string | null;
}) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 24);
}

function buildSuccessPayload(input: {
  contentUrl: string;
  contentType: string;
  title: string;
  textTracks: CastResolvedMediaSuccessPayload["textTracks"];
  activeTrackIds: number[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  effectiveAudioTrackId: string | null;
  effectiveSubtitleTrackId: string | null;
  castMode: CastResolvedMediaSuccessPayload["castMode"];
  warnings?: CastResolverWarning[];
  diagnostics: Omit<
    CastResolvedMediaDiagnostics,
    "effectiveAudioTrackId" | "effectiveSubtitleTrackId" | "subtitlesIncluded"
  >;
}): CastResolvedMediaSuccessPayload {
  const primaryWarning = (input.warnings ?? [])[0] ?? null;
  const castFallbackApplied =
    input.castMode === "fallback_base_video_no_external_audio";

  return {
    ok: true,
    contentUrl: input.contentUrl,
    contentType: input.contentType,
    streamType: "BUFFERED",
    title: input.title,
    posterUrl: null,
    textTracks: input.textTracks,
    activeTrackIds: input.activeTrackIds,
    selectedAudioTrackId: input.selectedAudioTrackId,
    selectedSubtitleTrackId: input.selectedSubtitleTrackId,
    resolvedEffectiveAudioTrackId: input.effectiveAudioTrackId,
    resolvedEffectiveSubtitleTrackId: input.effectiveSubtitleTrackId,
    castMode: input.castMode,
    castFallbackApplied,
    castFallbackReason: castFallbackApplied
      ? primaryWarning?.message ?? null
      : null,
    warnings: input.warnings ?? [],
    selectionSignature: buildSelectionSignature({
      contentType: input.contentType,
      contentUrl: input.contentUrl,
      effectiveAudioTrackId: input.effectiveAudioTrackId,
      effectiveSubtitleTrackId: input.effectiveSubtitleTrackId,
    }),
    diagnostics: createDiagnostics({
      ...input.diagnostics,
      effectiveAudioTrackId: input.effectiveAudioTrackId,
      effectiveSubtitleTrackId: input.effectiveSubtitleTrackId,
      subtitlesIncluded: input.textTracks.length > 0,
    }),
  };
}

function isMissingFfmpegFailure(error: CastFfmpegError) {
  return (
    /enoent/i.test(error.message) ||
    /not be started/i.test(error.message) ||
    /spawn/i.test(error.message)
  );
}

function createMissingFfmpegWarning(): CastResolverWarning {
  return {
    code: "ffmpeg_missing_external_audio_ignored",
    message:
      "External audio could not be prepared for Chromecast because ffmpeg is unavailable. Falling back to base video audio.",
  };
}

function createMissingFfmpegFailurePayload(input: {
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
  effectiveSubtitleTrackId: string | null;
  ffmpegBinary: string | null;
  ffmpegFailureReason: string | null;
}) {
  return createFailurePayload({
    errorCode: "cast_external_audio_requires_ffmpeg",
    message:
      "The selected external audio track cannot be cast because ffmpeg is unavailable on the server.",
    castMode: "blocked_missing_ffmpeg",
    selectedAudioTrackId: input.requestedAudioTrackId,
    selectedSubtitleTrackId: input.requestedSubtitleTrackId,
    resolvedEffectiveAudioTrackId: null,
    resolvedEffectiveSubtitleTrackId: input.effectiveSubtitleTrackId,
    diagnostics: createDiagnostics({
      requestedAudioTrackId: input.requestedAudioTrackId,
      requestedSubtitleTrackId: input.requestedSubtitleTrackId,
      effectiveAudioTrackId: null,
      effectiveSubtitleTrackId: input.effectiveSubtitleTrackId,
      subtitlesIncluded: input.effectiveSubtitleTrackId != null,
      variantCacheKey: null,
      variantId: null,
      variantStoragePath: null,
      variantStatus: "blocked_ffmpeg_unavailable",
      ffmpegStatus: "unavailable",
      ffmpegAvailable: false,
      ffmpegBinary: input.ffmpegBinary,
      ffmpegFailureReason: input.ffmpegFailureReason,
    }),
  });
}

function createBaseResolverDiagnostics(input: {
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
}) {
  return {
    requestedAudioTrackId: input.requestedAudioTrackId,
    requestedSubtitleTrackId: input.requestedSubtitleTrackId,
    effectiveAudioTrackId: null,
    effectiveSubtitleTrackId: null,
    subtitlesIncluded: false,
    variantCacheKey: null,
    variantId: null,
    variantStoragePath: null,
    variantStatus: "not_needed" as const,
    ffmpegStatus: "not_needed" as const,
    ffmpegAvailable: null,
    ffmpegBinary: null,
    ffmpegFailureReason: null,
  };
}

export async function resolveCastMediaForRoom(
  input: ResolveCastMediaInput,
): Promise<CastResolvedMediaResponse> {
  const prisma = getPrismaClient();
  const normalizedAudioTrackId = normalizeTrackId(input.requestedAudioTrackId);
  const normalizedSubtitleTrackId = normalizeTrackId(
    input.requestedSubtitleTrackId,
  );
  const baseDiagnostics = createBaseResolverDiagnostics({
    requestedAudioTrackId: normalizedAudioTrackId,
    requestedSubtitleTrackId: normalizedSubtitleTrackId,
  });
  const room = await prisma.room.findUnique({
    where: {
      publicId: input.roomId,
    },
    select: {
      publicId: true,
      mediaAsset: {
        select: {
          id: true,
          title: true,
          mimeType: true,
          storagePath: true,
          audioTracks: {
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            select: {
              id: true,
              isDefault: true,
              label: true,
              language: true,
              normalizedPath: true,
            },
          },
          subtitleTracks: {
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            select: {
              id: true,
              isDefault: true,
              isRenderable: true,
              label: true,
              language: true,
              normalizedPath: true,
            },
          },
        },
      },
    },
  });

  if (!room) {
    return createFailurePayload({
      errorCode: "room_not_found",
      message: "The requested room could not be found.",
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      diagnostics: baseDiagnostics,
    });
  }

  if (!input.castBaseUrl) {
    return createFailurePayload({
      errorCode: "cast_base_url_unavailable",
      message:
        "This room does not currently have a Cast-safe public base URL. Configure CAST_BASE_URL or PUBLIC_BASE_URL with a reachable non-loopback origin.",
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      diagnostics: baseDiagnostics,
    });
  }

  const selectedAudioTrack = resolveSelectedAudioTrack(
    room.mediaAsset.audioTracks,
    normalizedAudioTrackId,
    input.preferredAudioLanguages,
  );

  if (normalizedAudioTrackId && !selectedAudioTrack) {
    return createFailurePayload({
      errorCode: "invalid_audio_track",
      message: "The requested audio track does not belong to this room media asset.",
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      diagnostics: baseDiagnostics,
    });
  }

  const selectedSubtitleTrack = resolveSelectedSubtitleTrack(
    room.mediaAsset.subtitleTracks,
    normalizedSubtitleTrackId,
  );

  if (normalizedSubtitleTrackId && !selectedSubtitleTrack) {
    return createFailurePayload({
      errorCode: "invalid_subtitle_track",
      message:
        "The requested subtitle track does not belong to this room media asset.",
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      diagnostics: baseDiagnostics,
    });
  }

  const textTrackPayload = buildCastTextTrackPayload({
    castBaseUrl: input.castBaseUrl,
    requestedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
    subtitleTracks: room.mediaAsset.subtitleTracks,
  });
  const directVideoUrl = storedUploadAbsoluteHref(
    room.mediaAsset.storagePath,
    input.castBaseUrl,
  );

  if (!isCastableAbsoluteUrl(directVideoUrl)) {
    return createFailurePayload({
      errorCode: "cast_content_url_unavailable",
      message: "The room video does not have a Cast-safe absolute URL.",
      selectedAudioTrackId: normalizedAudioTrackId,
      selectedSubtitleTrackId: normalizedSubtitleTrackId,
      diagnostics: baseDiagnostics,
    });
  }

  if (!selectedAudioTrack) {
    return buildSuccessPayload({
      contentUrl: directVideoUrl,
      contentType: room.mediaAsset.mimeType,
      title: room.mediaAsset.title,
      textTracks: textTrackPayload.textTracks,
      activeTrackIds: textTrackPayload.activeTrackIds,
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      effectiveAudioTrackId: null,
      effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
      castMode: "direct_video",
      diagnostics: baseDiagnostics,
    });
  }

  const ffmpegAvailability = await getFfmpegAvailability();
  const sharedAudioDiagnostics = {
    ...baseDiagnostics,
    ffmpegAvailable: ffmpegAvailability.ffmpegAvailable,
    ffmpegBinary: ffmpegAvailability.ffmpegBinary,
    ffmpegFailureReason: ffmpegAvailability.ffmpegFailureReason,
  };

  if (!ffmpegAvailability.ffmpegAvailable) {
    const resolverSettings = getResolverFfmpegSettings();

    if (resolverSettings.allowBaseVideoFallbackWhenMissing) {
      return buildSuccessPayload({
        contentUrl: directVideoUrl,
        contentType: room.mediaAsset.mimeType,
        title: room.mediaAsset.title,
        textTracks: textTrackPayload.textTracks,
        activeTrackIds: textTrackPayload.activeTrackIds,
        selectedAudioTrackId: selectedAudioTrack.id,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        effectiveAudioTrackId: null,
        effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
        castMode: "fallback_base_video_no_external_audio",
        warnings: [createMissingFfmpegWarning()],
        diagnostics: {
          ...sharedAudioDiagnostics,
          variantStatus: "skipped_ffmpeg_unavailable",
          ffmpegStatus: "unavailable",
        },
      });
    }

    if (resolverSettings.failHardWhenMissing || !resolverSettings.allowBaseVideoFallbackWhenMissing) {
      return createMissingFfmpegFailurePayload({
        requestedAudioTrackId: selectedAudioTrack.id,
        requestedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
        ffmpegBinary: ffmpegAvailability.ffmpegBinary,
        ffmpegFailureReason: ffmpegAvailability.ffmpegFailureReason,
      });
    }
  }

  try {
    const variant = await ensureCastVariant({
      audioTrack: selectedAudioTrack,
      mediaAssetId: room.mediaAsset.id,
      mimeType: room.mediaAsset.mimeType,
      videoStoragePath: room.mediaAsset.storagePath,
    });
    const variantContentUrl = storedUploadAbsoluteHref(
      variant.storagePath,
      input.castBaseUrl,
    );

    if (!isCastableAbsoluteUrl(variantContentUrl)) {
      return createFailurePayload({
        errorCode: "cast_variant_url_unavailable",
        message:
          "The generated Cast media variant does not have a Cast-safe absolute URL.",
        selectedAudioTrackId: selectedAudioTrack.id,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        resolvedEffectiveAudioTrackId: selectedAudioTrack.id,
        resolvedEffectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
        diagnostics: createDiagnostics({
          ...sharedAudioDiagnostics,
          effectiveAudioTrackId: selectedAudioTrack.id,
          effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
          subtitlesIncluded: textTrackPayload.textTracks.length > 0,
          variantCacheKey: variant.cacheKey,
          variantId: variant.variantId,
          variantStoragePath: variant.storagePath,
          variantStatus: variant.variantStatus,
          ffmpegStatus: variant.ffmpegStatus,
        }),
      });
    }

    return buildSuccessPayload({
      contentUrl: variantContentUrl,
      contentType: variant.contentType,
      title: room.mediaAsset.title,
      textTracks: textTrackPayload.textTracks,
      activeTrackIds: textTrackPayload.activeTrackIds,
      selectedAudioTrackId: selectedAudioTrack.id,
      selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      effectiveAudioTrackId: selectedAudioTrack.id,
      effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
      castMode: "muxed_variant",
      diagnostics: {
        ...sharedAudioDiagnostics,
        variantCacheKey: variant.cacheKey,
        variantId: variant.variantId,
        variantStoragePath: variant.storagePath,
        variantStatus: variant.variantStatus,
        ffmpegStatus: variant.ffmpegStatus,
      },
    });
  } catch (error) {
    if (error instanceof CastFfmpegError && isMissingFfmpegFailure(error)) {
      const resolverSettings = getResolverFfmpegSettings();
      const failureReason =
        error.diagnostics.stderrTail ??
        error.diagnostics.stdoutTail ??
        error.message;

      if (resolverSettings.allowBaseVideoFallbackWhenMissing) {
        return buildSuccessPayload({
          contentUrl: directVideoUrl,
          contentType: room.mediaAsset.mimeType,
          title: room.mediaAsset.title,
          textTracks: textTrackPayload.textTracks,
          activeTrackIds: textTrackPayload.activeTrackIds,
          selectedAudioTrackId: selectedAudioTrack.id,
          selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
          effectiveAudioTrackId: null,
          effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
          castMode: "fallback_base_video_no_external_audio",
          warnings: [createMissingFfmpegWarning()],
          diagnostics: {
            ...sharedAudioDiagnostics,
            variantStatus: "skipped_ffmpeg_unavailable",
            ffmpegStatus: "unavailable",
            ffmpegAvailable: false,
            variantStoragePath: null,
            ffmpegFailureReason: failureReason,
          },
        });
      }

      return createMissingFfmpegFailurePayload({
        requestedAudioTrackId: selectedAudioTrack.id,
        requestedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
        ffmpegBinary: ffmpegAvailability.ffmpegBinary,
        ffmpegFailureReason: failureReason,
      });
    }

    return createFailurePayload({
      errorCode: "cast_variant_generation_failed",
      message: "The Cast audio/video variant could not be generated.",
      selectedAudioTrackId: selectedAudioTrack.id,
      selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      resolvedEffectiveAudioTrackId: selectedAudioTrack.id,
      resolvedEffectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
      diagnostics: createDiagnostics({
        ...sharedAudioDiagnostics,
        effectiveAudioTrackId: selectedAudioTrack.id,
        effectiveSubtitleTrackId: textTrackPayload.selectedSubtitleTrackId,
        subtitlesIncluded: textTrackPayload.textTracks.length > 0,
        variantCacheKey:
          error &&
          typeof error === "object" &&
          "variantCacheKey" in error &&
          typeof error.variantCacheKey === "string"
            ? error.variantCacheKey
            : null,
        variantId:
          error &&
          typeof error === "object" &&
          "variantId" in error &&
          typeof error.variantId === "string"
            ? error.variantId
            : null,
        variantStoragePath: null,
        variantStatus: "failed",
        ffmpegStatus: "failed",
        ffmpegFailureReason:
          error instanceof CastFfmpegError
            ? error.diagnostics.stderrTail ??
              error.diagnostics.stdoutTail ??
              error.message
            : error instanceof Error
              ? error.message
              : "The Cast audio/video variant could not be generated.",
      }),
    });
  }
}
