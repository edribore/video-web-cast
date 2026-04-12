import "server-only";

import { getFileExtension } from "@/lib/file-names";
import { storedUploadHref } from "@/lib/routes";
import { getPrismaClient } from "@/server/prisma";
import { getLocalFileStorage } from "@/server/storage/local-file-storage";
import type {
  AdminCatalogDashboard,
  CatalogMovieDetail,
  CatalogMovieSummary,
} from "@/types/catalog";

const maximumActiveCatalogMovies = 10;
const acceptedPosterExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const acceptedPosterMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type CatalogMovieWithMediaRecord = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  posterPath: string | null;
  releaseLabel: string | null;
  isActive: boolean;
  sortOrder: number;
  mediaAssetId: string | null;
  mediaAsset: {
    id: string;
    title: string;
    originalFilename: string;
    audioTracks: Array<{ language: string }>;
    subtitleTracks: Array<{ language: string; isRenderable: boolean }>;
    _count: {
      audioTracks: number;
      subtitleTracks: number;
    };
  } | null;
};

function normalizeOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function resolveRequestedSlug(title: string, slugInput: string) {
  const resolvedSlug = normalizeSlug(slugInput || title);
  return resolvedSlug || "movie";
}

function resolveSortOrder(sortOrderInput: string) {
  if (!sortOrderInput) {
    return 0;
  }

  const parsed = Number(sortOrderInput);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function isFilledFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0 && value.name.trim().length > 0;
}

function validatePosterFile(file: File) {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();

  if (
    !acceptedPosterExtensions.has(extension) ||
    (mimeType && !acceptedPosterMimeTypes.has(mimeType))
  ) {
    throw new Error(
      "Poster uploads must be JPG, PNG, or WebP files.",
    );
  }
}

function buildLanguageAvailabilityLabel(
  mediaAsset: CatalogMovieWithMediaRecord["mediaAsset"],
) {
  if (!mediaAsset) {
    return null;
  }

  const audioLanguages = Array.from(
    new Set(
      mediaAsset.audioTracks
        .map((track) => track.language.toUpperCase())
        .filter((language) => language !== "UND"),
    ),
  );
  const subtitleLanguages = Array.from(
    new Set(
      mediaAsset.subtitleTracks
        .filter((track) => track.isRenderable)
        .map((track) => track.language.toUpperCase())
        .filter((language) => language !== "UND"),
    ),
  );
  const segments: string[] = [];

  if (audioLanguages.length > 0) {
    segments.push(`Audio ${audioLanguages.join(", ")}`);
  }

  if (subtitleLanguages.length > 0) {
    segments.push(`Subs ${subtitleLanguages.join(", ")}`);
  }

  return segments.length > 0 ? segments.join(" / ") : null;
}

function serializeCatalogMovie(record: CatalogMovieWithMediaRecord): CatalogMovieSummary {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    synopsis: record.synopsis,
    posterUrl: record.posterPath ? storedUploadHref(record.posterPath) : null,
    releaseLabel: record.releaseLabel,
    isActive: record.isActive,
    sortOrder: record.sortOrder,
    mediaAssetId: record.mediaAssetId,
    mediaAssetTitle: record.mediaAsset?.title ?? null,
    audioTrackCount: record.mediaAsset?._count.audioTracks ?? 0,
    subtitleTrackCount: record.mediaAsset?._count.subtitleTracks ?? 0,
    languageAvailabilityLabel: buildLanguageAvailabilityLabel(record.mediaAsset),
  };
}

async function getCatalogMovieWithMedia(movieId: string) {
  const prisma = getPrismaClient();

  return prisma.catalogMovie.findUnique({
    where: {
      id: movieId,
    },
    include: {
      mediaAsset: {
        select: {
          id: true,
          title: true,
          originalFilename: true,
          audioTracks: {
            select: {
              language: true,
            },
          },
          subtitleTracks: {
            select: {
              language: true,
              isRenderable: true,
            },
          },
          _count: {
            select: {
              audioTracks: true,
              subtitleTracks: true,
            },
          },
        },
      },
    },
  });
}

async function ensureMediaAssetExists(mediaAssetId: string | null) {
  if (!mediaAssetId) {
    return null;
  }

  const prisma = getPrismaClient();
  const mediaAsset = await prisma.mediaAsset.findUnique({
    where: {
      id: mediaAssetId,
    },
    select: {
      id: true,
    },
  });

  if (!mediaAsset) {
    throw new Error("The selected media asset no longer exists.");
  }

  return mediaAsset.id;
}

async function ensureActiveCatalogCapacity(excludeMovieId?: string) {
  const prisma = getPrismaClient();
  const activeCount = await prisma.catalogMovie.count({
    where: {
      isActive: true,
      ...(excludeMovieId
        ? {
            id: {
              not: excludeMovieId,
            },
          }
        : {}),
    },
  });

  if (activeCount >= maximumActiveCatalogMovies) {
    throw new Error(
      "SyncPass supports at most 10 active featured movies at a time. Deactivate or delete another featured movie first.",
    );
  }
}

