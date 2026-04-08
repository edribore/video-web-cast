export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeBaseUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return trimTrailingSlash(new URL(value).toString());
  } catch {
    return null;
  }
}

function getConfiguredBaseUrlEnvironmentValues() {
  return [
    process.env.PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL,
  ];
}

function getConfiguredCastBaseUrlEnvironmentValues() {
  return [
    process.env.CAST_BASE_URL,
    process.env.NEXT_PUBLIC_CAST_BASE_URL,
  ];
}

function getLanOverrideBaseUrlEnvironmentValues() {
  return [
    process.env.PUBLIC_LAN_BASE_URL,
    process.env.NEXT_PUBLIC_PUBLIC_LAN_BASE_URL,
    process.env.LAN_PUBLIC_BASE_URL,
  ];
}

export function resolveConfiguredPublicBaseUrl() {
  for (const candidate of getConfiguredBaseUrlEnvironmentValues()) {
    const normalizedCandidate = normalizeBaseUrl(candidate);

    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return null;
}

export function resolveConfiguredCastBaseUrl() {
  for (const candidate of getConfiguredCastBaseUrlEnvironmentValues()) {
    const normalizedCandidate = normalizeBaseUrl(candidate);

    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return resolveConfiguredPublicBaseUrl();
}

export function resolveConfiguredLanOverrideBaseUrl() {
  for (const candidate of getLanOverrideBaseUrlEnvironmentValues()) {
    const normalizedCandidate = normalizeBaseUrl(candidate);

    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return null;
}

function resolveRequestOrigin(headersList: Headers) {
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "";

  if (!host) {
    return null;
  }

  const protocol =
    headersList.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "http");

  return `${protocol}://${host}`;
}

export function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "::1" ||
    normalizedHostname.startsWith("127.")
  );
}

export function isCastableAbsoluteUrl(urlValue: string | null | undefined) {
  if (!urlValue) {
    return false;
  }

  try {
    const parsedUrl = new URL(urlValue);

    return (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      !isLoopbackHostname(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function resolvePreferredPublicBaseUrl(
  headersList: Headers,
  options: {
    requireCastable: boolean;
    purpose: "app" | "cast";
  },
) {
  const configuredAppBaseUrl = resolveConfiguredPublicBaseUrl();
  const configuredCastBaseUrl = resolveConfiguredCastBaseUrl();
  const requestOrigin = resolveRequestOrigin(headersList);
  const configuredLanOverrideBaseUrl = resolveConfiguredLanOverrideBaseUrl();
  const candidates =
    options.purpose === "cast"
      ? [
          configuredCastBaseUrl,
          configuredAppBaseUrl,
          requestOrigin,
          configuredLanOverrideBaseUrl,
        ]
      : [
          configuredAppBaseUrl,
          requestOrigin,
          configuredLanOverrideBaseUrl,
        ];

  if (options.requireCastable) {
    return (
      candidates.find((candidate) => isCastableAbsoluteUrl(candidate)) ?? null
    );
  }

  return candidates.find(Boolean) ?? null;
}

export function resolveRequestPublicBaseUrl(headersList: Headers) {
  return resolvePreferredPublicBaseUrl(headersList, {
    requireCastable: false,
    purpose: "app",
  });
}

export function resolveCastPublicBaseUrl(headersList: Headers) {
  return resolvePreferredPublicBaseUrl(headersList, {
    requireCastable: true,
    purpose: "cast",
  });
}

export function getUrlOrigin(urlValue: string | null | undefined) {
  if (!urlValue) {
    return null;
  }

  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

export function toAbsoluteUrl(pathname: string, baseUrl: string | null) {
  if (!baseUrl) {
    return pathname;
  }

  return new URL(pathname, `${trimTrailingSlash(baseUrl)}/`).toString();
}
