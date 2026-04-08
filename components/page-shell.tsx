import type { ReactNode } from "react";
import Link from "next/link";
import { homeHref, uploadHref } from "@/lib/routes";

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
      <header className="rounded-[2rem] border border-line bg-white/70 px-6 py-5 shadow-[0_18px_45px_rgba(42,31,22,0.06)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              href={homeHref()}
              className="text-sm font-semibold uppercase tracking-[0.3em] text-muted"
            >
              video-web-cast
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-muted sm:text-lg">
              {description}
            </p>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link
              href={homeHref()}
              className="rounded-full border border-line px-4 py-2 transition hover:border-accent hover:text-accent-strong"
            >
              Home
            </Link>
            <Link
              href={uploadHref()}
              className="rounded-full border border-line px-4 py-2 transition hover:border-accent hover:text-accent-strong"
            >
              Upload
            </Link>
          </nav>
        </div>
      </header>

      <div className="mt-10">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
          {eyebrow}
        </p>
      </div>

      <div className="mt-4 flex-1 space-y-6">{children}</div>
    </main>
  );
}
