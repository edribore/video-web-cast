import "server-only";

import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolveStoredUploadPath } from "@/server/storage/local-file-storage";
import {
  CastFfmpegError,
  type CastFfmpegRunDiagnostics,
  muxCastVariantToMp4,
} from "@/server/cast/cast-ffmpeg-service";

type CastVariantAudioTrack = {
  id: string;
  label: string;
  language: string;
  normalizedPath: string;
};

export type EnsureCastVariantInput = {
  audioTrack: CastVariantAudioTrack;
  mediaAssetId: string;
  mimeType: string;
  videoStoragePath: string;
};

export type CastVariantResult = {
  cacheKey: string;
  contentType: string;
  ffmpegDiagnostics: CastFfmpegRunDiagnostics | null;
  ffmpegFailureReason: string | null;
  ffmpegStatus: "created" | "reused" | "failed";
  storagePath: string;
  variantId: string;
  variantStatus: "created" | "reused";
};

const inflightVariantPromises = new Map<string, Promise<CastVariantResult>>();
const castVariantPipelineVersion = "muxed-mp4-v1";

function createVariantCacheKey(input: EnsureCastVariantInput) {
  return JSON.stringify({
    pipeline: castVariantPipelineVersion,
    mediaAssetId: input.mediaAssetId,
    videoStoragePath: input.videoStoragePath,
    mimeType: input.mimeType,
    audioTrackId: input.audioTrack.id,
    audioTrackPath: input.audioTrack.normalizedPath,
  });
}

function createVariantId(cacheKey: string) {
  return createHash("sha256").update(cacheKey).digest("hex").slice(0, 24);
}

function createVariantStoragePath(mediaAssetId: string, variantId: string) {
  return path.posix.join("cast-variants", mediaAssetId, variantId, "media.mp4");
}

function createVariantMetadataStoragePath(mediaAssetId: string, variantId: string) {
  return path.posix.join("cast-variants", mediaAssetId, variantId, "variant.json");
}

async function isReusableVariant(absoluteOutputPath: string) {
  try {
    const fileStats = await stat(absoluteOutputPath);
    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

export async function ensureCastVariant(
  input: EnsureCastVariantInput,
): Promise<CastVariantResult> {
  const cacheKey = createVariantCacheKey(input);
  const existingInflight = inflightVariantPromises.get(cacheKey);

  if (existingInflight) {
    return existingInflight;
  }

  const variantId = createVariantId(cacheKey);
  const storagePath = createVariantStoragePath(input.mediaAssetId, variantId);
  const metadataStoragePath = createVariantMetadataStoragePath(
    input.mediaAssetId,
    variantId,
  );
  const absoluteOutputPath = resolveStoredUploadPath(storagePath);
  const absoluteMetadataPath = resolveStoredUploadPath(metadataStoragePath);

  if (await isReusableVariant(absoluteOutputPath)) {
    return {
      cacheKey,
      contentType: "video/mp4",
      ffmpegDiagnostics: null,
      ffmpegFailureReason: null,
      ffmpegStatus: "reused",
      storagePath,
      variantId,
      variantStatus: "reused",
    };
  }

  const inflightPromise: Promise<CastVariantResult> = (async (): Promise<CastVariantResult> => {
    const absoluteVideoInputPath = resolveStoredUploadPath(input.videoStoragePath);
    const absoluteAudioInputPath = resolveStoredUploadPath(
      input.audioTrack.normalizedPath,
    );
    const outputDirectory = path.dirname(absoluteOutputPath);
    const temporaryOutputPath = path.join(
      outputDirectory,
      `media-${process.pid}-${Date.now()}.tmp.mp4`,
    );

    try {
      await mkdir(outputDirectory, { recursive: true });

      const ffmpegDiagnostics = await muxCastVariantToMp4({
        audioInputPath: absoluteAudioInputPath,
        audioLabel: input.audioTrack.label,
        audioLanguage: input.audioTrack.language,
        outputPath: temporaryOutputPath,
        videoInputPath: absoluteVideoInputPath,
      });

      if (await isReusableVariant(absoluteOutputPath)) {
        await rm(temporaryOutputPath, { force: true });
        return {
          cacheKey,
          contentType: "video/mp4",
          ffmpegDiagnostics,
          ffmpegFailureReason: null,
          ffmpegStatus: "reused",
          storagePath,
          variantId,
          variantStatus: "reused",
        };
      }

      await rename(temporaryOutputPath, absoluteOutputPath);
      await writeFile(
        absoluteMetadataPath,
        JSON.stringify(
          {
            cacheKey,
            createdAt: new Date().toISOString(),
            pipeline: castVariantPipelineVersion,
            variantId,
            videoStoragePath: input.videoStoragePath,
            audioTrackId: input.audioTrack.id,
            audioTrackPath: input.audioTrack.normalizedPath,
          },
          null,
          2,
        ),
        "utf8",
      );

      return {
        cacheKey,
        contentType: "video/mp4",
        ffmpegDiagnostics,
        ffmpegFailureReason: null,
        ffmpegStatus: "created",
        storagePath,
        variantId,
        variantStatus: "created",
      };
    } catch (error) {
      await rm(temporaryOutputPath, { force: true });

      if (error instanceof CastFfmpegError) {
        return Promise.reject(
          Object.assign(error, {
            variantCacheKey: cacheKey,
            variantId,
          }),
        );
      }

      const failureReason =
        error instanceof Error
          ? error.message
          : "The Cast media variant could not be generated.";

      return Promise.reject(
        Object.assign(new Error(failureReason), {
          variantCacheKey: cacheKey,
          variantId,
        }),
      );
    }
  })();

  inflightVariantPromises.set(cacheKey, inflightPromise);

  try {
    return await inflightPromise;
  } finally {
    if (inflightVariantPromises.get(cacheKey) === inflightPromise) {
      inflightVariantPromises.delete(cacheKey);
    }
  }
}
