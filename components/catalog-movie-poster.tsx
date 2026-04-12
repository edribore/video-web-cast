import Image from "next/image";

type CatalogMoviePosterProps = {
  title: string;
  posterUrl: string | null;
  priorityTone?: "amber" | "blue" | "crimson" | "teal";
  className?: string;
};

const posterToneClasses: Record<
  NonNullable<CatalogMoviePosterProps["priorityTone"]>,
  string
> = {
  amber:
    "from-[#3f1e14] via-[#8d4a21] to-[#f0b46a]",
  blue:
    "from-[#111b2f] via-[#274a76] to-[#80b2e2]",
  crimson:
    "from-[#240d12] via-[#7a263a] to-[#e2a27a]",
  teal:
    "from-[#0d2020] via-[#1b5759] to-[#92d0c6]",
};

function buildPosterTone(title: string, explicitTone?: CatalogMoviePosterProps["priorityTone"]) {
  if (explicitTone) {
    return explicitTone;
  }

  const tones = Object.keys(posterToneClasses) as Array<
    keyof typeof posterToneClasses
  >;
  const hashSeed = title
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);

  return tones[hashSeed % tones.length];
}

function buildTitleMonogram(title: string) {
  const tokens = title
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 2);

  return tokens.length > 0
    ? tokens.map((token) => token[0]?.toUpperCase() ?? "").join("")
    : "SP";
}

export function CatalogMoviePoster({
  title,
  posterUrl,
  priorityTone,
  className,
}: CatalogMoviePosterProps) {
  const tone = buildPosterTone(title, priorityTone);

  return (
    <div
      className={`relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-black shadow-[0_22px_50px_rgba(0,0,0,0.28)] ${className ?? ""}`}
    >
      {posterUrl ? (
        <Image
          src={posterUrl}
          alt={`${title} poster`}
          fill
          sizes="(max-width: 768px) 100vw, 320px"
          className="object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${posterToneClasses[tone]}`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.35),transparent_35%),linear-gradient(180deg,transparent,rgba(0,0,0,0.48))]" />
          <div className="relative text-center text-white">
            <p className="text-[3.4rem] font-semibold tracking-[0.2em]">
              {buildTitleMonogram(title)}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.45em] text-white/70">
              SyncPass Premiere
            </p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.55))]" />
    </div>
  );
}
