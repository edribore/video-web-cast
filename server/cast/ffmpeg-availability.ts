import "server-only";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type FfmpegBinaryResolutionSource = "env" | "path" | "common_path";

export type FfmpegAvailabilityDiagnostics = {
  ffmpegAvailable: boolean;
  ffmpegBinary: string | null;
  ffmpegFailureReason: string | null;
  checkedBinaryCandidates: string[];
  resolutionSource: FfmpegBinaryResolutionSource | null;
};

type CachedFfmpegAvailability = {
  expiresAt: number;
  result: FfmpegAvailabilityDiagnostics;
};

type FfmpegBinaryCandidate = {
  binary: string;
  source: FfmpegBinaryResolutionSource;
};

type FfmpegProbeResult = {
  ok: boolean;
  failureReason: string | null;
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

function normalizeBinaryCandidate(candidate: string | null | undefined) {
  if (!candidate) {
    return null;
  }

  const normalizedCandidate = candidate.trim();
  return normalizedCandidate.length > 0 ? normalizedCandidate : null;
}

function getConfiguredFfmpegBinary() {
  return normalizeBinaryCandidate(
    process.env.FFMPEG_BIN ?? process.env.FFMPEG_PATH ?? null,
  );
}

function getPathLookupCandidates() {
  if (process.platform === "win32") {
    return ["ffmpeg.exe", "ffmpeg"];
  }

  return ["ffmpeg"];
}

function getCommonPathCandidates() {
  if (process.platform === "win32") {
    const programFiles = normalizeBinaryCandidate(process.env.ProgramFiles);
    const localAppData = normalizeBinaryCandidate(process.env.LOCALAPPDATA);

    return [
      programFiles
        ? path.join(programFiles, "ffmpeg", "bin", "ffmpeg.exe")
        : null,
      localAppData
        ? path.join(localAppData, "Microsoft", "WinGet", "Packages")
        : null,
    ].filter((candidate): candidate is string => candidate != null);
  }

  return [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/home/site/wwwroot/bin/ffmpeg",
    "/home/site/deployments/tools/ffmpeg",
    path.join(os.homedir(), "bin", "ffmpeg"),
  ];
}

function buildFfmpegCandidateList() {
  const seenCandidates = new Set<string>();
  const candidates: FfmpegBinaryCandidate[] = [];

  const appendCandidate = (
    binary: string | null | undefined,
    source: FfmpegBinaryResolutionSource,
  ) => {
    const normalizedBinary = normalizeBinaryCandidate(binary);

    if (!normalizedBinary) {
      return;
    }

    const dedupeKey =
      process.platform === "win32"
        ? normalizedBinary.toLowerCase()
        : normalizedBinary;

    if (seenCandidates.has(dedupeKey)) {
      return;
    }

    seenCandidates.add(dedupeKey);
    candidates.push({
      binary: normalizedBinary,
      source,
    });
  };

  appendCandidate(getConfiguredFfmpegBinary(), "env");
  getPathLookupCandidates().forEach((candidate) => {
    appendCandidate(candidate, "path");
  });
  getCommonPathCandidates().forEach((candidate) => {
    appendCandidate(candidate, "common_path");
  });

  return candidates;
}

async function probeFfmpegBinary(binary: string): Promise<FfmpegProbeResult> {
  return new Promise<FfmpegProbeResult>((resolve) => {
    const child = spawn(binary, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: FfmpegProbeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      finish({
        ok: false,
        failureReason:
          error instanceof Error
            ? error.message
            : "ffmpeg could not be started while probing availability.",
      });
    });

    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        finish({
          ok: true,
          failureReason: null,
        });
        return;
      }

      const stderrTail = trimOutputTail(stderr);
      const stdoutTail = trimOutputTail(stdout);

      finish({
        ok: false,
        failureReason:
          stderrTail ??
          stdoutTail ??
          `ffmpeg exited with code ${exitCode ?? "unknown"} while probing availability.`,
      });
    });
  });
}

async function detectFfmpegAvailability(): Promise<FfmpegAvailabilityDiagnostics> {
  const candidates = buildFfmpegCandidateList();
  const checkedBinaryCandidates = candidates.map((candidate) => candidate.binary);
  const failureReasons: string[] = [];

  for (const candidate of candidates) {
    const probeResult = await probeFfmpegBinary(candidate.binary);

    if (probeResult.ok) {
      return {
        ffmpegAvailable: true,
        ffmpegBinary: candidate.binary,
        ffmpegFailureReason: null,
        checkedBinaryCandidates,
        resolutionSource: candidate.source,
      };
    }

    if (probeResult.failureReason) {
      failureReasons.push(`${candidate.binary}: ${probeResult.failureReason}`);
    }
  }

  const fallbackFailureReason =
    failureReasons.length > 0
      ? failureReasons.join(" | ")
      : "ffmpeg could not be resolved from FFMPEG_BIN, FFMPEG_PATH, PATH, or the common binary locations checked by the server.";

  return {
    ffmpegAvailable: false,
    ffmpegBinary: null,
    ffmpegFailureReason: fallbackFailureReason,
    checkedBinaryCandidates,
    resolutionSource: null,
  };
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

  const result = await detectFfmpegAvailability();

  cachedFfmpegAvailability = {
    expiresAt: Date.now() + ffmpegAvailabilityCacheTtlMs,
    result,
  };

  return result;
}

export async function requireResolvedFfmpegBinary() {
  const availability = await getFfmpegAvailability();

  return availability.ffmpegAvailable ? availability.ffmpegBinary : null;
}
