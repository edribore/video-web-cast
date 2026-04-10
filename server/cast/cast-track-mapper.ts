import "server-only";

import { isCastableAbsoluteUrl } from "@/lib/public-origin";
import { storedUploadAbsoluteHref } from "@/lib/routes";
import type { CastTextTrack } from "@/types/cast";

type CastAudioTrackRecord = {
  id: string;
  isDefault: boolean;
  label: string;
  language: string;
  normalizedPath: string;
};

type CastSubtitleTrackRecord = {
  id: string;
  isDefault: boolean;
  isRenderable: boolean;
  label: string;
  language: string;
  normalizedPath: string | null;
};

function normalizeTrackId(trackId: string | null | undefined) {
  if (!trackId) {
    return null;
  }

  const normalizedTrackId = trackId.trim();
  return normalizedTrackId.length > 0 ? normalizedTrackId : null;
}

export function resolveSelectedAudioTrack(
  audioTracks: CastAudioTrackRecord[],
  requestedAudioTrackId: string | null | undefined,
) {
  const normalizedTrackId = normalizeTrackId(requestedAudioTrackId);

  if (!normalizedTrackId) {
    return null;
  }

  return audioTracks.find((track) => track.id === normalizedTrackId) ?? null;
}

export function resolveSelectedSubtitleTrack(
  subtitleTracks: CastSubtitleTrackRecord[],
  requestedSubtitleTrackId: string | null | undefined,
) {
  const normalizedTrackId = normalizeTrackId(requestedSubtitleTrackId);

  if (!normalizedTrackId) {
    return null;
  }

  return subtitleTracks.find((track) => track.id === normalizedTrackId) ?? null;
}

export function buildCastTextTrackPayload(options: {
  castBaseUrl: string | null;
  requestedSubtitleTrackId: string | null;
  subtitleTracks: CastSubtitleTrackRecord[];
}) {
  const textTracks: CastTextTrack[] = [];
  let activeTrackIds: number[] = [];
  let selectedSubtitleTrackId: string | null = null;

  options.subtitleTracks.forEach((track) => {
    if (!track.isRenderable || !track.normalizedPath) {
      return;
    }

    const trackContentId = storedUploadAbsoluteHref(
      track.normalizedPath,
      options.castBaseUrl,
    );

    if (!isCastableAbsoluteUrl(trackContentId)) {
      return;
    }

    const castTextTrack: CastTextTrack = {
      trackId: textTracks.length + 1,
      trackContentId,
      trackContentType: "text/vtt",
      name: track.label,
      language: track.language === "und" ? "en" : track.language,
      subtype: "SUBTITLES",
    };

    textTracks.push(castTextTrack);

    if (track.id === options.requestedSubtitleTrackId) {
      selectedSubtitleTrackId = track.id;
      activeTrackIds = [castTextTrack.trackId];
    }
  });

  return {
    activeTrackIds,
    selectedSubtitleTrackId,
    textTracks,
  };
}
