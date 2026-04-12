import type { ReactNode } from "react";
import Link from "next/link";
import { adminHref, homeHref } from "@/lib/routes";

type PublicSiteShellProps = {
  children: ReactNode;
};

export function PublicSiteShell({ children }: PublicSiteShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(201,116,61,0.24),transparent_30%),radial-gradient(circle_at_20%_18%,rgba(112,149,195,0.16),transparent_28%),radial-gradient(circle_at_80%_12%,rgba(134,61,79,0.18),transparent_26%),linear-gradient(180deg,#06070c_0%,#090b11_38%,#05070b_100%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(245,188,122,0.14),transparent)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-position:center] [background-size:4rem_4rem]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[92rem] flex-col px-6 pb-12 pt-6 sm:px-8 lg:px-10">
        <header className="rounded-full border border-white/10 bg-black/20 px-5 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={homeHref()}
                className="text-sm font-semibold uppercase tracking-[0.48em] text-[#f2c38f]"
              >
                SyncPass
              </Link>
              <span className="hidden h-5 w-px bg-white/10 lg:block" />
              <p className="hidden text-sm text-[#97a1b1] lg:block">
                Curated screening rooms with a companion-screen control surface.
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold">
              <Link
                href={homeHref()}
                className="rounded-full border border-white/10 px-4 py-2 text-white transition hover:border-[#89b2d8] hover:text-[#ddeeff]"
              >
                Lobby
              </Link>
              <a
                href={`${homeHref()}#featured-premieres`}
                className="rounded-full border border-white/10 px-4 py-2 text-white transition hover:border-[#89b2d8] hover:text-[#ddeeff]"
              >
                Featured premieres
              </a>
              <a
                href={`${homeHref()}#join-room`}
                className="rounded-full border border-white/10 px-4 py-2 text-white transition hover:border-[#89b2d8] hover:text-[#ddeeff]"
              >
                Join room
              </a>
              <Link
                href={adminHref()}
                className="rounded-full border border-[#2a3342] bg-[#10151d] px-4 py-2 text-[#cdd8e9] transition hover:border-[#89b2d8] hover:text-white"
              >
                Staff entrance
              </Link>
            </nav>
          </div>
        </header>

        <div className="flex-1 space-y-10 pt-8">{children}</div>

        <footer className="mt-16 flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-[#8f99a8] sm:flex-row sm:items-center sm:justify-between">
          <p>
            SyncPass keeps one active playback destination per room: locally in
            the browser or on the TV through Chromecast.
          </p>
          <Link
            href={adminHref()}
            className="font-semibold text-[#d6e6ff] transition hover:text-white"
          >
            Open admin tools
          </Link>
        </footer>
      </div>
    </main>
  );
}
