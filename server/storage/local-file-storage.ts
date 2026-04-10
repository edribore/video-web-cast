import "server-only";

import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createStorageFilename } from "@/lib/file-names";
import type { FileStorage, SaveFileInput, StoredFile } from "@/server/storage/storage-service";

const uploadRootDirectory = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "storage",
  "dev",
  "uploads",
);

function toSystemPath(relativePath: string) {
  return relativePath.split("/").join(path.sep);
}

export function resolveStoredUploadPath(relativePath: string) {
  const absolutePath = path.resolve(uploadRootDirectory, toSystemPath(relativePath));
  const normalizedRoot = path.resolve(uploadRootDirectory);

  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new Error("Resolved upload path escaped the configured upload root.");
  }

  return absolutePath;
}

class LocalFileStorage implements FileStorage {
  async saveFile(input: SaveFileInput): Promise<StoredFile> {
    const filename = createStorageFilename(input.originalFilename);
    const relativePath = path.posix.join(input.directory, filename);
    const absolutePath = resolveStoredUploadPath(relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(input.bytes));

    return {
      relativePath,
      absolutePath,
      contentType: input.contentType,
      byteLength: input.bytes.byteLength,
      originalFilename: input.originalFilename,
    };
  }

  async removeDirectory(relativeDirectory: string) {
    if (!relativeDirectory) {
      return;
    }

    const absolutePath = resolveStoredUploadPath(relativeDirectory);
    await rm(absolutePath, { recursive: true, force: true });
  }
}

let localFileStorage: FileStorage | undefined;

export function getLocalFileStorage() {
  localFileStorage ??= new LocalFileStorage();
  return localFileStorage;
}
