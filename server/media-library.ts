import "server-only";

import {
  AudioTrackFormat,
  MediaAssetSourceType,
  MediaAssetType,
  SubtitleFormat,
} from "@/app/generated/prisma/client";
import {
  buildMediaTitle,
  getFileExtension,
  humanizeFilenameStem,
  replaceFileExtension,
} from "@/lib/file-names";
import { createSafeId } from "@/lib/create-safe-id";
import {
  buildAudioAcceptValue,
  buildSubtitleAcceptValue,
  buildVideoAcceptValue,
  isAcceptedAudioFile,
  isAcceptedSubtitleExtension,
  isAcceptedVideoFile,
} from "@/lib/media";
import { prisma } from "@/server/prisma";
import { getLocalFileStorage } from "@/server/storage/local-file-storage";
import { convertSrtToWebVtt } from "@/server/subtitles/srt-to-vtt";
import type { UploadFormState, UploadScaffoldConfig } from "@/types/upload";

type PrismaSubtitleFormat = (typeof SubtitleFormat)[keyof typeof SubtitleFormat];
type PrismaAudioTrackFormat = (typeof AudioTrackFormat)[keyof typeof AudioTrackFormat];

type ParsedTrackSubmission = {
  file: File;
  language: string;
  label: string;
  isDefault: boolean;
};

type ParsedUploadSubmission = {
  titleInput: string;
  resolvedTitle: string;
  videoFile: File;
  audioTracks: ParsedTrackSubmission[];
  subtitleTracks: ParsedTrackSubmission[];
};

type TrackParseOptions = {
  fileFieldName: string;
  languageFieldName: string;
  labelFieldName: string;
  defaultIndexFieldName: string;
  groupLabel: "audio" | "subtitle";
};

function createValidationState(
  title: string,
  message: string,
  fieldErrors: UploadFormState["fieldErrors"],
): UploadFormState {
  return {
    status: "error",
    message,
    fieldErrors,
    values: {
      title,
    },
  };
}

function isFilledFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0 && value.name.trim().length > 0;
}

function normalizeLanguageCode(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || "und";
}

function isValidLanguageCode(value: string) {
  return value === "und" || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value);
}

function resolveSubtitleFormat(extension: string): PrismaSubtitleFormat {
  switch (extension) {
    case ".srt":
      return SubtitleFormat.srt;
    case ".vtt":
      return SubtitleFormat.vtt;
    case ".ass":
      return SubtitleFormat.ass;
    case ".ssa":
      return SubtitleFormat.ssa;
    case ".ttml":
      return SubtitleFormat.ttml;
    default:
      return SubtitleFormat.other;
  }
}

function resolveAudioTrackFormat(extension: string): PrismaAudioTrackFormat {
  switch (extension) {
    case ".mp3":
      return AudioTrackFormat.mp3;
    case ".aac":
      return AudioTrackFormat.aac;
    case ".m4a":
      return AudioTrackFormat.m4a;
    case ".wav":
      return AudioTrackFormat.wav;
    case ".ogg":
      return AudioTrackFormat.ogg;
    case ".webm":
      return AudioTrackFormat.webm;
    default:
      return AudioTrackFormat.other;
  }
}

