import Link from "next/link";
import { DebugPageState } from "@/components/debug-runtime";
import { CatalogMoviePoster } from "@/components/catalog-movie-poster";
import { PageShell } from "@/components/page-shell";
import {
  createCatalogMovieAction,
  deleteCatalogMovieAction,
  updateCatalogMovieAction,
} from "@/app/admin/actions";
import { adminHref, mediaHref, movieHref, uploadHref } from "@/lib/routes";
import { listCatalogMoviesForAdmin } from "@/server/catalog-service";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: Promise<{
    status?: string;
    message?: string;
  }>;
};

function StatusBanner({
  status,
  message,
}: {
  status: string | undefined;
  message: string | undefined;
}) {
  if (!status || !message) {
    return null;
  }

  const isError = status === "error";

  return (
    <div
      className={`rounded-[1.8rem] border px-5 py-4 text-sm leading-6 ${
        isError
          ? "border-[#6e2a2e]/30 bg-[#2d1417] text-[#ffd6d5]"
          : "border-[#25486f]/30 bg-[#111d2c] text-[#d9e8ff]"
      }`}
    >
      {message}
    </div>
  );
}

function EmptyMovieSlots({ remainingSlots }: { remainingSlots: number }) {
  if (remainingSlots <= 0) {
    return null;
  }

  return (
    <div className="rounded-[1.8rem] border border-dashed border-white/10 bg-black/20 px-5 py-5 text-sm leading-6 text-[#b8b6ba]">
      {remainingSlots} featured slot{remainingSlots === 1 ? "" : "s"} still open.
      Add more active titles to fill the full 10-movie lobby board.
    </div>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const statusParams = searchParams ? await searchParams : undefined;
  const dashboard = await listCatalogMoviesForAdmin();
  const remainingSlots = Math.max(0, 10 - dashboard.activeMovieCount);

  return (
    <PageShell
      eyebrow="Admin console"
      title="Curate the SyncPass marquee"
      description="Assign the 10 featured lobby titles, connect them to uploaded media assets, and keep the public movie board clean, cinematic, and room-ready."
    >
      <DebugPageState
        scope="page/admin"
        data={{
          activeMovieCount: dashboard.activeMovieCount,
          remainingSlots,
          movieCount: dashboard.movies.length,
          mediaAssetCount: dashboard.mediaAssets.length,
        }}
      />

      <StatusBanner
        status={statusParams?.status}
        message={statusParams?.message}
      />

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/10 bg-[#151117]/85 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
                Featured board
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Build the public lobby lineup
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#c9c4cc]">
                SyncPass only publishes 10 active catalog titles at a time. Each
                public title should link to one media asset that already contains
                its video, alternate audio tracks, and subtitle tracks.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-4 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                  Active now
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {dashboard.activeMovieCount}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-4 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                  Media assets
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {dashboard.mediaAssets.length}
                </p>
              </div>
            </div>
          </div>

          <form
            action={createCatalogMovieAction}
            encType="multipart/form-data"
            className="mt-8 rounded-[1.8rem] border border-white/10 bg-black/20 p-6"
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#8fa7c7]">
                Add featured movie
              </p>
              <p className="text-sm leading-6 text-[#bdb7c0]">
                Use this form to create a public catalog entry. Active entries
                without a linked media asset are blocked.
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-white">
                Title
                <input
                  name="title"
                  type="text"
                  required
                  className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                />
              </label>
              <label className="text-sm font-semibold text-white">
                Slug
                <input
                  name="slug"
                  type="text"
                  placeholder="leave blank to derive from the title"
                  className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                />
              </label>
              <label className="text-sm font-semibold text-white md:col-span-2">
                Synopsis
                <textarea
                  name="synopsis"
                  required
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 py-3 text-sm outline-none transition focus:border-[#8fa7c7]"
                />
              </label>
              <label className="text-sm font-semibold text-white">
                Release label
                <input
                  name="releaseLabel"
                  type="text"
                  placeholder="Friday Premiere"
                  className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                />
              </label>
              <label className="text-sm font-semibold text-white">
                Display order
                <input
                  name="sortOrder"
                  type="number"
                  min={0}
                  defaultValue={dashboard.activeMovieCount}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                />
              </label>
              <label className="text-sm font-semibold text-white">
                Linked media asset
                <select
                  name="mediaAssetId"
                  className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                  defaultValue=""
                >
                  <option value="">No linked media asset yet</option>
                  {dashboard.mediaAssets.map((mediaAsset) => (
                    <option key={mediaAsset.id} value={mediaAsset.id}>
                      {mediaAsset.title} / {mediaAsset.audioTrackCount} audio /{" "}
                      {mediaAsset.subtitleTrackCount} subtitles
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-white">
                Poster
                <input
                  name="posterFile"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="mt-2 block w-full rounded-2xl border border-dashed border-white/10 bg-[#120e13] px-4 py-3 text-sm"
                />
              </label>
            </div>

            <label className="mt-5 inline-flex items-center gap-3 text-sm text-[#d8d4db]">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked
                className="h-4 w-4 accent-[#d07a3e]"
              />
              Publish this title to the public SyncPass lobby
            </label>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-full bg-[#d07a3e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b76630]"
              >
                Add featured movie
              </button>
              <Link
                href={uploadHref()}
                className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
              >
                Upload new media asset
              </Link>
            </div>
          </form>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-[#17131a]/85 p-8 shadow-[0_22px_60px_rgba(0,0,0,0.24)]">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
              Admin notes
            </p>
            <ul className="mt-6 space-y-4 text-sm leading-6 text-[#c7c2ca]">
              <li className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
                Public users only create rooms from featured catalog entries, not
                from the raw upload flow.
              </li>
              <li className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
                Each active featured movie should point to one uploaded media
                asset so room creation can stay deterministic.
              </li>
              <li className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4">
                Alternate audio and subtitle management still live on the linked
                media asset and continue into the room and Chromecast flows.
              </li>
            </ul>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={uploadHref()}
                className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
              >
                Media ingest
              </Link>
              <Link
                href={adminHref()}
                className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
              >
                Refresh dashboard
              </Link>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-[#17131a]/85 p-8 shadow-[0_22px_60px_rgba(0,0,0,0.24)]">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
              Media library
            </p>
            <div className="mt-6 space-y-4">
              {dashboard.mediaAssets.length > 0 ? (
                dashboard.mediaAssets.slice(0, 8).map((mediaAsset) => (
                  <Link
                    key={mediaAsset.id}
                    href={mediaHref(mediaAsset.id)}
                    className="block rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4 transition hover:border-[#8fa7c7]"
                  >
                    <p className="text-base font-semibold text-white">
                      {mediaAsset.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#bcb7c1]">
                      {mediaAsset.audioTrackCount} audio track
                      {mediaAsset.audioTrackCount === 1 ? "" : "s"} /{" "}
                      {mediaAsset.subtitleTrackCount} subtitle track
                      {mediaAsset.subtitleTrackCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-[#8c8a91]">
                      {mediaAsset.originalFilename}
                    </p>
                  </Link>
                ))
              ) : (
                <p className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4 text-sm leading-6 text-[#c7c2ca]">
                  No uploaded media assets are available yet. Upload a movie
                  package first, then assign it to a featured catalog entry.
                </p>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#8fa7c7]">
              Catalog lineup
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Existing featured movies
            </h2>
          </div>
          <p className="text-sm text-[#bcb7c1]">
            Public lobby capacity: {dashboard.activeMovieCount}/10 active titles
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {dashboard.movies.map((movie) => (
            <div
              key={movie.id}
              className="rounded-[2rem] border border-white/10 bg-[#17131a]/85 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
            >
              <div className="grid gap-5 md:grid-cols-[12rem_1fr]">
                <CatalogMoviePoster
                  title={movie.title}
                  posterUrl={movie.posterUrl}
                  className="aspect-[3/4] h-full min-h-[18rem]"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${
                        movie.isActive
                          ? "bg-[#173022] text-[#97ddb0]"
                          : "bg-[#2a242d] text-[#c6bfca]"
                      }`}
                    >
                      {movie.isActive ? "Active" : "Inactive"}
                    </span>
                    <span className="rounded-full bg-[#111d2c] px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#aac7ea]">
                      Order {movie.sortOrder}
                    </span>
                    {movie.mediaAssetTitle ? (
                      <Link
                        href={movieHref(movie.slug)}
                        className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white transition hover:border-[#8fa7c7]"
                      >
                        Public page
                      </Link>
                    ) : null}
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold text-white">
                    {movie.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[#c7c2ca]">
                    {movie.synopsis}
                  </p>
                  <div className="mt-4 space-y-2 text-xs leading-6 text-[#9e9aa2]">
                    <p>Slug: {movie.slug}</p>
                    <p>
                      Release label: {movie.releaseLabel ?? "Not set"}
                    </p>
                    <p>
                      Linked media: {movie.mediaAssetTitle ?? "Not linked"}
                    </p>
                    <p>
                      Languages: {movie.languageAvailabilityLabel ?? "Derived after media is linked"}
                    </p>
                  </div>
                </div>
              </div>

              <form
                action={updateCatalogMovieAction}
                encType="multipart/form-data"
                className="mt-6 grid gap-4 rounded-[1.6rem] border border-white/10 bg-black/20 p-5"
              >
                <input type="hidden" name="movieId" value={movie.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-white">
                    Title
                    <input
                      name="title"
                      type="text"
                      required
                      defaultValue={movie.title}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                    />
                  </label>
                  <label className="text-sm font-semibold text-white">
                    Slug
                    <input
                      name="slug"
                      type="text"
                      defaultValue={movie.slug}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                    />
                  </label>
                  <label className="text-sm font-semibold text-white md:col-span-2">
                    Synopsis
                    <textarea
                      name="synopsis"
                      required
                      rows={4}
                      defaultValue={movie.synopsis}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 py-3 text-sm outline-none transition focus:border-[#8fa7c7]"
                    />
                  </label>
                  <label className="text-sm font-semibold text-white">
                    Release label
                    <input
                      name="releaseLabel"
                      type="text"
                      defaultValue={movie.releaseLabel ?? ""}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                    />
                  </label>
                  <label className="text-sm font-semibold text-white">
                    Display order
                    <input
                      name="sortOrder"
                      type="number"
                      min={0}
                      defaultValue={movie.sortOrder}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                    />
                  </label>
                  <label className="text-sm font-semibold text-white">
                    Linked media asset
                    <select
                      name="mediaAssetId"
                      defaultValue={movie.mediaAssetId ?? ""}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#120e13] px-4 text-sm outline-none transition focus:border-[#8fa7c7]"
                    >
                      <option value="">No linked media asset yet</option>
                      {dashboard.mediaAssets.map((mediaAsset) => (
                        <option key={mediaAsset.id} value={mediaAsset.id}>
                          {mediaAsset.title} / {mediaAsset.audioTrackCount} audio
                          / {mediaAsset.subtitleTrackCount} subtitles
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-white">
                    Replace poster
                    <input
                      name="posterFile"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      className="mt-2 block w-full rounded-2xl border border-dashed border-white/10 bg-[#120e13] px-4 py-3 text-sm"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-3 text-sm text-[#d8d4db]">
                    <input
                      name="isActive"
                      type="checkbox"
                      defaultChecked={movie.isActive}
                      className="h-4 w-4 accent-[#d07a3e]"
                    />
                    Publish to the public lobby
                  </label>
                  <label className="inline-flex items-center gap-3 text-sm text-[#d8d4db]">
                    <input
                      name="clearPoster"
                      type="checkbox"
                      className="h-4 w-4 accent-[#d07a3e]"
                    />
                    Remove stored poster
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    className="rounded-full bg-[#d07a3e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b76630]"
                  >
                    Save changes
                  </button>
                  <Link
                    href={movie.mediaAssetId ? mediaHref(movie.mediaAssetId) : adminHref()}
                    className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
                  >
                    {movie.mediaAssetId ? "Open media asset" : "Stay here"}
                  </Link>
                </div>
              </form>

              <form action={deleteCatalogMovieAction} className="mt-4">
                <input type="hidden" name="movieId" value={movie.id} />
                <button
                  type="submit"
                  className="rounded-full border border-[#6e2a2e]/40 px-5 py-3 text-sm font-semibold text-[#ffd2d0] transition hover:bg-[#45171b]"
                >
                  Delete featured movie
                </button>
              </form>
            </div>
          ))}

          <EmptyMovieSlots remainingSlots={remainingSlots} />
        </div>
      </section>
    </PageShell>
  );
}
