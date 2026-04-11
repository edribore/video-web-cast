import "server-only";

import { spawn } from "node:child_process";
import { getFfmpegAvailability } from "@/server/cast/ffmpeg-availability";

const ffmpegLogTailLength = 4000;

export type CastFfmpegMuxInput = {
  audioInputPath: string;
  audioLanguage: string;
  audioLabel: string;
  outputPath: string;
  videoInputPath: string;
};

export type CastFfmpegRunDiagnostics = {
  ffmpegBinary: string;
  command: string;
  exitCode: number | null;
  stderrTail: string | null;
  stdoutTail: string | null;
};

export class CastFfmpegError extends Error {
  diagnostics: CastFfmpegRunDiagnostics;

  constructor(message: string, diagnostics: CastFfmpegRunDiagnostics) {
    super(message);
    this.name = "CastFfmpegError";
    this.diagnostics = diagnostics;
  }
}

function trimOutputTail(value: string) {
  if (!value) {
    return null;
  }

  if (value.length <= ffmpegLogTailLength) {
    return value;
  }

  return value.slice(-ffmpegLogTailLength);
}

function buildCommandString(binary: string, args: string[]) {
  return [binary, ...args]
    .map((part) =>
      /\s/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part,
    )
    .join(" ");
}

export async function muxCastVariantToMp4(
  input: CastFfmpegMuxInput,
): Promise<CastFfmpegRunDiagnostics> {
  const ffmpegAvailability = await getFfmpegAvailability();
  const ffmpegBinary = ffmpegAvailability.ffmpegBinary ?? "ffmpeg";
  const args = [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.videoInputPath,
    "-i",
    input.audioInputPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-metadata:s:a:0",
    `language=${input.audioLanguage}`,
    "-metadata:s:a:0",
    `title=${input.audioLabel}`,
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
  const command = buildCommandString(ffmpegBinary, args);

  if (!ffmpegAvailability.ffmpegAvailable || !ffmpegAvailability.ffmpegBinary) {
    throw new CastFfmpegError(
      ffmpegAvailability.ffmpegFailureReason ??
        "Cast audio muxing requires ffmpeg to be installed and reachable by the server.",
      {
        ffmpegBinary,
        command,
        exitCode: null,
        stderrTail: ffmpegAvailability.ffmpegFailureReason,
        stdoutTail: null,
      },
    );
  }

  return new Promise<CastFfmpegRunDiagnostics>((resolve, reject) => {
    const child = spawn(ffmpegBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishWithError = (message: string, exitCode: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(
        new CastFfmpegError(message, {
          ffmpegBinary,
          command,
          exitCode,
          stderrTail: trimOutputTail(stderr),
          stdoutTail: trimOutputTail(stdout),
        }),
      );
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
      finishWithError(
        error instanceof Error
          ? error.message
          : "ffmpeg could not be started for Cast variant generation.",
        null,
      );
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }

      const diagnostics: CastFfmpegRunDiagnostics = {
        ffmpegBinary,
        command,
        exitCode,
        stderrTail: trimOutputTail(stderr),
        stdoutTail: trimOutputTail(stdout),
      };

      if (exitCode !== 0) {
        finishWithError(
          `ffmpeg exited with code ${exitCode ?? "unknown"} while generating the Cast-ready media variant.`,
          exitCode,
        );
        return;
      }

      settled = true;
      resolve(diagnostics);
    });
  });
}
