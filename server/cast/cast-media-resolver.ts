import "server-only";

import { createHash } from "node:crypto";
import { CastFfmpegError } from "@/server/cast/cast-ffmpeg-service";
import { ensureCastVariant } from "@/server/cast/cast-variant-service";
import {
  buildCastTextTrackPayload,
  resolveSelectedAudioTrack,
  resolveSelectedSubtitleTrack,
} from "@/server/cast/cast-track-mapper";
import { getPrismaClient } from "@/server/prisma";
import { isCastableAbsoluteUrl } from "@/lib/public-origin";
import { storedUploadAbsoluteHref } from "@/lib/routes";
import type { CastResolvedMediaPayload } from "@/types/cast";

type ResolveCastMediaInput = {
  castBaseUrl: string | null;
  requestedAudioTrackId: string | null;
  requestedSubtitleTrackId: string | null;
  roomId: string;
};

export class CastMediaResolverError extends Error {
  code: string;
  details?: unknown;
  status: number;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "CastMediaResolverError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function normalizeTrackId(trackId: string | null | undefined) {
  if (!trackId) {
    return null;
  }

  const normalizedTrackId = trackId.trim();
  return normalizedTrackId.length > 0 ? normalizedTrackId : null;
}

function ensureCastableUrl(urlValue: string, code: string, message: string) {
  if (!isCastableAbsoluteUrl(urlValue)) {
    throw new CastMediaResolverError(503, code, message, {
      contentUrl: urlValue,
    });
  }

  return urlValue;
}

function buildSelectionSignature(payload: {
  castMode: CastResolvedMediaPayload["castMode"];
  contentType: string;
  contentUrl: string;
  mediaAssetId: string;
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
}) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 24);
}