async function ensureUniqueCatalogSlug(slug: string, excludeMovieId?: string) {
  const prisma = getPrismaClient();
  const existingMovie = await prisma.catalogMovie.findFirst({
    where: {
      slug,
      ...(excludeMovieId
        ? {
            id: {
              not: excludeMovieId,
            },
          }
        : {}),
    },
    select: {
      id: true,
    },
  });

  if (existingMovie) {
    throw new Error("That movie slug is already in use.");
  }
}

async function persistPosterFile(movieId: string, posterFile: File) {
  validatePosterFile(posterFile);
  const storage = getLocalFileStorage();
  const posterDirectory = `catalog-movies/${movieId}/poster`;
  const posterBytes = new Uint8Array(await posterFile.arrayBuffer());

  await storage.removeDirectory(posterDirectory);

  const storedPoster = await storage.saveFile({
    directory: posterDirectory,
    originalFilename: posterFile.name,
    bytes: posterBytes,
    contentType: posterFile.type || "application/octet-stream",
  });

  return storedPoster.relativePath;
}

type CatalogMovieFormValues = {
  title: string;
  synopsis: string;
  slug: string;
  releaseLabel: string | null;
  sortOrder: number;
  isActive: boolean;
  mediaAssetId: string | null;
  clearPoster: boolean;
  posterFile: File | null;
};

function parseCatalogMovieFormData(formData: FormData): CatalogMovieFormValues {
  const title = normalizeOptionalString(formData.get("title"));
  const synopsis = normalizeOptionalString(formData.get("synopsis"));
  const slugInput = normalizeOptionalString(formData.get("slug"));
  const releaseLabelInput = normalizeOptionalString(formData.get("releaseLabel"));
  const mediaAssetIdInput = normalizeOptionalString(formData.get("mediaAssetId"));
  const sortOrderInput = normalizeOptionalString(formData.get("sortOrder"));
  const posterEntry = formData.get("posterFile");

  if (!title) {
    throw new Error("A featured movie title is required.");
  }

  if (!synopsis) {
    throw new Error("A movie synopsis is required.");
  }

  return {
    title,
    synopsis,
    slug: resolveRequestedSlug(title, slugInput),
    releaseLabel: releaseLabelInput || null,
    sortOrder: resolveSortOrder(sortOrderInput),
    isActive: formData.get("isActive") === "on",
    mediaAssetId: mediaAssetIdInput || null,
    clearPoster: formData.get("clearPoster") === "on",
    posterFile: isFilledFile(posterEntry) ? posterEntry : null,
  };
}

async function finalizeCatalogMovieSummary(movieId: string) {
  const movie = await getCatalogMovieWithMedia(movieId);

  if (!movie) {
    throw new Error("The featured movie could not be loaded after saving.");
  }

  return serializeCatalogMovie(movie);
}

export async function listFeaturedCatalogMovies(limit = maximumActiveCatalogMovies) {
  const prisma = getPrismaClient();
  const movies = await prisma.catalogMovie.findMany({
    where: {
      isActive: true,
      mediaAssetId: {
        not: null,
      },
    },
    take: limit,
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    include: {
      mediaAsset: {
        select: {
          id: true,
          title: true,
          originalFilename: true,
          audioTracks: {
            select: {
              language: true,
            },
          },
          subtitleTracks: {
            select: {
              language: true,
              isRenderable: true,
            },
          },
          _count: {
            select: {
              audioTracks: true,
              subtitleTracks: true,
            },
          },
        },
      },
    },
  });

  return movies.map((movie) => serializeCatalogMovie(movie));
}

export async function getPublicCatalogMovieBySlug(slug: string) {
  const prisma = getPrismaClient();
  const movie = await prisma.catalogMovie.findFirst({
    where: {
      slug,
      isActive: true,
      mediaAssetId: {
        not: null,
      },
    },
    include: {
      mediaAsset: {
        select: {
          id: true,
          title: true,
          originalFilename: true,
          audioTracks: {
            select: {
              language: true,
            },
          },
          subtitleTracks: {
            select: {
              language: true,
              isRenderable: true,
            },
          },
          _count: {
            select: {
              audioTracks: true,
              subtitleTracks: true,
            },
          },
        },
      },
    },
  });

  if (!movie) {
    return null;
  }

  const summary = serializeCatalogMovie(movie);

  const detail: CatalogMovieDetail = {
    ...summary,
    originalFilename: movie.mediaAsset?.originalFilename ?? null,
  };

  return detail;
}

