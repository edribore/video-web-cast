import Link from "next/link";
import { DebugPageState } from "@/components/debug-runtime";
import { PageShell } from "@/components/page-shell";
import { UploadFormScaffold } from "@/components/upload-form-scaffold";
import { adminHref, adminMediaHref, homeHref } from "@/lib/routes";
import { getUploadScaffoldConfig } from "@/server/media-library";

export default async function AdminUploadPage() {
  const uploadConfig = getUploadScaffoldConfig();

  return (
    <PageShell
      eyebrow="Admin media ingest"
      title="Upload a SyncPass media asset"
      description="Bring in the base MP4, alternate audio tracks, and subtitle tracks that will power a curated SyncPass catalog movie."
    >
      <DebugPageState
        scope="page/admin-upload"
        data={{
          uploadConfig,
          notes: [
            "MP4 video is required.",
            "Audio and subtitle tracks are optional and persisted independently.",
            "SRT subtitle uploads are converted to WebVTT.",
          ],
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <UploadFormScaffold config={uploadConfig} />

        <aside className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Admin workflow
          </p>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-muted">
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              The MP4 file is validated and stored in local development storage.
            </li>
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              Alternate audio files and subtitle files are persisted as their
              own Prisma track rows.
            </li>
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              SRT subtitle uploads are converted to browser-usable WebVTT files
              during the upload flow.
            </li>
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              After upload, the app redirects to the media details page so an
              admin can review tracks and connect the asset to a featured movie.
            </li>
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={adminHref()}
              className="inline-flex rounded-full border border-line px-5 py-3 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent-strong"
            >
              Back to admin
            </Link>
            <Link
              href={adminMediaHref()}
              className="inline-flex rounded-full border border-line px-5 py-3 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent-strong"
            >
              Media library
            </Link>
            <Link
              href={homeHref()}
              className="inline-flex rounded-full border border-line px-5 py-3 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent-strong"
            >
              Public home
            </Link>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
