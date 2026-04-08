/*
  Warnings:

  - The values [subtitle_change] on the enum `RoomEventType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `selectedSubtitleTrackId` on the `RoomEvent` table. All the data in the column will be lost.
  - You are about to drop the column `selectedSubtitleTrackId` on the `RoomPlaybackState` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[mediaAssetId,sourcePath]` on the table `SubtitleTrack` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AudioTrackFormat" AS ENUM ('mp3', 'aac', 'm4a', 'wav', 'ogg', 'webm', 'other');

-- AlterEnum
BEGIN;
CREATE TYPE "RoomEventType_new" AS ENUM ('join', 'play', 'pause', 'stop', 'seek');
ALTER TABLE "RoomEvent" ALTER COLUMN "type" TYPE "RoomEventType_new" USING ("type"::text::"RoomEventType_new");
ALTER TYPE "RoomEventType" RENAME TO "RoomEventType_old";
ALTER TYPE "RoomEventType_new" RENAME TO "RoomEventType";
DROP TYPE "public"."RoomEventType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "RoomPlaybackState" DROP CONSTRAINT "RoomPlaybackState_selectedSubtitleTrackId_fkey";

-- DropIndex
DROP INDEX "RoomPlaybackState_selectedSubtitleTrackId_idx";

-- DropIndex
DROP INDEX "SubtitleTrack_mediaAssetId_language_idx";

-- DropIndex
DROP INDEX "SubtitleTrack_mediaAssetId_normalizedPath_key";

-- AlterTable
ALTER TABLE "RoomEvent" DROP COLUMN "selectedSubtitleTrackId";

-- AlterTable
ALTER TABLE "RoomPlaybackState" DROP COLUMN "selectedSubtitleTrackId";

-- AlterTable
ALTER TABLE "SubtitleTrack" ADD COLUMN     "isRenderable" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "normalizedPath" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalFormat" "AudioTrackFormat" NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "normalizedPath" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudioTrack_mediaAssetId_language_idx" ON "AudioTrack"("mediaAssetId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTrack_mediaAssetId_sourcePath_key" ON "AudioTrack"("mediaAssetId", "sourcePath");

-- CreateIndex
CREATE INDEX "SubtitleTrack_mediaAssetId_language_isRenderable_idx" ON "SubtitleTrack"("mediaAssetId", "language", "isRenderable");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleTrack_mediaAssetId_sourcePath_key" ON "SubtitleTrack"("mediaAssetId", "sourcePath");

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
