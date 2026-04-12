import Link from "next/link";
import { notFound } from "next/navigation";
import { DebugPageState } from "@/components/debug-runtime";
import { CatalogMoviePoster } from "@/components/catalog-movie-poster";
import { PageShell } from "@/components/page-shell";
import { createRoomForCatalogMovieAction } from "@/app/movies/actions";
import { homeHref } from "@/lib/routes";
import { getPublicCatalogMovieBySlug } from "@/server/catalog-service";

export const dynamic = "force-dynamic";

type MoviePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function MoviePage({ params }: MoviePageProps) {
  const { slug } = await params;
  const movie = await getPublicCatalogMovieBySlug(slug);

  if (!movie || !movie.mediaAssetId) {
    notFound();
  }

  const createRoomAction = createRoomForCatalogMovieAction.bind(null, movie.id);

  return (
    <PageShell
      eyebrow="Featured movie"
      title={movie.title}
      description="Create a watch room from this curated SyncPass title and launch directly into the synchronized local-or-cast playback experience."
    >
      <DebugPageState
        scope="page/movie"
        data={{
          movie,
          actions: ["Create room", "Back to lobby"],
        }}
      />

      <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <CatalogMoviePoster
          title={movie.title}
          posterUrl={movie.posterUrl}
          className="aspect-[3/4] min-h-[28rem]"
        />

        <div className="rounded-[2rem] border border-white/10 bg-[#151117]/90 p-8 shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
          <div className="flex flex-wrap items-center gap-3">
            {movie.releaseLabel ? (
              <span className="rounded-full bg-[#1d2a3a] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#cde0ff]">
                {movie.releaseLabel}
              </span>
            ) : null}
            {movie.languageAvailabilityLabel ? (
              <span className="rounded-full bg-[#241d26] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#d9c8e9]">
                {movie.languageAvailabilityLabel}
              </span>
            ) : null}
          </div>

          <p className="mt-6 text-base leading-8 text-[#d8d3db]">
            {movie.synopsis}
          </p>

          <dl className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Linked media asset
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.mediaAssetTitle}
              </dd>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Original file
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.originalFilename}
              </dd>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Alternate audio
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.audioTrackCount} track{movie.audioTrackCount === 1 ? "" : "s"}
              </dd>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Subtitles
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.subtitleTrackCount} track
                {movie.subtitleTrackCount === 1 ? "" : "s"}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <form action={createRoomAction}>
              <button
                type="submit"
                className="rounded-full bg-[#d07a3e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b76630]"
              >
                Create room
              </button>
            </form>
            <Link
              href={homeHref()}
              className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
            >
              Back to lobby
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
