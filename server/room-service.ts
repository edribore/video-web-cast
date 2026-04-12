import "server-only";

import { createPublicRoomId } from "@/lib/room-id";
import { getPrismaClient } from "@/server/prisma";

export async function createRoomForMediaAsset(
  mediaAssetId: string,
  options?: {
    catalogMovieId?: string | null;
    roomName?: string | null;
  },
) {
  const prisma = getPrismaClient();

  return prisma.room.create({
    data: {
      mediaAssetId,
      catalogMovieId: options?.catalogMovieId ?? null,
      name: options?.roomName ?? null,
      publicId: createPublicRoomId(),
      playbackState: {
        create: {},
      },
    },
    select: {
      id: true,
      publicId: true,
      mediaAssetId: true,
    },
  });
}

export async function createRoomForCatalogMovie(catalogMovieId: string) {
  const prisma = getPrismaClient();
  const movie = await prisma.catalogMovie.findUnique({
    where: {
      id: catalogMovieId,
    },
    select: {
      id: true,
      title: true,
      isActive: true,
      mediaAssetId: true,
    },
  });

  if (!movie || !movie.mediaAssetId || !movie.isActive) {
    throw new Error("This featured movie is not ready for room creation.");
  }

  return createRoomForMediaAsset(movie.mediaAssetId, {
    catalogMovieId: movie.id,
    roomName: movie.title,
  });
}