export async function resolveCastMediaForRoom(
  input: ResolveCastMediaInput,
): Promise<CastResolvedMediaPayload> {
  const prisma = getPrismaClient();
  const normalizedAudioTrackId = normalizeTrackId(input.requestedAudioTrackId);
  const normalizedSubtitleTrackId = normalizeTrackId(
    input.requestedSubtitleTrackId,
  );
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
          originalFilename: true,
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
    throw new CastMediaResolverError(
      404,
      "room_not_found",
      "The requested room could not be found.",
      {
        roomId: input.roomId,
      },
    );
  }

  if (!input.castBaseUrl) {
    throw new CastMediaResolverError(
      503,
      "cast_base_url_unavailable",
      "This room does not currently have a Cast-safe public base URL. Configure CAST_BASE_URL or PUBLIC_BASE_URL with a reachable non-loopback origin.",
      {
        roomId: room.publicId,
      },
    );
  }

  const selectedAudioTrack = resolveSelectedAudioTrack(
    room.mediaAsset.audioTracks,
    normalizedAudioTrackId,
  );

  if (normalizedAudioTrackId && !selectedAudioTrack) {
    throw new CastMediaResolverError(
      400,
      "invalid_audio_track",
      "The requested audio track does not belong to this room media asset.",
      {
        roomId: room.publicId,
        requestedAudioTrackId: normalizedAudioTrackId,
        mediaAssetId: room.mediaAsset.id,
      },
    );
  }

  const selectedSubtitleTrack = resolveSelectedSubtitleTrack(
    room.mediaAsset.subtitleTracks,
    normalizedSubtitleTrackId,
  );

  if (normalizedSubtitleTrackId && !selectedSubtitleTrack) {
    throw new CastMediaResolverError(
      400,
      "invalid_subtitle_track",
      "The requested subtitle track does not belong to this room media asset.",
      {
        roomId: room.publicId,
        requestedSubtitleTrackId: normalizedSubtitleTrackId,
        mediaAssetId: room.mediaAsset.id,
      },
    );
  }

  const textTrackPayload = buildCastTextTrackPayload({
    castBaseUrl: input.castBaseUrl,
    requestedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
    subtitleTracks: room.mediaAsset.subtitleTracks,
  });
  const directVideoUrl = ensureCastableUrl(
    storedUploadAbsoluteHref(room.mediaAsset.storagePath, input.castBaseUrl),
    "cast_content_url_unavailable",
    "The room video does not have a Cast-safe absolute URL.",
  );

  if (!selectedAudioTrack) {
    return {
      contentUrl: directVideoUrl,
      contentType: room.mediaAsset.mimeType,
      streamType: "BUFFERED",
      title: room.mediaAsset.title,
      posterUrl: null,
      textTracks: textTrackPayload.textTracks,
      activeTrackIds: textTrackPayload.activeTrackIds,
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      castMode: "direct_video",
      selectionSignature: buildSelectionSignature({
        castMode: "direct_video",
        contentType: room.mediaAsset.mimeType,
        contentUrl: directVideoUrl,
        mediaAssetId: room.mediaAsset.id,
        selectedAudioTrackId: null,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      }),
      diagnostics: {
        requestedAudioTrackId: normalizedAudioTrackId,
        requestedSubtitleTrackId: normalizedSubtitleTrackId,
        selectedAudioTrackId: null,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        subtitlesIncluded: textTrackPayload.textTracks.length > 0,
        variantCacheKey: null,
        variantId: null,
        variantStatus: "not_needed",
        ffmpegStatus: "not_needed",
        ffmpegFailureReason: null,
      },
    };
  }

  try {
    const variant = await ensureCastVariant({
      audioTrack: selectedAudioTrack,
      mediaAssetId: room.mediaAsset.id,
      mimeType: room.mediaAsset.mimeType,
      videoStoragePath: room.mediaAsset.storagePath,
    });
    const variantContentUrl = ensureCastableUrl(
      storedUploadAbsoluteHref(variant.storagePath, input.castBaseUrl),
      "cast_variant_url_unavailable",
      "The generated Cast media variant does not have a Cast-safe absolute URL.",
    );

    return {
      contentUrl: variantContentUrl,
      contentType: variant.contentType,
      streamType: "BUFFERED",
      title: room.mediaAsset.title,
      posterUrl: null,
      textTracks: textTrackPayload.textTracks,
      activeTrackIds: textTrackPayload.activeTrackIds,
      selectedAudioTrackId: selectedAudioTrack.id,
      selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      castMode: "muxed_variant",
      selectionSignature: buildSelectionSignature({
        castMode: "muxed_variant",
        contentType: variant.contentType,
        contentUrl: variantContentUrl,
        mediaAssetId: room.mediaAsset.id,
        selectedAudioTrackId: selectedAudioTrack.id,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
      }),
      diagnostics: {
        requestedAudioTrackId: normalizedAudioTrackId,
        requestedSubtitleTrackId: normalizedSubtitleTrackId,
        selectedAudioTrackId: selectedAudioTrack.id,
        selectedSubtitleTrackId: selectedSubtitleTrack?.id ?? null,
        subtitlesIncluded: textTrackPayload.textTracks.length > 0,
        variantCacheKey: variant.cacheKey,
        variantId: variant.variantId,
        variantStatus: variant.variantStatus,
        ffmpegStatus: variant.ffmpegStatus,
        ffmpegFailureReason: variant.ffmpegFailureReason,
      },
    };
  } catch (error) {
    if (error instanceof CastFfmpegError) {
      const ffmpegMissing =
        /enoent/i.test(error.message) ||
        /not be started/i.test(error.message) ||
        /spawn/i.test(error.message);

      throw new CastMediaResolverError(
        ffmpegMissing ? 503 : 500,
        "cast_variant_generation_failed",
        ffmpegMissing
          ? "Cast audio muxing requires ffmpeg to be installed and reachable via PATH or FFMPEG_BIN."
          : "The Cast audio/video variant could not be generated.",
        {
          diagnostics: error.diagnostics,
          roomId: room.publicId,
          mediaAssetId: room.mediaAsset.id,
          requestedAudioTrackId: normalizedAudioTrackId,
        },
      );
    }

    if (error instanceof CastMediaResolverError) {
      throw error;
    }

    throw new CastMediaResolverError(
      500,
      "cast_variant_generation_failed",
      "The Cast audio/video variant could not be generated.",
      {
        error: error instanceof Error ? error.message : String(error),
        roomId: room.publicId,
        mediaAssetId: room.mediaAsset.id,
        requestedAudioTrackId: normalizedAudioTrackId,
      },
    );
  }
}
