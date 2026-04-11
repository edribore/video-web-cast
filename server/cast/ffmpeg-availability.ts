import "server-only";

import { spawn } from "node:child_process";

export type FfmpegAvailabilityDiagnostics = {
  available: boolean;
  binary: string | null;
  failureReason: string | null;
};

type CachedFfmpegAvailability = {
  expiresAt: number;
  result: FfmpegAvailabilityDiagnostics;
};

const ffmpegAvailabilityCacheTtlMs = 30_000;
const ffmpegProbeLogTailLength = 1000;
let cachedFfmpegAvailability: CachedFfmpegAvailability | null = null;

function trimOutputTail(value: string) {
  if (!value) {
    return null;
  }

  if (value.length <= ffmpegProbeLogTailLength) {
    return value;
  }

  return value.slice(-ffmpegProbeLogTailLength);
}

export function resolveConfiguredFfmpegBinary() {
  const configuredBinary = process.env.FFMPEG_BIN || process.env.FFMPEG_PATH;

  if (!configuredBinary) {
    return "ffmpeg";
  }

  const normalizedBinary = configuredBinary.trim();
  return normalizedBinary.length > 0 ? normalizedBinary : "ffmpeg";
}

async function probeFfmpegAvailability(
  binary: string,
): Promise<FfmpegAvailabilityDiagnostics> {
  return new Promise<FfmpegAvailabilityDiagnostics>((resolve) => {
    const child = spawn(binary, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;

    const finish = (result: FfmpegAvailabilityDiagnostics) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      finish({
        available: false,
        binary: null,
        failureReason:
          error instanceof Error
            ? error.message
            : "ffmpeg could not be started while probing availability.",
      });
    });

    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        finish({
          available: true,
          binary,
          failureReason: null,
        });
        return;
      }

      finish({
        available: false,
        binary: null,
        failureReason: trimOutputTail(stderr)
          ? `ffmpeg exited with code ${exitCode ?? "unknown"} while probing availability. ${trimOutputTail(stderr)}`
          : `ffmpeg exited with code ${exitCode ?? "unknown"} while probing availability.`,
      });
    });
  });
}

export async function getFfmpegAvailability(options?: {
  forceRefresh?: boolean;
}) {
  if (
    !options?.forceRefresh &&
    cachedFfmpegAvailability &&
    cachedFfmpegAvailability.expiresAt > Date.now()
  ) {
    return cachedFfmpegAvailability.result;
  }

  const result = await probeFfmpegAvailability(resolveConfiguredFfmpegBinary());

  cachedFfmpegAvailability = {
    expiresAt: Date.now() + ffmpegAvailabilityCacheTtlMs,
    result,
  };

  return result;
}
