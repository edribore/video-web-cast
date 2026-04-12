import Link from "next/link";
import { CatalogMoviePoster } from "@/components/catalog-movie-poster";
import { CreateRoomButton } from "@/components/create-room-button";
import { DebugPageState } from "@/components/debug-runtime";
import { HomeRoomActions } from "@/components/home-room-actions";
import { PublicSiteShell } from "@/components/public-site-shell";
import { movieHref } from "@/lib/routes";
import { listFeaturedCatalogMovies } from "@/server/catalog-service";

export const dynamic = "force-dynamic";

type DisplaySlot =
  | {
      kind: "movie";
      index: number;
      movie: Awaited<ReturnType<typeof listFeaturedCatalogMovies>>[number];
    }
  | {
      kind: "placeholder";
      index: number;
    };

function buildDisplaySlots(
  movies: Awaited<ReturnType<typeof listFeaturedCatalogMovies>>,
): DisplaySlot[] {
  const slots: DisplaySlot[] = movies.map((movie, index) => ({
    kind: "movie",
    index,
    movie,
  }));

  for (let index = movies.length; index < 10; index += 1) {
    slots.push({
      kind: "placeholder",
      index,
    });
  }

  return slots;
}

function FeaturedMovieCard({
  movie,
  index,
}: {
  movie: Awaited<ReturnType<typeof listFeaturedCatalogMovies>>[number];
  index: number;
}) {
  return (
    <article className="group rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(19,20,28,0.98),rgba(11,12,18,0.98))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-[#8fa7c7]/60">
      <Link href={movieHref(movie.slug)} className="block">
        <CatalogMoviePoster
          title={movie.title}
          posterUrl={movie.posterUrl}
          className="aspect-[3/4] min-h-[20rem]"
          priorityTone={
            index % 4 === 0
              ? "amber"
              : index % 4 === 1
                ? "blue"
                : index % 4 === 2
                  ? "crimson"
                  : "teal"
          }
        />
      </Link>

      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          {movie.releaseLabel ? (
            <span className="rounded-full bg-[#1d2a3a] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#cde0ff]">
              {movie.releaseLabel}
            </span>
          ) : null}
          {movie.languageAvailabilityLabel ? (
            <span className="rounded-full bg-[#241d26] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#d9c8e9]">
              {movie.languageAvailabilityLabel}
            </span>
          ) : null}
        </div>

        <Link href={movieHref(movie.slug)} className="block">
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white transition group-hover:text-[#f4dfc0]">
            {movie.title}
          </h2>
        </Link>
        <p className="mt-3 text-sm leading-7 text-[#c7c2ca]">
          {movie.synopsis}
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <CreateRoomButton
            scope={`room/create-request/home-${movie.id}`}
            catalogMovieId={movie.id}
            mediaAssetId={movie.mediaAssetId}
            movieTitle={movie.title}
            label="Create room"
          />
          <Link
            href={movieHref(movie.slug)}
            className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
          >
            View movie
          </Link>
        </div>
      </div>
    </article>
  );
}

function PlaceholderMovieCard({ index }: { index: number }) {
  return (
    <article className="rounded-[2rem] border border-dashed border-white/10 bg-[#0f1117]/82 p-4">
      <CatalogMoviePoster
        title={`Slot ${index + 1}`}
        posterUrl={null}
        className="aspect-[3/4] min-h-[20rem]"
        priorityTone={
          index % 4 === 0
            ? "amber"
            : index % 4 === 1
              ? "blue"
              : index % 4 === 2
                ? "crimson"
                : "teal"
        }
      />
      <div className="mt-5">
        <p className="rounded-full bg-[#1c171d] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#9e9aa2]">
          Coming soon
        </p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          Curator slot open
        </h2>
        <p className="mt-3 text-sm leading-7 text-[#9e9aa2]">
          Another featured title can be connected here by the SyncPass staff
          workflow without exposing raw upload management on the public home.
        </p>
      </div>
    </article>
  );
}

export default async function HomePage() {
  const featuredMovies = await listFeaturedCatalogMovies();
  const displaySlots = buildDisplaySlots(featuredMovies);
  const spotlightMovie = featuredMovies[0] ?? null;

  return (
    <PublicSiteShell>
      <DebugPageState
        scope="page/home"
        data={{
          title: "SyncPass",
          featuredMovieCount: featuredMovies.length,
          displaySlotCount: displaySlots.length,
          primaryActions: ["Browse featured movies", "Create room", "Join room"],
        }}
      />

      <section className="grid gap-8 xl:grid-cols-[1.16fr_0.84fr]">
        <div className="overflow-hidden rounded-[2.8rem] border border-white/10 bg-[linear-gradient(135deg,rgba(29,15,22,0.98)_0%,rgba(12,13,21,0.98)_45%,rgba(71,39,28,0.98)_100%)] p-8 shadow-[0_30px_90px_rgba(0,0,0,0.34)] sm:p-10">
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.42em] text-[#f3c38a]">
              Tonight at SyncPass
            </p>
            <h1 className="mt-5 text-5xl font-semibold tracking-tight text-white sm:text-7xl">
              Movie night staged like opening night.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-[#e2d7da] sm:text-lg">
              Walk into a curated lobby, pick a featured film, launch a room,
              and keep everyone locked to the same scene whether playback stays
              in the browser or moves to the TV.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            {spotlightMovie ? (
              <>
                <CreateRoomButton
                  scope={`room/create-request/hero-${spotlightMovie.id}`}
                  catalogMovieId={spotlightMovie.id}
                  mediaAssetId={spotlightMovie.mediaAssetId}
                  movieTitle={spotlightMovie.title}
                  label={`Create a room for ${spotlightMovie.title}`}
                />
                <Link
                  href={movieHref(spotlightMovie.slug)}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#89b2d8] hover:text-[#ddeeff]"
                >
                  View premiere details
                </Link>
              </>
            ) : null}
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Curated board
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">10 films</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                The public lobby stays editorial and poster-first instead of
                exposing raw media asset management.
              </p>
            </div>
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Shared timeline
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">One cut</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Playback, pause, and seek stay synchronized while each guest can
                keep their own audio and subtitle preferences.
              </p>
            </div>
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Companion screen
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">Cast ready</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                Move the film to Chromecast and keep the browser as the room
                control, call, and chat surface.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6">
          {spotlightMovie ? (
            <section className="group grid gap-5 rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,28,0.98),rgba(9,11,17,0.98))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.26)] sm:grid-cols-[0.82fr_1.18fr]">
              <Link href={movieHref(spotlightMovie.slug)} className="block">
                <CatalogMoviePoster
                  title={spotlightMovie.title}
                  posterUrl={spotlightMovie.posterUrl}
                  className="aspect-[3/4] min-h-[19rem]"
                  priorityTone="amber"
                />
              </Link>
              <div className="flex flex-col">
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#8fa7c7]">
                  Spotlight screening
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  {spotlightMovie.title}
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#c7c2ca]">
                  {spotlightMovie.synopsis}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {spotlightMovie.releaseLabel ? (
                    <span className="rounded-full bg-[#1d2a3a] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[#cde0ff]">
                      {spotlightMovie.releaseLabel}
                    </span>
                  ) : null}
                  {spotlightMovie.languageAvailabilityLabel ? (
                    <span className="rounded-full bg-[#231a26] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[#ddcfeb]">
                      {spotlightMovie.languageAvailabilityLabel}
                    </span>
                  ) : null}
                </div>
                <div className="mt-auto pt-6">
                  <Link
                    href={movieHref(spotlightMovie.slug)}
                    className="inline-flex rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-[#89b2d8] hover:text-[#ddeeff]"
                  >
                    Explore the screening
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          <HomeRoomActions />
        </div>
      </section>

      <section id="featured-premieres" className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#8fa7c7]">
              Featured premieres
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              The SyncPass marquee
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-[#c7c2ca]">
            Public users start here: pick one of the curated movies, create a
            room, and share the room link. Admins manage the lineup separately.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
          {displaySlots.map((slot) =>
            slot.kind === "movie" ? (
              <FeaturedMovieCard
                key={slot.movie.id}
                movie={slot.movie}
                index={slot.index}
              />
            ) : (
              <PlaceholderMovieCard
                key={`placeholder-${slot.index}`}
                index={slot.index}
              />
            ),
          )}
        </div>
      </section>
    </PublicSiteShell>
  );
}
