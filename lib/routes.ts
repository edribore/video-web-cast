import { toAbsoluteUrl } from "@/lib/public-origin";
import { normalizeRoomId } from "@/lib/room-id";

export function homeHref() {
  return "/";
}

export function adminHref() {
  return "/admin";
}

export function adminCatalogHref() {
  return "/admin/catalog";
}

export function adminMediaHref() {
  return "/admin/media";
}

export function adminMediaDetailHref(mediaId: string) {
  return `/admin/media/${encodeURIComponent(mediaId)}`;
}

export function adminUploadHref() {
  return "/admin/upload";
}

export function movieHref(slug: string) {
  return `/movies/${encodeURIComponent(slug)}`;
}

export function uploadHref() {
  return adminUploadHref();
}

export function mediaHref(mediaId: string) {
  return adminMediaDetailHref(mediaId);
}

export function storedUploadHref(storagePath: string) {
  const encodedSegments = storagePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));

  return `/api/storage/${encodedSegments.join("/")}`;
}

export function storedUploadAbsoluteHref(
  storagePath: string,
  baseUrl: string | null,
) {
  return toAbsoluteUrl(storedUploadHref(storagePath), baseUrl);
}

export function roomHref(roomId: string) {
  return `/room/${encodeURIComponent(normalizeRoomId(roomId))}`;
}

export function roomAbsoluteHref(roomId: string, baseUrl: string | null) {
  return toAbsoluteUrl(roomHref(roomId), baseUrl);
}
