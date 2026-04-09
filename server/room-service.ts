import "server-only";

import { createPublicRoomId } from "@/lib/room-id";
import { getPrismaClient } from "@/server/prisma";

export async function createRoomForMediaAsset(mediaAssetId: string) {
  const prisma = getPrismaClient();

  return prisma.room.create({
    data: {
      mediaAssetId,
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