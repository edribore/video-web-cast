-- AlterTable
ALTER TABLE "RoomPlaybackState"
ADD COLUMN "anchorMediaTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "anchorWallClockMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "scheduledStartWallClockMs" DOUBLE PRECISION,
ADD COLUMN "sourceClientEventId" TEXT;

-- Backfill existing playback rows so current rooms keep the previous semantics.
UPDATE "RoomPlaybackState"
SET
  "anchorMediaTime" = "currentTime",
  "anchorWallClockMs" = EXTRACT(EPOCH FROM "updatedAt") * 1000,
  "scheduledStartWallClockMs" = CASE
    WHEN "status" = 'playing' THEN EXTRACT(EPOCH FROM "updatedAt") * 1000
    ELSE NULL
  END,
  "sourceClientEventId" = NULL;
