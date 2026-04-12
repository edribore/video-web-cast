"use server";

import { redirect } from "next/navigation";
import { roomHref } from "@/lib/routes";
import { createRoomForCatalogMovie } from "@/server/room-service";

export async function createRoomForCatalogMovieAction(catalogMovieId: string) {
  const room = await createRoomForCatalogMovie(catalogMovieId);
  redirect(roomHref(room.publicId));
}
