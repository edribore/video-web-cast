import Link from "next/link";
import { DebugPageState } from "@/components/debug-runtime";
import { CatalogMoviePoster } from "@/components/catalog-movie-poster";
import { HomeRoomActions } from "@/components/home-room-actions";
import { PageShell } from "@/components/page-shell";
import { createRoomForCatalogMovieAction } from "@/app/movies/actions";
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
  const createRoomAction = createRoomForCatalogMovieAction.bind(null, movie.id);

  return (
    <article className="group rounded-[2rem] border border-white/10 bg-[#151117]/90 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.22)] transition hover:-translate-y-1 hover:border-[#8fa7c7]/60">
      <Link href={movieHref(movie.slug)} className="block">
        <CatalogMoviePoster
          title={movie.title}
          posterUrl={movie.posterUrl}
          className="aspect-[3/4] min-h-[20rem]"
          priorityTone={index % 4 === 0 ? "amber" : index % 4 === 1 ? "blue" : index % 4 === 2 ? "crimson" : "teal"}
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
          <form action={createRoomAction}>
            <button
              type="submit"
              className="rounded-full bg-[#d07a3e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b76630]"
            >
              Create room
            </button>
          </form>
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
    <article className="rounded-[2rem] border border-dashed border-white/10 bg-[#120f14]/70 p-4">
      <CatalogMoviePoster
        title={`Slot ${index + 1}`}
        posterUrl={null}
        className="aspect-[3/4] min-h-[20rem]"
        priorityTone={index % 4 === 0 ? "amber" : index % 4 === 1 ? "blue" : index % 4 === 2 ? "crimson" : "teal"}
      />
      <div className="mt-5">
        <p className="rounded-full bg-[#1c171d] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#9e9aa2]">
          Coming soon
        </p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          Curator slot open
        </h2>
        <p className="mt-3 text-sm leading-7 text-[#9e9aa2]">
          An admin can connect another uploaded media asset to this slot to keep
          the SyncPass lobby filled with 10 marquee-ready titles.
        </p>
      </div>
    </article>
  );
}

export default async function HomePage() {
  const featuredMovies = await listFeaturedCatalogMovies();
  const displaySlots = buildDisplaySlots(featuredMovies);

  return (
    <PageShell
      eyebrow="Cinema lobby"
      title="SyncPass"
      description="Curated movie nights, synchronized rooms, and a companion-screen experience that stays in sync whether playback lives in the browser or on the TV."
    >
      <DebugPageState
        scope="page/home"
        data={{
          title: "SyncPass",
          featuredMovieCount: featuredMovies.length,
          displaySlotCount: displaySlots.length,
          primaryActions: ["Browse featured movies", "Create room", "Join room"],
        }}
      />

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(135deg,#160f17_0%,#261924_52%,#5b2f1f_100%)] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.3)]">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.38em] text-[#d7c19d]">
              Now showing
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Bring the whole room into the same scene.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[#e2d7da] sm:text-lg">
              SyncPass turns a shared watch session into a real screening flow:
              pick a featured film, launch a room, keep audio and subtitle
              preferences per participant, and move playback to Chromecast
              without losing synchronized control.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Featured board
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">10</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                marquee slots keep the home page curated instead of turning into
                a raw upload utility.
              </p>
            </div>
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Playback
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">2 modes</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                watch locally in-browser or move playback to the TV while the
                browser stays a synchronized companion screen.
              </p>
            </div>
            <div className="rounded-[1.8rem] border border-white/10 bg-black/20 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Language control
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">Per guest</p>
              <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                alternate audio and subtitle selections stay participant-local
                while the shared room timeline remains authoritative.
              </p>
            </div>
          </div>
        </div>

        <HomeRoomActions />
      </section>

      <section className="space-y-6">
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
              <PlaceholderMovieCard key={`placeholder-${slot.index}`} index={slot.index} />
            ),
          )}
        </div>
      </section>
    </PageShell>
  );
}