function parseTrackSubmissions(
  formData: FormData,
  titleInput: string,
  options: TrackParseOptions,
): { success: true; data: ParsedTrackSubmission[] } | { success: false; state: UploadFormState } {
  const fileEntries = formData.getAll(options.fileFieldName);
  const languageEntries = formData.getAll(options.languageFieldName);
  const labelEntries = formData.getAll(options.labelFieldName);
  const rawDefaultIndex = formData.get(options.defaultIndexFieldName);
  const requestedDefaultIndex =
    typeof rawDefaultIndex === "string" && rawDefaultIndex !== ""
      ? Number(rawDefaultIndex)
      : null;

  const parsedTracks: ParsedTrackSubmission[] = [];
  const rowCount = Math.max(
    fileEntries.length,
    languageEntries.length,
    labelEntries.length,
  );

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const fileEntry = fileEntries[rowIndex] ?? null;
    const languageEntry = languageEntries[rowIndex];
    const labelEntry = labelEntries[rowIndex];
    const languageInput =
      typeof languageEntry === "string" ? languageEntry.trim() : "";
    const labelInput = typeof labelEntry === "string" ? labelEntry.trim() : "";

    if (!isFilledFile(fileEntry)) {
      if (languageInput || labelInput) {
        return {
          success: false,
          state: createValidationState(
            titleInput,
            `Each ${options.groupLabel} track row needs a file before it can be saved.`,
            {
              [options.groupLabel === "audio" ? "audioTracks" : "subtitleTracks"]:
                `Remove the extra ${options.groupLabel} track metadata or attach a file for that row.`,
            },
          ),
        };
      }

      continue;
    }

    if (options.groupLabel === "audio") {
      if (!isAcceptedAudioFile(fileEntry.type, fileEntry.name)) {
        return {
          success: false,
          state: createValidationState(
            titleInput,
            "One or more audio tracks use an unsupported file type.",
            {
              audioTracks:
                "Supported audio track formats are .mp3, .m4a, .aac, .wav, .ogg, and .webm.",
            },
          ),
        };
      }
    } else if (!isAcceptedSubtitleExtension(getFileExtension(fileEntry.name))) {
      return {
        success: false,
        state: createValidationState(
          titleInput,
          "One or more subtitle tracks use an unsupported file extension.",
          {
            subtitleTracks:
              "Supported subtitle formats are .srt, .vtt, .ass, .ssa, and .ttml.",
          },
        ),
      };
    }

    const language = normalizeLanguageCode(languageInput);

    if (!isValidLanguageCode(language)) {
      return {
        success: false,
        state: createValidationState(
          titleInput,
          `One or more ${options.groupLabel} tracks use an invalid language code.`,
          {
            [options.groupLabel === "audio" ? "audioTracks" : "subtitleTracks"]:
              "Use a short language code such as en, es, fr, or pt-br.",
          },
        ),
      };
    }

    parsedTracks.push({
      file: fileEntry,
      language,
      label: labelInput || humanizeFilenameStem(fileEntry.name),
      isDefault: rowIndex === requestedDefaultIndex,
    });
  }

  if (parsedTracks.length > 0 && !parsedTracks.some((track) => track.isDefault)) {
    parsedTracks[0] = {
      ...parsedTracks[0],
      isDefault: true,
    };
  }

  return {
    success: true,
    data: parsedTracks,
  };
}

function buildStoredAudioTrackPayload(track: ParsedTrackSubmission, sourcePath: string) {
  return {
    language: track.language,
    label: track.label,
    originalFormat: resolveAudioTrackFormat(getFileExtension(track.file.name)),
    sourcePath,
    normalizedPath: sourcePath,
    isDefault: track.isDefault,
  };
}

async function buildStoredSubtitleTrackPayload(
  track: ParsedTrackSubmission,
  storageScope: string,
) {
  const storage = getLocalFileStorage();
  const sourceBytes = new Uint8Array(await track.file.arrayBuffer());
  const storedSourceFile = await storage.saveFile({
    directory: `${storageScope}/subtitles/source`,
    originalFilename: track.file.name,
    bytes: sourceBytes,
    contentType: track.file.type || "text/plain",
  });
  const originalFormat = resolveSubtitleFormat(getFileExtension(track.file.name));

  if (originalFormat === SubtitleFormat.vtt) {
    return {
      language: track.language,
      label: track.label,
      originalFormat,
      sourcePath: storedSourceFile.relativePath,
      normalizedPath: storedSourceFile.relativePath,
      isRenderable: true,
      isDefault: track.isDefault,
    };
  }

  if (originalFormat === SubtitleFormat.srt) {
    const vttBytes = new TextEncoder().encode(
      convertSrtToWebVtt(new TextDecoder().decode(sourceBytes)),
    );
    const storedNormalizedFile = await storage.saveFile({
      directory: `${storageScope}/subtitles/normalized`,
      originalFilename: replaceFileExtension(track.file.name, ".vtt"),
      bytes: vttBytes,
      contentType: "text/vtt; charset=utf-8",
    });

    return {
      language: track.language,
      label: track.label,
      originalFormat,
      sourcePath: storedSourceFile.relativePath,
      normalizedPath: storedNormalizedFile.relativePath,
      isRenderable: true,
      isDefault: track.isDefault,
    };
  }

  return {
    language: track.language,
    label: track.label,
    originalFormat,
    sourcePath: storedSourceFile.relativePath,
    normalizedPath: null,
    // TODO: Normalize ASS/SSA/TTML uploads into WebVTT when that pipeline is added.
    isRenderable: false,
    isDefault: track.isDefault,
  };
}

