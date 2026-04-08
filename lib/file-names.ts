import path from "node:path";
import { createSafeIdSegment } from "@/lib/create-safe-id";

function toWords(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getFileExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function getFilenameStem(filename: string) {
  return path.basename(filename, getFileExtension(filename));
}

export function humanizeFilenameStem(filename: string) {
  const stem = toWords(getFilenameStem(filename));
  return stem ? toTitleCase(stem) : "Untitled Media";
}

export function buildMediaTitle(inputTitle: string, originalFilename: string) {
  const title = toWords(inputTitle);
  return title ? title : humanizeFilenameStem(originalFilename);
}

export function sanitizeFilenameStem(filename: string) {
  const sanitized = getFilenameStem(filename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "file";
}

export function createStorageFilename(originalFilename: string) {
  const extension = getFileExtension(originalFilename);
  const safeStem = sanitizeFilenameStem(originalFilename);
  const uniqueSuffix = createSafeIdSegment(8);

  return `${safeStem}-${uniqueSuffix}${extension}`;
}

export function replaceFileExtension(
  filename: string,
  nextExtension: string,
) {
  return `${getFilenameStem(filename)}${nextExtension}`;
}
