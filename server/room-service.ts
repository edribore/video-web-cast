import "server-only";

import { createPublicRoomId } from "@/lib/room-id";
import { prisma } from "@/server/prisma";

export async function createRoomForMediaAsset(mediaAssetId: string) {
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