export function getUploadScaffoldConfig(): UploadScaffoldConfig {
  return {
    videoAccept: buildVideoAcceptValue(),
    audioAccept: buildAudioAcceptValue(),
    subtitleAccept: buildSubtitleAcceptValue(),
    allowMultipleAudioTracks: true,
    allowMultipleSubtitles: true,
  };
}

export function validateUploadSubmission(
  formData: FormData,
): { success: true; data: ParsedUploadSubmission } | { success: false; state: UploadFormState } {
  const rawTitleValue = formData.get("title");
  const titleInput = typeof rawTitleValue === "string" ? rawTitleValue.trim() : "";
  const videoFileValue = formData.get("videoFile");

  if (!isFilledFile(videoFileValue)) {
    return {
      success: false,
      state: createValidationState(titleInput, "Select one MP4 video file to continue.", {
        videoFile: "An MP4 video file is required.",
      }),
    };
  }

  if (!isAcceptedVideoFile(videoFileValue.type, videoFileValue.name)) {
    return {
      success: false,
      state: createValidationState(titleInput, "The selected video must be an MP4 file.", {
        videoFile: "Only MP4 video files are supported for this MVP.",
      }),
    };
  }

  if (titleInput.length > 120) {
    return {
      success: false,
      state: createValidationState(titleInput, "Keep the title at 120 characters or fewer.", {
        title: "Title must be 120 characters or fewer.",
      }),
    };
  }

  const parsedAudioTracks = parseTrackSubmissions(formData, titleInput, {
    fileFieldName: "audioTrackFiles",
    languageFieldName: "audioTrackLanguages",
    labelFieldName: "audioTrackLabels",
    defaultIndexFieldName: "defaultAudioTrackIndex",
    groupLabel: "audio",
  });

  if (!parsedAudioTracks.success) {
    return parsedAudioTracks;
  }

  const parsedSubtitleTracks = parseTrackSubmissions(formData, titleInput, {
    fileFieldName: "subtitleTrackFiles",
    languageFieldName: "subtitleTrackLanguages",
    labelFieldName: "subtitleTrackLabels",
    defaultIndexFieldName: "defaultSubtitleTrackIndex",
    groupLabel: "subtitle",
  });

  if (!parsedSubtitleTracks.success) {
    return parsedSubtitleTracks;
  }

  return {
    success: true,
    data: {
      titleInput,
      resolvedTitle: buildMediaTitle(titleInput, videoFileValue.name),
      videoFile: videoFileValue,
      audioTracks: parsedAudioTracks.data,
      subtitleTracks: parsedSubtitleTracks.data,
    },
  };
}

export async function createUploadedMediaAsset(input: ParsedUploadSubmission) {
  const storage = getLocalFileStorage();
  const storageScope = `media-assets/${createSafeId("asset")}`;

  try {
    const videoBytes = new Uint8Array(await input.videoFile.arrayBuffer());
    const storedVideo = await storage.saveFile({
      directory: `${storageScope}/video`,
      originalFilename: input.videoFile.name,
      bytes: videoBytes,
      contentType: input.videoFile.type || "video/mp4",
    });

    const storedAudioTracks = await Promise.all(
      input.audioTracks.map(async (track) => {
        const audioBytes = new Uint8Array(await track.file.arrayBuffer());
        const storedAudioFile = await storage.saveFile({
          directory: `${storageScope}/audio`,
          originalFilename: track.file.name,
          bytes: audioBytes,
          contentType: track.file.type || "application/octet-stream",
        });

        return buildStoredAudioTrackPayload(track, storedAudioFile.relativePath);
      }),
    );

    const storedSubtitleTracks = await Promise.all(
      input.subtitleTracks.map((track) =>
        buildStoredSubtitleTrackPayload(track, storageScope),
      ),
    );

    return prisma.mediaAsset.create({
      data: {
        assetType: MediaAssetType.video,
        sourceType: MediaAssetSourceType.upload,
        title: input.resolvedTitle,
        originalFilename: input.videoFile.name,
        mimeType: "video/mp4",
        storagePath: storedVideo.relativePath,
        audioTracks: {
          create: storedAudioTracks,
        },
        subtitleTracks: {
          create: storedSubtitleTracks,
        },
      },
      include: {
        audioTracks: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
        subtitleTracks: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });
  } catch (error) {
    await storage.removeDirectory(storageScope);
    throw error;
  }
}

export async function getMediaAssetDetails(mediaId: string) {
  return prisma.mediaAsset.findUnique({
    where: {
      id: mediaId,
    },
    include: {
      audioTracks: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
      subtitleTracks: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  });
}
