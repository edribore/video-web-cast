import type { ReactNode } from "react";
import Link from "next/link";
import { adminHref, homeHref } from "@/lib/routes";

type PageShellProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}>;

export function PageShell({
  eyebrow,
  title,
  description,
  children,
}: PageShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:px-10">
      <header className="rounded-[2rem] border border-white/10 bg-[#120f15]/90 px-6 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              href={homeHref()}
              className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]"
            >
              SyncPass
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[#c7c2ca] sm:text-lg">
              {description}
            </p>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link
              href={homeHref()}
              className="rounded-full border border-white/10 px-4 py-2 text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
            >
              Home
            </Link>
            <Link
              href={adminHref()}
              className="rounded-full border border-white/10 px-4 py-2 text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <div className="mt-10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#8fa7c7]">
          {eyebrow}
        </p>
      </div>

      <div className="mt-4 flex-1 space-y-6">{children}</div>
    </main>
  );
}
