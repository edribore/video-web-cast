import Link from "next/link";
import { DebugPageState } from "@/components/debug-runtime";
import { PageShell } from "@/components/page-shell";
import {
  adminHref,
  adminUploadHref,
  mediaHref,
} from "@/lib/routes";
import { listMediaAssetsForSelection } from "@/server/media-library";

export const dynamic = "force-dynamic";

export default async function AdminMediaLibraryPage() {
  const mediaAssets = await listMediaAssetsForSelection();

  return (
    <PageShell
      eyebrow="Admin media"
      title="Browse uploaded media assets"
      description="Inspect uploaded movie packages, review their track counts, and open the detailed asset view before assigning them to the SyncPass catalog."
    >
      <DebugPageState
        scope="page/admin-media-library"
        data={{
          mediaAssetCount: mediaAssets.length,
          mediaAssets,
        }}
      />

      <section className="grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
        <aside className="rounded-[2rem] border border-white/10 bg-[#17131a]/88 p-8 shadow-[0_22px_60px_rgba(0,0,0,0.24)]">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
            Media library
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Catalog-ready assets
          </h2>
          <p className="mt-4 text-sm leading-7 text-[#c7c2ca]">
            Each media asset can power a featured movie in the public lobby. Open
            an asset to inspect its alternate audio tracks, subtitle tracks, and
            direct-room testing controls.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={adminUploadHref()}
              className="rounded-full bg-[#d07a3e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b76630]"
            >
              Upload new media asset
            </Link>
            <Link
              href={adminHref()}
              className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
            >
              Back to admin
            </Link>
          </div>
        </aside>

        <div className="grid gap-4 md:grid-cols-2">
          {mediaAssets.length > 0 ? (
            mediaAssets.map((mediaAsset) => (
              <Link
                key={mediaAsset.id}
                href={mediaHref(mediaAsset.id)}
                className="rounded-[1.8rem] border border-white/10 bg-[#17131a]/88 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.2)] transition hover:border-[#8fa7c7]"
              >
                <p className="text-lg font-semibold text-white">
                  {mediaAsset.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
                  {mediaAsset._count.audioTracks} audio track
                  {mediaAsset._count.audioTracks === 1 ? "" : "s"} /{" "}
                  {mediaAsset._count.subtitleTracks} subtitle track
                  {mediaAsset._count.subtitleTracks === 1 ? "" : "s"}
                </p>
                <p className="mt-3 text-xs leading-6 text-[#8c8a91]">
                  {mediaAsset.originalFilename}
                </p>
                <p className="mt-2 text-xs leading-6 text-[#8c8a91]">
                  Uploaded {new Date(mediaAsset.createdAt).toLocaleString()}
                </p>
              </Link>
            ))
          ) : (
            <div className="rounded-[1.8rem] border border-white/10 bg-[#17131a]/88 p-6 text-sm leading-7 text-[#c7c2ca]">
              No media assets are available yet. Upload a movie package before
              assigning it to the featured catalog.
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
