"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminHref, movieHref } from "@/lib/routes";
import {
  createCatalogMovieFromFormData,
  deleteCatalogMovieById,
  updateCatalogMovieFromFormData,
} from "@/server/catalog-service";

function buildAdminStatusHref(status: "success" | "error", message: string) {
  const searchParams = new URLSearchParams();
  searchParams.set("status", status);
  searchParams.set("message", message);
  return `${adminHref()}?${searchParams.toString()}`;
}

function revalidateCatalogPaths(slugs: string[]) {
  revalidatePath("/");
  revalidatePath(adminHref());

  slugs.forEach((slug) => {
    revalidatePath(movieHref(slug));
  });
}

export async function createCatalogMovieAction(formData: FormData) {
  let movie: Awaited<ReturnType<typeof createCatalogMovieFromFormData>> | null = null;

  try {
    movie = await createCatalogMovieFromFormData(formData);
  } catch (error) {
    redirect(
      buildAdminStatusHref(
        "error",
        error instanceof Error ? error.message : "The featured movie could not be created.",
      ),
    );
  }

  if (!movie) {
    redirect(buildAdminStatusHref("error", "The featured movie could not be created."));
  }

  revalidateCatalogPaths([movie.slug]);
  redirect(
    buildAdminStatusHref(
      "success",
      `Featured movie "${movie.title}" was added to the SyncPass catalog.`,
    ),
  );
}

export async function updateCatalogMovieAction(formData: FormData) {
  let result: Awaited<ReturnType<typeof updateCatalogMovieFromFormData>> | null =
    null;

  try {
    result = await updateCatalogMovieFromFormData(formData);
  } catch (error) {
    redirect(
      buildAdminStatusHref(
        "error",
        error instanceof Error ? error.message : "The featured movie could not be updated.",
      ),
    );
  }

  if (!result) {
    redirect(buildAdminStatusHref("error", "The featured movie could not be updated."));
  }

  revalidateCatalogPaths(
    Array.from(new Set([result.previousSlug, result.movie.slug])),
  );
  redirect(
    buildAdminStatusHref(
      "success",
      `Featured movie "${result.movie.title}" was updated.`,
    ),
  );
}

export async function deleteCatalogMovieAction(formData: FormData) {
  const movieIdEntry = formData.get("movieId");
  const movieId = typeof movieIdEntry === "string" ? movieIdEntry : null;

  if (!movieId) {
    redirect(buildAdminStatusHref("error", "The featured movie ID is required."));
  }

  let slug: Awaited<ReturnType<typeof deleteCatalogMovieById>> | null = null;

  try {
    slug = await deleteCatalogMovieById(movieId);
  } catch (error) {
    redirect(
      buildAdminStatusHref(
        "error",
        error instanceof Error ? error.message : "The featured movie could not be deleted.",
      ),
    );
  }

  if (!slug) {
    redirect(buildAdminStatusHref("error", "The featured movie could not be deleted."));
  }

  revalidateCatalogPaths([slug]);
  redirect(
    buildAdminStatusHref(
      "success",
      "The featured movie was removed from the SyncPass catalog.",
    ),
  );
}
