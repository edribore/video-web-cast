import { resolveCastPublicBaseUrl } from "@/lib/public-origin";
import {
  CastMediaResolverError,
  resolveCastMediaForRoom,
} from "@/server/cast/cast-media-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CastResolveRouteContext = {
  params: Promise<{ roomId: string }>;
};

function buildJsonHeaders() {
  return {
    "cache-control": "no-store",
  };
}

export async function GET(
  request: Request,
  context: CastResolveRouteContext,
) {
  const { roomId } = await context.params;
  const requestUrl = new URL(request.url);
  const audioTrackId = requestUrl.searchParams.get("audioTrackId");
  const subtitleTrackId = requestUrl.searchParams.get("subtitleTrackId");

  try {
    const payload = await resolveCastMediaForRoom({
      castBaseUrl: resolveCastPublicBaseUrl(request.headers),
      requestedAudioTrackId: audioTrackId,
      requestedSubtitleTrackId: subtitleTrackId,
      roomId,
    });

    return Response.json(payload, {
      headers: buildJsonHeaders(),
    });
  } catch (error) {
    if (error instanceof CastMediaResolverError) {
      return Response.json(
        {
          code: error.code,
          details: error.details ?? null,
          error: error.message,
        },
        {
          headers: buildJsonHeaders(),
          status: error.status,
        },
      );
    }

    return Response.json(
      {
        code: "cast_resolve_failed",
        details:
          error instanceof Error
            ? {
                message: error.message,
              }
            : null,
        error: "The Cast media payload could not be resolved.",
      },
      {
        headers: buildJsonHeaders(),
        status: 500,
      },
    );
  }
}
