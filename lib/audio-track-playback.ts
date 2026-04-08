import type { RoomAudioTrackSummary } from "@/types/room-sync";

export type AudioTrackPlaybackSupport = {
  trackId: string;
  availability: "playable" | "unavailable";
  mimeType: string | null;
  supportLevel: "" | "maybe" | "probably";
  issue: string | null;
};

const audioMimeCandidatesByFormat: Record<string, string[]> = {
  mp3: ["audio/mpeg"],
  m4a: ["audio/mp4"],
  aac: ["audio/aac", "audio/mp4"],
  wav: ["audio/wav", "audio/x-wav"],
  ogg: ["audio/ogg", "application/ogg"],
  webm: ["audio/webm", "video/webm"],
};

export function resolveAudioTrackMimeCandidates(originalFormat: string) {
  return audioMimeCandidatesByFormat[originalFormat.toLowerCase()] ?? [];
}

export function assessAudioTrackPlaybackSupport(
  track: RoomAudioTrackSummary,
  canPlayType: (mimeType: string) => string,
): AudioTrackPlaybackSupport {
  const mimeCandidates = resolveAudioTrackMimeCandidates(track.originalFormat);
  let resolvedMimeType: string | null = null;
  let supportLevel: AudioTrackPlaybackSupport["supportLevel"] = "";

  for (const mimeType of mimeCandidates) {
    const candidateSupport = canPlayType(mimeType) as
      | AudioTrackPlaybackSupport["supportLevel"]
      | "";

    if (!candidateSupport) {
      continue;
    }

    if (candidateSupport === "probably") {
      resolvedMimeType = mimeType;
      supportLevel = candidateSupport;
      break;
    }

    if (!resolvedMimeType) {
      resolvedMimeType = mimeType;
      supportLevel = candidateSupport;
    }
  }

  if (resolvedMimeType) {
    return {
      trackId: track.id,
      availability: "playable",
      mimeType: resolvedMimeType,
      supportLevel,
      issue: null,
    };
  }

  return {
    trackId: track.id,
    availability: "unavailable",
    mimeType: mimeCandidates[0] ?? null,
    supportLevel: "",
    issue: "Stored only / unavailable in this browser.",
  };
}

export function isPlayableAudioTrackSupport(
  support: AudioTrackPlaybackSupport | null | undefined,
) {
  return support?.availability === "playable";
}
