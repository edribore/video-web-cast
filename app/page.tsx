import Link from "next/link";
import { DebugPageState } from "@/components/debug-runtime";
import { HomeRoomActions } from "@/components/home-room-actions";
import { PageShell } from "@/components/page-shell";
import { uploadHref } from "@/lib/routes";

export default function HomePage() {
  return (
    <PageShell
      eyebrow="MVP architecture"
      title="video-web-cast"
      description="A clean starting point for synchronized watch parties with room-based playback, media upload, and room sync flows."
    >
      <DebugPageState
        scope="page/home"
        data={{
          title: "video-web-cast",
          primaryActions: ["Upload media", "Create a room", "Join room"],
        }}
      />
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
        <div className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]">
          <p className="max-w-2xl text-lg leading-8 text-muted">
            Upload one MP4, attach subtitle tracks, and create a shareable room
            URL. Room playback now synchronizes across browsers, and
            Chromecast can mirror the shared room timeline from the same LAN.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={uploadHref()}
              className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong"
            >
              Upload media
            </Link>
            <a
              href="#room-actions"
              className="rounded-full border border-line bg-white/70 px-5 py-3 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent-strong"
            >
              Create or join a room
            </a>
          </div>
        </div>

        <div className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            MVP slices
          </p>
          <div className="mt-6 space-y-4">
            <div className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              <h2 className="text-lg font-semibold">Media ingest</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Upload flow scaffolded for a single MP4 plus multiple subtitle
                files, ready to connect to storage and Prisma records.
              </p>
            </div>
            <div className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              <h2 className="text-lg font-semibold">Room sync</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Socket.IO keeps the room timeline authoritative so play, pause,
                seek, and stop stay aligned between connected browsers.
              </p>
            </div>
            <div className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              <h2 className="text-lg font-semibold">Future platform hooks</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Chromecast now targets the Default Media Receiver, while group
                video call integration remains a separate future subsystem.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="room-actions"
        className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]"
      >
        <HomeRoomActions />
        <div className="rounded-[2rem] border border-line bg-white/75 p-8 shadow-[0_20px_50px_rgba(42,31,22,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            What comes next
          </p>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-muted">
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              Authoritative room playback mirrored to Chromecast on the LAN.
            </li>
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              Media persistence wired into the existing Prisma schema and local storage.
            </li>
            <li className="rounded-3xl border border-line/80 bg-panel px-5 py-4">
              Debug JSON export for ChatGPT diagnostics plus later call overlays.
            </li>
          </ul>
        </div>
      </section>
    </PageShell>
  );
}
