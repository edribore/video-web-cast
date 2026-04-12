import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogMoviePoster } from "@/components/catalog-movie-poster";
import { CreateRoomButton } from "@/components/create-room-button";
import { DebugPageState } from "@/components/debug-runtime";
import { PublicSiteShell } from "@/components/public-site-shell";
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

  return (
    <PublicSiteShell>
      <DebugPageState
        scope="page/movie"
        data={{
          movie,
          actions: ["Create room", "Back to lobby"],
        }}
      />

      <section className="grid gap-8 xl:grid-cols-[0.74fr_1.26fr]">
        <CatalogMoviePoster
          title={movie.title}
          posterUrl={movie.posterUrl}
          className="aspect-[3/4] min-h-[30rem]"
          priorityTone="amber"
        />

        <div className="rounded-[2.4rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,29,0.98),rgba(10,11,17,0.98))] p-8 shadow-[0_26px_70px_rgba(0,0,0,0.3)]">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#f2c38f]">
            Featured screening
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            {movie.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-3">
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

          <p className="mt-6 max-w-3xl text-base leading-8 text-[#d8d3db]">
            {movie.synopsis}
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <CreateRoomButton
              scope={`room/create-request/movie-${movie.id}`}
              catalogMovieId={movie.id}
              mediaAssetId={movie.mediaAssetId}
              movieTitle={movie.title}
              label="Create room"
            />
            <Link
              href={homeHref()}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
            >
              Back to lobby
            </Link>
          </div>

          <dl className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Alternate audio
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.audioTrackCount} track{movie.audioTrackCount === 1 ? "" : "s"}
              </dd>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Participants can keep their own language choice while the room
                stays on one shared timeline.
              </p>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Subtitle support
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                {movie.subtitleTrackCount} track
                {movie.subtitleTrackCount === 1 ? "" : "s"}
              </dd>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Subtitle selection stays per guest in the browser and is
                mirrored into Chromecast when available.
              </p>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Room format
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                Shared watch room
              </dd>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Play, pause, seek, and stop stay room-authoritative for everyone
                in the screening.
              </p>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Playback destinations
              </dt>
              <dd className="mt-2 text-base font-semibold text-white">
                Local or cast
              </dd>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                SyncPass keeps exactly one active playback destination at a
                time, so the browser never competes with the TV.
              </p>
            </div>
          </dl>
        </div>
      </section>
    </PublicSiteShell>
  );
}
