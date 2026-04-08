import "server-only";

import { createInitialPlaybackState } from "@/lib/playback";
import {
  roomAbsoluteHref,
  roomHref,
  storedUploadAbsoluteHref,
  storedUploadHref,
} from "@/lib/routes";
import { getUrlOrigin } from "@/lib/public-origin";
import { prisma } from "@/server/prisma";
import { getRoomRealtimeSnapshot } from "@/server/room-realtime";
import type { RoomScaffoldSnapshot } from "@/types/room-sync";

export async function getRoomScaffoldSnapshot(
  roomId: string,
  publicBaseUrl: string | null,
  castBaseUrl: string | null,
): Promise<RoomScaffoldSnapshot> {
  const [room, realtimeSnapshot] = await Promise.all([
    prisma.room.findUnique({
      where: {
        publicId: roomId,
      },
      include: {
        mediaAsset: {
          select: {
            id: true,
            title: true,
            originalFilename: true,
            mimeType: true,
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
    media,
  };

  // Future group video call signaling should stay adjacent to room sync, but
  // separate from playback state so those concerns can evolve independently.
  return snapshot;
}