export async function listCatalogMoviesForAdmin(): Promise<AdminCatalogDashboard> {
  const prisma = getPrismaClient();
  const [movies, mediaAssets, activeMovieCount] = await Promise.all([
    prisma.catalogMovie.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: {
        mediaAsset: {
          select: {
            id: true,
            title: true,
            originalFilename: true,
            audioTracks: {
              select: {
                language: true,
              },
            },
            subtitleTracks: {
              select: {
                language: true,
                isRenderable: true,
              },
            },
            _count: {
              select: {
                audioTracks: true,
                subtitleTracks: true,
              },
            },
          },
        },
      },
    }),
    prisma.mediaAsset.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 60,
      select: {
        id: true,
        title: true,
        originalFilename: true,
        createdAt: true,
        _count: {
          select: {
            audioTracks: true,
            subtitleTracks: true,
          },
        },
      },
    }),
    prisma.catalogMovie.count({
      where: {
        isActive: true,
      },
    }),
  ]);

  return {
    movies: movies.map((movie) => serializeCatalogMovie(movie)),
    mediaAssets: mediaAssets.map((mediaAsset) => ({
      id: mediaAsset.id,
      title: mediaAsset.title,
      originalFilename: mediaAsset.originalFilename,
      createdAt: mediaAsset.createdAt.toISOString(),
      audioTrackCount: mediaAsset._count.audioTracks,
      subtitleTrackCount: mediaAsset._count.subtitleTracks,
    })),
    activeMovieCount,
  };
}

export async function createCatalogMovieFromFormData(formData: FormData) {
  const prisma = getPrismaClient();
  const storage = getLocalFileStorage();
  const values = parseCatalogMovieFormData(formData);
  const mediaAssetId = await ensureMediaAssetExists(values.mediaAssetId);

  if (values.isActive) {
    await ensureActiveCatalogCapacity();
  }

  if (values.isActive && !mediaAssetId) {
    throw new Error("Active featured movies must be linked to a media asset.");
  }

  await ensureUniqueCatalogSlug(values.slug);

  let createdMovie: { id: string } | null = null;

  try {
    createdMovie = await prisma.catalogMovie.create({
      data: {
        title: values.title,
        synopsis: values.synopsis,
        slug: values.slug,
        releaseLabel: values.releaseLabel,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
        mediaAssetId,
      },
    });

    if (values.posterFile) {
      const posterPath = await persistPosterFile(createdMovie.id, values.posterFile);

      await prisma.catalogMovie.update({
        where: {
          id: createdMovie.id,
        },
        data: {
          posterPath,
        },
      });
    }

    return finalizeCatalogMovieSummary(createdMovie.id);
  } catch (error) {
    if (createdMovie) {
      await Promise.allSettled([
        prisma.catalogMovie.delete({
          where: {
            id: createdMovie.id,
          },
        }),
        storage.removeDirectory(`catalog-movies/${createdMovie.id}`),
      ]);
    }

    throw error;
  }
}

export async function updateCatalogMovieFromFormData(formData: FormData) {
  const prisma = getPrismaClient();
  const values = parseCatalogMovieFormData(formData);
  const movieId = normalizeOptionalString(formData.get("movieId"));

  if (!movieId) {
    throw new Error("The featured movie ID is required for updates.");
  }

  const existingMovie = await prisma.catalogMovie.findUnique({
    where: {
      id: movieId,
    },
    select: {
      id: true,
      slug: true,
      posterPath: true,
    },
  });

  if (!existingMovie) {
    throw new Error("The featured movie could not be found.");
  }

  const mediaAssetId = await ensureMediaAssetExists(values.mediaAssetId);

  if (values.isActive) {
    await ensureActiveCatalogCapacity(existingMovie.id);
  }

  if (values.isActive && !mediaAssetId) {
    throw new Error("Active featured movies must be linked to a media asset.");
  }

  await ensureUniqueCatalogSlug(values.slug, existingMovie.id);

  let posterPath = existingMovie.posterPath;

  if (values.clearPoster) {
    posterPath = null;
    await getLocalFileStorage().removeDirectory(`catalog-movies/${existingMovie.id}/poster`);
  }

  if (values.posterFile) {
    posterPath = await persistPosterFile(existingMovie.id, values.posterFile);
  }

  await prisma.catalogMovie.update({
    where: {
      id: existingMovie.id,
    },
    data: {
      title: values.title,
      synopsis: values.synopsis,
      slug: values.slug,
      releaseLabel: values.releaseLabel,
      sortOrder: values.sortOrder,
      isActive: values.isActive,
      mediaAssetId,
      posterPath,
    },
  });

  return {
    movie: await finalizeCatalogMovieSummary(existingMovie.id),
    previousSlug: existingMovie.slug,
  };
}

export async function deleteCatalogMovieById(movieId: string) {
  const prisma = getPrismaClient();
  const storage = getLocalFileStorage();
  const existingMovie = await prisma.catalogMovie.findUnique({
    where: {
      id: movieId,
    },
    select: {
      id: true,
      slug: true,
    },
  });

  if (!existingMovie) {
    throw new Error("The featured movie could not be found.");
  }

  await prisma.catalogMovie.delete({
    where: {
      id: existingMovie.id,
    },
  });
  await storage.removeDirectory(`catalog-movies/${existingMovie.id}`);

  return existingMovie.slug;
}
