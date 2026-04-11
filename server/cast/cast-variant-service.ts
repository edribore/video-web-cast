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

type CastVariantSourceFingerprint = {
  byteLength: number;
  modifiedAtMs: number;
  signature: string;
};

export type CastVariantResult = {
  audioFingerprint: string;
  cacheKey: string;
  contentType: string;
  ffmpegDiagnostics: CastFfmpegRunDiagnostics | null;
  ffmpegFailureReason: string | null;
  ffmpegStatus: "created" | "reused" | "failed";
  storagePath: string;
  variantId: string;
  variantStatus: "created" | "reused";
  videoFingerprint: string;
};

const inflightVariantPromises = new Map<string, Promise<CastVariantResult>>();
const castVariantPipelineVersion = "muxed-mp4-v1";

function createVariantCacheKey(input: {
  audioFingerprint: CastVariantSourceFingerprint;
  input: EnsureCastVariantInput;
  videoFingerprint: CastVariantSourceFingerprint;
}) {
  return JSON.stringify({
    pipeline: castVariantPipelineVersion,
    mediaAssetId: input.input.mediaAssetId,
    videoStoragePath: input.input.videoStoragePath,
    videoFingerprint: input.videoFingerprint.signature,
    mimeType: input.input.mimeType,
    audioTrackId: input.input.audioTrack.id,
    audioTrackPath: input.input.audioTrack.normalizedPath,
    audioFingerprint: input.audioFingerprint.signature,
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

async function readSourceFingerprint(
  absolutePath: string,
): Promise<CastVariantSourceFingerprint> {
  const fileStats = await stat(absolutePath);

  return {
    byteLength: fileStats.size,
    modifiedAtMs: Math.round(fileStats.mtimeMs),
    signature: `${fileStats.size}:${Math.round(fileStats.mtimeMs)}`,
  };
}

export async function ensureCastVariant(
  input: EnsureCastVariantInput,
): Promise<CastVariantResult> {
  const absoluteVideoInputPath = resolveStoredUploadPath(input.videoStoragePath);
  const absoluteAudioInputPath = resolveStoredUploadPath(
    input.audioTrack.normalizedPath,
  );
  const [videoFingerprint, audioFingerprint] = await Promise.all([
    readSourceFingerprint(absoluteVideoInputPath),
    readSourceFingerprint(absoluteAudioInputPath),
  ]);
  const cacheKey = createVariantCacheKey({
    input,
    videoFingerprint,
    audioFingerprint,
  });
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
      audioFingerprint: audioFingerprint.signature,
      cacheKey,
      contentType: "video/mp4",
      ffmpegDiagnostics: null,
      ffmpegFailureReason: null,
      ffmpegStatus: "reused",
      storagePath,
      variantId,
      variantStatus: "reused",
      videoFingerprint: videoFingerprint.signature,
    };
  }

  const inflightPromise: Promise<CastVariantResult> = (async (): Promise<CastVariantResult> => {
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
          audioFingerprint: audioFingerprint.signature,
          cacheKey,
          contentType: "video/mp4",
          ffmpegDiagnostics,
          ffmpegFailureReason: null,
          ffmpegStatus: "reused",
          storagePath,
          variantId,
          variantStatus: "reused",
          videoFingerprint: videoFingerprint.signature,
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
            videoFingerprint,
            audioTrackId: input.audioTrack.id,
            audioTrackPath: input.audioTrack.normalizedPath,
            audioFingerprint,
            outputStoragePath: storagePath,
            ffmpegBinary: ffmpegDiagnostics.ffmpegBinary,
          },
          null,
          2,
        ),
        "utf8",
      );

      return {
        audioFingerprint: audioFingerprint.signature,
        cacheKey,
        contentType: "video/mp4",
        ffmpegDiagnostics,
        ffmpegFailureReason: null,
        ffmpegStatus: "created",
        storagePath,
        variantId,
        variantStatus: "created",
        videoFingerprint: videoFingerprint.signature,
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
