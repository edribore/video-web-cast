import path from "node:path";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolveStoredUploadPath } from "@/server/storage/local-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StorageRouteContext = {
  params: Promise<{ storagePath: string[] }>;
};

function getContentTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".vtt":
      return "text/vtt; charset=utf-8";
    case ".srt":
      return "application/x-subrip; charset=utf-8";
    case ".ass":
    case ".ssa":
      return "text/plain; charset=utf-8";
    case ".ttml":
      return "application/ttml+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function buildBaseHeaders(filePath: string, fileSize: number) {
  return new Headers({
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "Content-Type,Accept-Encoding,Range",
    "access-control-expose-headers":
      "Content-Length,Content-Range,Accept-Ranges,Content-Type",
    "cache-control": "no-store",
    "content-length": String(fileSize),
    "content-type": getContentTypeForPath(filePath),
  });
}

function parseByteRange(rangeHeader: string, fileSize: number) {
  if (!rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [startText, endText] = rangeHeader.slice("bytes=".length).split("-");
  const hasStart = startText !== "";
  const hasEnd = endText !== "";

  if (!hasStart && !hasEnd) {
    return null;
  }

  let start = hasStart ? Number(startText) : NaN;
  let end = hasEnd ? Number(endText) : NaN;

  if (hasStart && Number.isNaN(start)) {
    return null;
  }

  if (hasEnd && Number.isNaN(end)) {
    return null;
  }

  if (!hasStart && hasEnd) {
    const suffixLength = Number(endText);

    if (suffixLength <= 0) {
      return null;
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = hasEnd ? Number(endText) : fileSize - 1;
  }

  if (start < 0 || end < start || start >= fileSize) {
    return null;
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

function createFileResponseStream(
  filePath: string,
  byteRange?: { start: number; end: number },
) {
  const fileStream = byteRange
    ? createReadStream(filePath, byteRange)
    : createReadStream(filePath);
  let settled = false;
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        controller.close();
      };

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        controller.error(error);
      };

      const handleData = (chunk: Buffer | string) => {
        if (settled) {
          return;
        }

        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

        controller.enqueue(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
      };

      const handleError = (error: Error) => {
        fail(error);
      };

      cleanup = () => {
        fileStream.off("data", handleData);
        fileStream.off("end", finish);
        fileStream.off("close", finish);
        fileStream.off("error", handleError);
      };

      fileStream.on("data", handleData);
      fileStream.once("end", finish);
      fileStream.once("close", finish);
      fileStream.once("error", handleError);
    },
    cancel() {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fileStream.destroy();
    },
  });
}

async function serveStoredFile(
  request: Request,
  context: StorageRouteContext,
  method: "GET" | "HEAD",
) {
  const { storagePath } = await context.params;
  const relativePath = storagePath.join("/");

  try {
    const filePath = resolveStoredUploadPath(relativePath);
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      return new Response("Not found", { status: 404 });
    }

    const fileSize = fileStats.size;
    const rangeHeader = request.headers.get("range");
    const baseHeaders = buildBaseHeaders(filePath, fileSize);

    if (rangeHeader) {
      const byteRange = parseByteRange(rangeHeader, fileSize);

      if (!byteRange) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: {
            "content-range": `bytes */${fileSize}`,
          },
        });
      }

      const { start, end } = byteRange;
      const chunkSize = end - start + 1;
      baseHeaders.set("content-length", String(chunkSize));
      baseHeaders.set("content-range", `bytes ${start}-${end}/${fileSize}`);

      if (method === "HEAD") {
        return new Response(null, {
          status: 206,
          headers: baseHeaders,
        });
      }

      const stream = createFileResponseStream(filePath, byteRange);

      return new Response(stream, {
        status: 206,
        headers: baseHeaders,
      });
    }

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: baseHeaders,
      });
    }

    const stream = createFileResponseStream(filePath);

    return new Response(stream, {
      status: 200,
      headers: baseHeaders,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function GET(request: Request, context: StorageRouteContext) {
  return serveStoredFile(request, context, "GET");
}

export async function HEAD(request: Request, context: StorageRouteContext) {
  return serveStoredFile(request, context, "HEAD");
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,HEAD,OPTIONS",
      "access-control-allow-headers": "Content-Type,Accept-Encoding,Range",
      "access-control-max-age": "86400",
    },
  });
}
