import "server-only";

import { createInitialPlaybackState } from "@/lib/playback";
import {
  roomAbsoluteHref,
  roomHref,
  storedUploadAbsoluteHref,
  storedUploadHref,
} from "@/lib/routes";
import { getUrlOrigin } from "@/lib/public-origin";
import { getPrismaClient } from "@/server/prisma";
import { getRoomRealtimeSnapshot } from "@/server/room-realtime";
import type { RoomScaffoldSnapshot } from "@/types/room-sync";

function buildLanguageAvailabilityLabel(room: {
  catalogMovie: {
    mediaAsset: {
      audioTracks: Array<{ language: string }>;
      subtitleTracks: Array<{ language: string; isRenderable: boolean }>;
    } | null;
  } | null;
}) {
  const mediaAsset = room.catalogMovie?.mediaAsset;

  if (!mediaAsset) {
    return null;
  }

  const audioLanguages = Array.from(
    new Set(
      mediaAsset.audioTracks
        .map((track) => track.language.toUpperCase())
        .filter((language) => language !== "UND"),
    ),
  );
  const subtitleLanguages = Array.from(
    new Set(
      mediaAsset.subtitleTracks
        .filter((track) => track.isRenderable)
        .map((track) => track.language.toUpperCase())
        .filter((language) => language !== "UND"),
    ),
  );
  const segments: string[] = [];

  if (audioLanguages.length > 0) {
    segments.push(`Audio ${audioLanguages.join(", ")}`);
  }

  if (subtitleLanguages.length > 0) {
    segments.push(`Subs ${subtitleLanguages.join(", ")}`);
  }

  return segments.length > 0 ? segments.join(" · ") : null;
}

export async function getRoomScaffoldSnapshot(
  roomId: string,
  publicBaseUrl: string | null,
  castBaseUrl: string | null,
): Promise<RoomScaffoldSnapshot> {
  const prisma = getPrismaClient();

  const [room, realtimeSnapshot] = await Promise.all([
    prisma.room.findUnique({
      where: {
        publicId: roomId,
      },
      include: {
        catalogMovie: {
          select: {
            id: true,
            slug: true,
            title: true,
            synopsis: true,
            posterPath: true,
            releaseLabel: true,
            mediaAsset: {
              select: {
                audioTracks: {
                  select: {
                    language: true,
                  },
                },
                subtitleTracks: {
                  select: {
                    language: true,
                    isRenderable: true,
                  },
                },
              },
            },
          },
        },
        mediaAsset: {
          select: {
            id: true,
            title: true,
            originalFilename: true,
            mimeType: true,
            durationSeconds: true,
            storagePath: true,
            audioTracks: {
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            },
            subtitleTracks: {
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            },
            _count: {
              select: {
                audioTracks: true,
                subtitleTracks: true,
              },
            },
          },
        },
      },
    }),
    getRoomRealtimeSnapshot(roomId),
  ]);

  const sharePath = roomHref(roomId);
  const shareUrl = roomAbsoluteHref(roomId, publicBaseUrl);
  const media = room
    ? {
        id: room.mediaAsset.id,
        title: room.mediaAsset.title,
        originalFilename: room.mediaAsset.originalFilename,
        mimeType: room.mediaAsset.mimeType,
        durationSeconds: room.mediaAsset.durationSeconds,
        posterUrl: null,
        videoUrl: storedUploadHref(room.mediaAsset.storagePath),
        absoluteVideoUrl: storedUploadAbsoluteHref(
          room.mediaAsset.storagePath,
          publicBaseUrl,
        ),
        castVideoUrl: castBaseUrl
          ? storedUploadAbsoluteHref(room.mediaAsset.storagePath, castBaseUrl)
          : null,
        audioTrackCount: room.mediaAsset._count.audioTracks,
        subtitleTrackCount: room.mediaAsset._count.subtitleTracks,
        audioTracks: room.mediaAsset.audioTracks.map((track) => ({
          id: track.id,
          label: track.label,
          language: track.language,
          originalFormat: track.originalFormat,
          url: storedUploadHref(track.normalizedPath),
          absoluteUrl: storedUploadAbsoluteHref(
            track.normalizedPath,
            publicBaseUrl,
          ),
          isDefault: track.isDefault,
        })),
        subtitleTracks: room.mediaAsset.subtitleTracks.map((track) => ({
          id: track.id,
          label: track.label,
          language: track.language,
          originalFormat: track.originalFormat,
          url: track.normalizedPath ? storedUploadHref(track.normalizedPath) : null,
          absoluteUrl: track.normalizedPath
            ? storedUploadAbsoluteHref(track.normalizedPath, publicBaseUrl)
            : null,
          castUrl: track.normalizedPath && castBaseUrl
            ? storedUploadAbsoluteHref(track.normalizedPath, castBaseUrl)
            : null,
          isDefault: track.isDefault,
          isRenderable: track.isRenderable && Boolean(track.normalizedPath),
        })),
      }
    : null;
  const movie = room?.catalogMovie
    ? {
        id: room.catalogMovie.id,
        slug: room.catalogMovie.slug,
        title: room.catalogMovie.title,
        synopsis: room.catalogMovie.synopsis,
        posterUrl: room.catalogMovie.posterPath
          ? storedUploadHref(room.catalogMovie.posterPath)
          : null,
        releaseLabel: room.catalogMovie.releaseLabel,
        languageAvailabilityLabel: buildLanguageAvailabilityLabel(room),
      }
    : null;

  const snapshot: RoomScaffoldSnapshot = {
    roomId,
    sharePath,
    shareUrl,
    origins: {
      appOrigin: getUrlOrigin(shareUrl),
      mediaOrigin: getUrlOrigin(media?.absoluteVideoUrl),
      castMediaOrigin: getUrlOrigin(media?.castVideoUrl),
      effectiveAppBaseUrl: publicBaseUrl,
      effectiveCastBaseUrl: castBaseUrl,
    },
    playback: realtimeSnapshot?.playback ?? createInitialPlaybackState(),
    lastEvent: realtimeSnapshot?.lastEvent ?? null,
    movie,
    media,
  };

  return snapshot;
}
