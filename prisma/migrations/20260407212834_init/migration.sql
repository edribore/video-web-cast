-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('video');

-- CreateEnum
CREATE TYPE "MediaAssetSourceType" AS ENUM ('upload', 'external_url');

-- CreateEnum
CREATE TYPE "SubtitleFormat" AS ENUM ('srt', 'vtt', 'ass', 'ssa', 'ttml', 'other');

-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('stopped', 'playing', 'paused');

-- CreateEnum
CREATE TYPE "RoomEventType" AS ENUM ('join', 'play', 'pause', 'stop', 'seek', 'subtitle_change');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "assetType" "MediaAssetType" NOT NULL DEFAULT 'video',
    "sourceType" "MediaAssetSourceType" NOT NULL DEFAULT 'upload',
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "storagePath" TEXT NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleTrack" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalFormat" "SubtitleFormat" NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "normalizedPath" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtitleTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomPlaybackState" (
    "roomId" TEXT NOT NULL,
    "status" "PlaybackStatus" NOT NULL DEFAULT 'stopped',
    "currentTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "playbackRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "selectedSubtitleTrackId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomPlaybackState_pkey" PRIMARY KEY ("roomId")
);

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" "RoomEventType" NOT NULL,
    "actorSessionId" TEXT,
    "currentTime" DOUBLE PRECISION,
    "playbackRate" DOUBLE PRECISION,
    "selectedSubtitleTrackId" TEXT,
    "playbackVersion" INTEGER,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE INDEX "SubtitleTrack_mediaAssetId_language_idx" ON "SubtitleTrack"("mediaAssetId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleTrack_mediaAssetId_normalizedPath_key" ON "SubtitleTrack"("mediaAssetId", "normalizedPath");

-- CreateIndex
CREATE UNIQUE INDEX "Room_publicId_key" ON "Room"("publicId");

-- CreateIndex
CREATE INDEX "Room_mediaAssetId_createdAt_idx" ON "Room"("mediaAssetId", "createdAt");

-- CreateIndex
CREATE INDEX "RoomPlaybackState_selectedSubtitleTrackId_idx" ON "RoomPlaybackState"("selectedSubtitleTrackId");

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_createdAt_idx" ON "RoomEvent"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_type_createdAt_idx" ON "RoomEvent"("roomId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "SubtitleTrack" ADD CONSTRAINT "SubtitleTrack_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomPlaybackState" ADD CONSTRAINT "RoomPlaybackState_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomPlaybackState" ADD CONSTRAINT "RoomPlaybackState_selectedSubtitleTrackId_fkey" FOREIGN KEY ("selectedSubtitleTrackId") REFERENCES "SubtitleTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
