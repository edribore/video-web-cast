import type { RoomAudioTrackSummary } from "@/types/room-sync";

export type AudioSelectionMode = "auto" | "manual";

type BrowserLanguageSource = {
  language?: string | null;
  languages?: readonly string[] | null;
};

type AudioTrackLanguageCandidate = Pick<
  RoomAudioTrackSummary,
  "id" | "label" | "language"
>;

type ResolvedLanguageMatch = {
  matchedPreferredLanguage: string | null;
  matchedTrackLanguage: string | null;
  score: number;
  trackId: string;
  trackIndex: number;
};

const languageAliases = new Map<string, string>([
  ["english", "en"],
  ["eng", "en"],
  ["ingles", "en"],
  ["inglish", "en"],
  ["spanish", "es"],
  ["spa", "es"],
  ["espanol", "es"],
  ["español", "es"],
  ["castellano", "es"],
  ["latino", "es-419"],
  ["latin", "es-419"],
  ["french", "fr"],
  ["francais", "fr"],
  ["français", "fr"],
  ["german", "de"],
  ["deutsch", "de"],
  ["italian", "it"],
  ["italiano", "it"],
  ["portuguese", "pt"],
  ["portugues", "pt"],
  ["português", "pt"],
  ["brazilian", "pt-br"],
  ["brasileiro", "pt-br"],
  ["japanese", "ja"],
  ["nihongo", "ja"],
  ["korean", "ko"],
  ["hangul", "ko"],
  ["chinese", "zh"],
  ["mandarin", "zh"],
  ["cantonese", "yue"],
]);

function normalizeLanguageText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/_/g, "-")
    .trim();
}

function canonicalizeLanguageCode(value: string) {
  const normalizedValue = normalizeLanguageText(value);
  const aliasedValue = languageAliases.get(normalizedValue) ?? normalizedValue;

  if (!aliasedValue) {
    return null;
  }

  const languageParts = aliasedValue
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);

  if (languageParts.length === 0) {
    return null;
  }

  const [languagePart, ...regionParts] = languageParts;

  if (!/^[a-z]{2,3}$/.test(languagePart)) {
    return null;
  }

  return [languagePart, ...regionParts].join("-");
}

function collectLanguageKeys(value: string) {
  const normalizedValue = normalizeLanguageText(value);
  const keys = new Set<string>();
  const canonicalCode = canonicalizeLanguageCode(value);

  if (canonicalCode) {
    keys.add(canonicalCode);
    keys.add(canonicalCode.split("-")[0]);
  }

  if (normalizedValue) {
    keys.add(normalizedValue);
    const aliasedValue = languageAliases.get(normalizedValue);

    if (aliasedValue) {
      keys.add(aliasedValue);
      keys.add(aliasedValue.split("-")[0]);
    }

    normalizedValue
      .split(/[^a-z0-9-]+/g)
      .filter(Boolean)
      .forEach((segment) => {
        keys.add(segment);
        const segmentAlias = languageAliases.get(segment);

        if (segmentAlias) {
          keys.add(segmentAlias);
          keys.add(segmentAlias.split("-")[0]);
        }
      });
  }

  return [...keys].filter(Boolean);
}

function buildTrackLanguageKeys(track: AudioTrackLanguageCandidate) {
  const keys = new Set<string>();

  collectLanguageKeys(track.language).forEach((key) => keys.add(key));
  collectLanguageKeys(track.label).forEach((key) => keys.add(key));

  return keys;
}

export function getPreferredBrowserLanguages(
  source:
    | BrowserLanguageSource
    | null
    | undefined = typeof navigator === "undefined"
    ? null
    : navigator,
) {
  const orderedInputLanguages = [
    ...(source?.languages ?? []),
    source?.language ?? null,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const normalizedLanguages: string[] = [];
  const seenLanguages = new Set<string>();

  orderedInputLanguages.forEach((languageValue) => {
    const canonicalCode = canonicalizeLanguageCode(languageValue);
    const expandedCodes = canonicalCode
      ? [canonicalCode, canonicalCode.split("-")[0]]
      : collectLanguageKeys(languageValue);

    expandedCodes.forEach((expandedCode) => {
      if (!expandedCode || seenLanguages.has(expandedCode)) {
        return;
      }

      seenLanguages.add(expandedCode);
      normalizedLanguages.push(expandedCode);
    });
  });

  return normalizedLanguages;
}

export function resolvePreferredExternalAudioTrack<T extends AudioTrackLanguageCandidate>(
  input: {
    audioTracks: readonly T[];
    preferredLanguages?: readonly string[] | null;
    requestedAudioTrackId?: string | null;
  },
) {
  if (input.requestedAudioTrackId) {
    const requestedTrack = input.audioTracks.find(
      (track) => track.id === input.requestedAudioTrackId,
    );

    if (requestedTrack) {
      return {
        matchedPreferredLanguage: null,
        matchedTrackLanguage: requestedTrack.language,
        reason: "manual" as const,
        trackId: requestedTrack.id,
      };
    }
  }

  if (input.audioTracks.length === 0) {
    return {
      matchedPreferredLanguage: null,
      matchedTrackLanguage: null,
      reason: "embedded" as const,
      trackId: null,
    };
  }

  const preferredLanguages =
    input.preferredLanguages?.filter((value) => value.trim().length > 0) ?? [];
  let bestMatch: ResolvedLanguageMatch | null = null;

  preferredLanguages.forEach((preferredLanguage, preferredIndex) => {
    const preferredCode = canonicalizeLanguageCode(preferredLanguage);
    const preferredBaseCode = preferredCode?.split("-")[0] ?? null;
    const preferredKeys = collectLanguageKeys(preferredLanguage);

    input.audioTracks.forEach((track, trackIndex) => {
      const trackKeys = buildTrackLanguageKeys(track);
      const trackCode = canonicalizeLanguageCode(track.language);
      const trackBaseCode = trackCode?.split("-")[0] ?? null;
      let score = 0;

      if (preferredCode && trackCode === preferredCode) {
        score = 500;
      } else if (
        preferredBaseCode &&
        (trackBaseCode === preferredBaseCode || trackKeys.has(preferredBaseCode))
      ) {
        score = 350;
      } else if (preferredKeys.some((key) => trackKeys.has(key))) {
        score = 200;
      }

      if (score === 0) {
        return;
      }

      const weightedScore =
        score - preferredIndex * 250 - trackIndex * 0.01;
      const nextMatch: ResolvedLanguageMatch = {
        matchedPreferredLanguage: preferredCode ?? preferredLanguage,
        matchedTrackLanguage: trackCode ?? track.language,
        score: weightedScore,
        trackId: track.id,
        trackIndex,
      };

      if (!bestMatch || nextMatch.score > bestMatch.score) {
        bestMatch = nextMatch;
      }
    });
  });

  if (bestMatch !== null) {
    const resolvedBestMatch = bestMatch as ResolvedLanguageMatch;

    return {
      matchedPreferredLanguage: resolvedBestMatch.matchedPreferredLanguage,
      matchedTrackLanguage: resolvedBestMatch.matchedTrackLanguage,
      reason: "language_match" as const,
      trackId: resolvedBestMatch.trackId,
    };
  }

  return {
    matchedPreferredLanguage: null,
    matchedTrackLanguage: input.audioTracks[0]?.language ?? null,
    reason: "first_external" as const,
    trackId: input.audioTracks[0]?.id ?? null,
  };
}
