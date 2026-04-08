export const acceptedVideoMimeTypes = ["video/mp4"] as const;
export const acceptedAudioMimeTypes = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "video/webm",
  "application/ogg",
] as const;

export const acceptedAudioExtensions = [
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg",
  ".webm",
] as const;

export const acceptedSubtitleExtensions = [
  ".srt",
  ".vtt",
  ".ass",
  ".ssa",
  ".ttml",
] as const;

export function buildVideoAcceptValue() {
  return [".mp4", ...acceptedVideoMimeTypes].join(",");
}

export function buildAudioAcceptValue() {
  return [...acceptedAudioExtensions, ...acceptedAudioMimeTypes].join(",");
}

export function buildSubtitleAcceptValue() {
  return acceptedSubtitleExtensions.join(",");
}

export function isAcceptedVideoFile(fileType: string, filename: string) {
  const lowercaseFilename = filename.toLowerCase();
  return (
    acceptedVideoMimeTypes.includes(fileType as (typeof acceptedVideoMimeTypes)[number]) ||
    lowercaseFilename.endsWith(".mp4")
  );
}

export function isAcceptedAudioFile(fileType: string, filename: string) {
  const lowercaseFilename = filename.toLowerCase();

  return (
    acceptedAudioMimeTypes.includes(
      fileType as (typeof acceptedAudioMimeTypes)[number],
    ) || acceptedAudioExtensions.some((extension) => lowercaseFilename.endsWith(extension))
  );
}

export function isAcceptedSubtitleExtension(extension: string) {
  return acceptedSubtitleExtensions.includes(
    extension as (typeof acceptedSubtitleExtensions)[number],
  );
}
