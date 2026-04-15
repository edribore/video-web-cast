import { resolveCastPublicBaseUrl } from "@/lib/public-origin";
import { resolveCastMediaForRoom } from "@/server/cast/cast-media-resolver";

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
  const preferredAudioLanguages = requestUrl.searchParams.getAll(
    "preferredAudioLanguage",
  );
  const subtitleTrackId = requestUrl.searchParams.get("subtitleTrackId");

  try {
    const payload = await resolveCastMediaForRoom({
      castBaseUrl: resolveCastPublicBaseUrl(request.headers),
      preferredAudioLanguages,
      requestedAudioTrackId: audioTrackId,
      requestedSubtitleTrackId: subtitleTrackId,
      roomId,
    });

    return Response.json(payload, {
      headers: buildJsonHeaders(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        errorCode: "cast_resolve_failed",
        message: "The Cast media payload could not be resolved.",
        castMode: "resolver_error",
        selectedAudioTrackId: audioTrackId,
        selectedSubtitleTrackId: subtitleTrackId,
        resolvedEffectiveAudioTrackId: null,
        resolvedEffectiveSubtitleTrackId: null,
        castFallbackApplied: false,
        castFallbackReason: null,
        warnings: [],
        diagnostics: {
          requestedAudioTrackId: audioTrackId,
          requestedSubtitleTrackId: subtitleTrackId,
          effectiveAudioTrackId: null,
          effectiveSubtitleTrackId: null,
          subtitlesIncluded: false,
          variantCacheKey: null,
          variantId: null,
          variantStoragePath: null,
          variantStatus: "failed",
          ffmpegStatus: "failed",
          ffmpegAvailable: null,
          ffmpegBinary: null,
          ffmpegFailureReason:
            error instanceof Error ? error.message : "Unknown resolver failure.",
        },
      },
      {
        headers: buildJsonHeaders(),
        status: 500,
      },
    );
  }
}
