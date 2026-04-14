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
  const mediaAsset = await prisma.mediaAsset.findUnique({
    where: {
      id: mediaAssetId,
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!mediaAsset) {
    throw new Error("The requested media asset could not be found.");
  }

  return prisma.room.create({
    data: {
      mediaAssetId: mediaAsset.id,
      catalogMovieId: options?.catalogMovieId ?? null,
      name: options?.roomName ?? mediaAsset.title,
      publicId: createPublicRoomId(),
    },
    select: {
      id: true,
      publicId: true,
      mediaAssetId: true,
      catalogMovieId: true,
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
