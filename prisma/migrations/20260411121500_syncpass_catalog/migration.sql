-- CreateTable
CREATE TABLE "CatalogMovie" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "posterPath" TEXT,
    "releaseLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mediaAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogMovie_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "catalogMovieId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CatalogMovie_slug_key" ON "CatalogMovie"("slug");

-- CreateIndex
CREATE INDEX "CatalogMovie_isActive_sortOrder_idx" ON "CatalogMovie"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CatalogMovie_mediaAssetId_idx" ON "CatalogMovie"("mediaAssetId");

-- CreateIndex
CREATE INDEX "Room_catalogMovieId_createdAt_idx" ON "Room"("catalogMovieId", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogMovie" ADD CONSTRAINT "CatalogMovie_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_catalogMovieId_fkey" FOREIGN KEY ("catalogMovieId") REFERENCES "CatalogMovie"("id") ON DELETE SET NULL ON UPDATE CASCADE;
