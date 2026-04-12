import { resolveRequestPublicBaseUrl } from "@/lib/public-origin";
import { roomAbsoluteHref, roomHref } from "@/lib/routes";
import {
  createRoomForCatalogMovie,
  createRoomForMediaAsset,
} from "@/server/room-service";
import type {
  CreateRoomRequest,
  CreateRoomResponse,
} from "@/types/room-creation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildJsonHeaders() {
  return {
    "cache-control": "no-store",
  };
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function POST(request: Request) {
  const createdAt = new Date().toISOString();
  let body: CreateRoomRequest | null = null;

  try {
    body = (await request.json()) as CreateRoomRequest;
  } catch {
    const payload: CreateRoomResponse = {
      ok: false,
      errorCode: "invalid_json",
      message: "The room creation request body must be valid JSON.",
      catalogMovieId: null,
      mediaAssetId: null,
      createdAt,
    };

    return Response.json(payload, {
      headers: buildJsonHeaders(),
      status: 400,
    });
  }

  const catalogMovieId = normalizeOptionalString(body?.catalogMovieId);
  const mediaAssetId = normalizeOptionalString(body?.mediaAssetId);

  if (!catalogMovieId && !mediaAssetId) {
    const payload: CreateRoomResponse = {
      ok: false,
      errorCode: "missing_target",
      message:
        "A catalog movie ID or media asset ID is required to create a room.",
      catalogMovieId: null,
      mediaAssetId: null,
      createdAt,
    };

    return Response.json(payload, {
      headers: buildJsonHeaders(),
      status: 400,
    });
  }

  try {
    const room = catalogMovieId
      ? await createRoomForCatalogMovie(catalogMovieId)
      : await createRoomForMediaAsset(mediaAssetId!);
    const redirectTo = roomHref(room.publicId);
    const payload: CreateRoomResponse = {
      ok: true,
      sourceType: catalogMovieId ? "catalog_movie" : "media_asset",
      catalogMovieId,
      mediaAssetId: room.mediaAssetId,
      roomId: room.publicId,
      sharePath: redirectTo,
      shareUrl: roomAbsoluteHref(
        room.publicId,
        resolveRequestPublicBaseUrl(request.headers),
      ),
      redirectTo,
      createdAt,
    };

    return Response.json(payload, {
      headers: buildJsonHeaders(),
    });
  } catch (error) {
    const payload: CreateRoomResponse = {
      ok: false,
      errorCode: catalogMovieId
        ? "catalog_room_creation_failed"
        : "media_room_creation_failed",
      message:
        error instanceof Error
          ? error.message
          : "The room could not be created.",
      catalogMovieId,
      mediaAssetId,
      createdAt,
    };

    return Response.json(payload, {
      headers: buildJsonHeaders(),
      status: 400,
    });
  }
}
