import Link from "next/link";
import { notFound } from "next/navigation";
import { createRoomForMediaAction } from "@/app/media/actions";
import { DebugPageState } from "@/components/debug-runtime";
import { PageShell } from "@/components/page-shell";
import { homeHref, uploadHref } from "@/lib/routes";
import { getMediaAssetDetails } from "@/server/media-library";

type MediaDetailsPageProps = {
  params: Promise<{ mediaId: string }>;
};

export default async function MediaDetailsPage({
  params,
}: MediaDetailsPageProps) {
  const { mediaId } = await params;
  const mediaAsset = await getMediaAssetDetails(mediaId);

  if (!mediaAsset) {
    notFound();
  }

  const createRoomAction = createRoomForMediaAction.bind(null, mediaAsset.id);

  return (
    <PageShell
      eyebrow="Upload complete"
      title={mediaAsset.title}
      description="The uploaded video, audio, and subtitle metadata were stored successfully. Use this page as the handoff point into room creation."
    >
      <DebugPageState
        scope="page/media"
        data={{
          mediaAsset: {
            id: mediaAsset.id,
            title: mediaAsset.title,
            originalFilename: mediaAsset.originalFilename,
            storagePath: mediaAsset.storagePath,
            audioTracks: mediaAsset.audioTracks.map((track) => ({
              id: track.id,
              label: track.label,
              language: track.language,
              originalFormat: track.originalFormat,
              normalizedPath: track.normalizedPath,
              isDefault: track.isDefault,
            })),
            subtitleTracks: mediaAsset.subtitleTracks.map((track) => ({
              id: track.id,
              label: track.label,
              language: track.language,
              originalFormat: track.originalFormat,
              normalizedPath: track.normalizedPath,
              isRenderable: track.isRenderable,
              isDefault: track.isDefault,
            })),
          },
          actions: ["Create a room", "Upload another media asset", "Back to home"],
        }}
      />
      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr_0.95fr]">
        <div className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Media asset
          </p>
          <dl className="mt-6 space-y-4">
            <div className="rounded-3xl border border-line/80 bg-white/75 px-5 py-4">
              <dt className="text-sm text-muted">Title</dt>
              <dd className="mt-1 text-base font-semibold">{mediaAsset.title}</dd>
            </div>
            <div className="rounded-3xl border border-line/80 bg-white/75 px-5 py-4">
              <dt className="text-sm text-muted">Original filename</dt>
              <dd className="mt-1 text-base font-semibold">
                {mediaAsset.originalFilename}
              </dd>
            </div>
            <div className="rounded-3xl border border-line/80 bg-white/75 px-5 py-4">
              <dt className="text-sm text-muted">Storage path</dt>
              <dd className="mt-1 font-mono text-sm">{mediaAsset.storagePath}</dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <form action={createRoomAction}>
              <button
                type="submit"
                className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong"
              >
                Create a room
              </button>
            </form>
            <Link
              href={uploadHref()}
              className="rounded-full border border-line px-5 py-3 text-sm font-semibold transition hover:border-accent hover:text-accent-strong"
            >
              Upload another media asset
            </Link>
            <Link
              href={homeHref()}
              className="rounded-full border border-line px-5 py-3 text-sm font-semibold transition hover:border-accent hover:text-accent-strong"
            >
              Back to home
            </Link>
          </div>
        </div>

        <aside className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Audio tracks
          </p>
          {mediaAsset.audioTracks.length > 0 ? (
            <div className="mt-6 space-y-4">
              {mediaAsset.audioTracks.map((track) => (
                <div
                  key={track.id}
                  className="rounded-3xl border border-line/80 bg-panel px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">{track.label}</p>
                      <p className="mt-1 text-sm text-muted">
                        Language: {track.language}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
                      {track.originalFormat}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Source path: {track.sourcePath}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Browser path: {track.normalizedPath}
                  </p>
                  <p className="mt-3 text-xs font-semibold text-muted">
                    {track.isDefault
                      ? "Marked as the default alternate audio track."
                      : "Available for per-participant audio selection."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-3xl border border-line/80 bg-panel px-5 py-4 text-sm leading-6 text-muted">
              No alternate audio tracks were uploaded with this media asset.
            </p>
          )}
        </aside>

        <aside className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Subtitle tracks
          </p>
          {mediaAsset.subtitleTracks.length > 0 ? (
            <div className="mt-6 space-y-4">
              {mediaAsset.subtitleTracks.map((track) => (
                <div
                  key={track.id}
                  className="rounded-3xl border border-line/80 bg-panel px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">{track.label}</p>
                      <p className="mt-1 text-sm text-muted">
                        Language: {track.language}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
                      {track.originalFormat}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Source path: {track.sourcePath}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Browser path: {track.normalizedPath ?? "Not available yet"}
                  </p>
                  <p className="mt-3 text-xs font-semibold text-muted">
                    {track.isRenderable
                      ? "Ready for browser subtitle rendering."
                      : "Stored now; WebVTT normalization is still pending for this format."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-3xl border border-line/80 bg-panel px-5 py-4 text-sm leading-6 text-muted">
              No subtitle files were uploaded with this media asset.
            </p>
          )}
        </aside>
      </section>
    </PageShell>
  );
}
