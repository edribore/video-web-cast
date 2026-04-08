"use server";

import { redirect } from "next/navigation";
import { roomHref } from "@/lib/routes";
import { createRoomForMediaAsset } from "@/server/room-service";

export async function createRoomForMediaAction(mediaAssetId: string) {
  const room = await createRoomForMediaAsset(mediaAssetId);
  redirect(roomHref(room.publicId));
}
