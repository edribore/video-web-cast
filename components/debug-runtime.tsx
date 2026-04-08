"use client";

import {
  type PropsWithChildren,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  getDebugStoreSnapshot,
  initializeDebugStore,
  logDebugEvent,
  removeDebugPageState,
  removeDebugRuntimeState,
  sanitizeDebugPayload,
  setDebugFeatureFlags,
  setDebugPageState,
  setDebugRuntimeState,
} from "@/lib/debug-store";

type DebugRuntimeProviderProps = PropsWithChildren<{
  appName: string;
  environment: string;
  configuredPublicBaseUrl: string | null;
  configuredCastBaseUrl: string | null;
}>;

type DebugPageStateProps = {
  scope: string;
  data: unknown;
};

type ExportState = "idle" | "copied" | "downloaded" | "failed";

type ResourceSnapshot = {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
};

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function isPrivateIpv4Host(hostname: string) {
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }

  const match = hostname.match(/^172\.(\d{1,3})\./);

  if (!match) {
    return false;
  }

  const octet = Number(match[1]);
  return octet >= 16 && octet <= 31;
}

function isLanRelevantOrigin(origin: string | null) {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);
    return !isLoopbackHostname(url.hostname) && isPrivateIpv4Host(url.hostname);
  } catch {
    return false;
  }
}

function isLanSafeUrl(urlValue: string | null | undefined) {
  if (!urlValue) {
    return false;
  }

  try {
    const url = new URL(urlValue, window.location.origin);
    return !isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function collectResourceEntries() {
  if (typeof performance === "undefined") {
    return [];
  }

  return performance
    .getEntriesByType("resource")
    .slice(-80)
    .map((entry) => {
      const resourceEntry = entry as PerformanceResourceTiming;

      const snapshot: ResourceSnapshot = {
        name: resourceEntry.name,
        initiatorType: resourceEntry.initiatorType,
        duration: Number(resourceEntry.duration.toFixed(2)),
      };

      if ("transferSize" in resourceEntry) {
        snapshot.transferSize = resourceEntry.transferSize;
        snapshot.encodedBodySize = resourceEntry.encodedBodySize;
        snapshot.decodedBodySize = resourceEntry.decodedBodySize;
      }

      return snapshot;
    });
}

function collectDomSummary() {
  const videoElement = document.querySelector<HTMLVideoElement>(
    '[data-debug-video-player="true"]',
  );
  const externalAudioElement = document.querySelector<HTMLAudioElement>(
    '[data-debug-external-audio-player="true"]',
  );
  const castButton = document.querySelector('[data-debug-cast-button="true"]');
  const playbackControls = document.querySelector(
    '[data-debug-playback-controls="true"]',
  );
  const roomSyncUi = document.querySelector('[data-debug-room-sync="true"]');
  const audioSelect = document.querySelector<HTMLSelectElement>("#audio-select");
  const subtitleSelect =
    document.querySelector<HTMLSelectElement>("#subtitle-select");
  const interactiveElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a, input, select, textarea, video",
    ),
  )
    .slice(0, 40)
    .map((element) => ({
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      text: element.textContent?.trim().slice(0, 120) || undefined,
      role: element.getAttribute("role") || undefined,
      type:
        element instanceof HTMLInputElement || element instanceof HTMLButtonElement
          ? element.type
          : undefined,
      disabled:
        "disabled" in element
          ? Boolean((element as HTMLInputElement | HTMLButtonElement).disabled)
          : undefined,
    }));

  return {
    keyInteractiveElements: interactiveElements,
    hasVideoElement: Boolean(videoElement),
    videoElementState: videoElement
      ? {
          currentSrc: videoElement.currentSrc,
          currentTime: videoElement.currentTime,
          paused: videoElement.paused,
          muted: videoElement.muted,
          readyState: videoElement.readyState,
          networkState: videoElement.networkState,
          subtitleTrackElementCount: videoElement.querySelectorAll("track").length,
        }
      : null,
    hasExternalAudioElement: Boolean(externalAudioElement),
    externalAudioElementState: externalAudioElement
      ? {
          currentSrc: externalAudioElement.currentSrc,
          currentTime: externalAudioElement.currentTime,
          paused: externalAudioElement.paused,
          muted: externalAudioElement.muted,
          readyState: externalAudioElement.readyState,
          networkState: externalAudioElement.networkState,
          playbackRate: externalAudioElement.playbackRate,
        }
      : null,
    hasSubtitleTrackElements:
      (videoElement?.querySelectorAll("track").length ?? 0) > 0,
    hasCastButton: Boolean(castButton),
    hasPlaybackControls: Boolean(playbackControls),
    hasRoomSyncUi: Boolean(roomSyncUi),
    selectedAudioValue: audioSelect?.value ?? null,
    selectedSubtitleValue: subtitleSelect?.value ?? null,
  };
}

function buildDebugPayload(
  snapshot: ReturnType<typeof getDebugStoreSnapshot>,
  configuredPublicBaseUrl: string | null,
  configuredCastBaseUrl: string | null,
) {
  const currentUrl = window.location.href;
  const currentOrigin = window.location.origin;
  const resourceEntries = collectResourceEntries();
  const domSummary = collectDomSummary();
  const roomPageState =
    snapshot.runtimeState["room/live"]?.data ??
    snapshot.pageState["page/room"]?.data ??
    null;
  const castRuntimeState = snapshot.runtimeState["cast/runtime"]?.data ?? null;
  const castHealthState = snapshot.runtimeState["cast/health"]?.data ?? null;
  const mediaPageState = snapshot.pageState["page/media"]?.data ?? null;
  const uploadPageState =
    snapshot.runtimeState["upload/form"]?.data ??
    snapshot.pageState["page/upload"]?.data ??
    null;

  const consoleErrors = snapshot.entries.filter(
    (entry) =>
      entry.level === "error" &&
      (entry.category === "console" || entry.category === "runtime"),
  );
  const consoleWarnings = snapshot.entries.filter(
    (entry) => entry.level === "warn" && entry.category === "console",
  );
  const castLifecycleEvents = snapshot.entries.filter(
    (entry) => entry.category === "cast",
  );
  const castHistoricalFailures = castLifecycleEvents.filter(
    (entry) => entry.level === "warn" || entry.level === "error",
  );

  const currentMediaUrls =
    typeof roomPageState === "object" && roomPageState
      ? {
          video: (roomPageState as Record<string, unknown>).videoUrl ?? null,
          absoluteVideo:
            (roomPageState as Record<string, unknown>).absoluteVideoUrl ?? null,
          castVideo:
            (roomPageState as Record<string, unknown>).castVideoUrl ?? null,
          subtitles:
            (roomPageState as Record<string, unknown>).subtitleTracks ?? [],
          audioTracks:
            (roomPageState as Record<string, unknown>).audioTracks ?? [],
        }
      : null;
  const roomOrigins =
    typeof roomPageState === "object" && roomPageState
      ? ((roomPageState as Record<string, unknown>).origins as
          | Record<string, unknown>
          | null
          | undefined)
      : null;
  const effectiveAppOrigin =
    (typeof roomOrigins?.appOrigin === "string" ? roomOrigins.appOrigin : null) ??
    configuredPublicBaseUrl ??
    currentOrigin;
  const effectiveMediaOrigin =
    (typeof roomOrigins?.mediaOrigin === "string" ? roomOrigins.mediaOrigin : null) ??
    (currentMediaUrls &&
    typeof currentMediaUrls.absoluteVideo === "string" &&
    isLanSafeUrl(currentMediaUrls.absoluteVideo)
      ? new URL(currentMediaUrls.absoluteVideo).origin
      : null);
  const effectiveCastMediaOrigin =
    (typeof roomOrigins?.castMediaOrigin === "string"
      ? roomOrigins.castMediaOrigin
      : null) ??
    configuredCastBaseUrl;

  return sanitizeDebugPayload({
    appContext: {
      appName: snapshot.appName,
      currentRoute: window.location.pathname,
      fullUrl: currentUrl,
      timestamp: new Date().toISOString(),
      environment: snapshot.environment,
      browserUserAgent: navigator.userAgent,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      currentHostname: window.location.hostname,
      currentOrigin,
      effectiveAppOrigin,
      effectiveMediaOrigin,
      effectiveCastMediaOrigin,
      lanRelevantOrigin: isLanRelevantOrigin(currentOrigin)
        ? currentOrigin
        : configuredCastBaseUrl,
      configuredPublicBaseUrl,
      configuredCastBaseUrl,
    },
    uiVisibleData: {
      pageState: snapshot.pageState,
      runtimeState: snapshot.runtimeState,
      roomInfo: roomPageState,
      mediaAssetInfo: mediaPageState,
      uploadFormState: uploadPageState,
      subtitleTracks:
        currentMediaUrls && typeof currentMediaUrls === "object"
          ? currentMediaUrls.subtitles
          : [],
      audioTracks:
        currentMediaUrls && typeof currentMediaUrls === "object"
          ? currentMediaUrls.audioTracks
          : [],
      playbackSnapshot:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).playback
          : null,
      castStatus:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).cast
          : null,
      castRuntime: castRuntimeState,
      castHealth: castHealthState,
      audioStatus:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).localAudio
          : null,
      syncStatus:
        typeof roomPageState === "object" && roomPageState
          ? {
              connectionStatus: (roomPageState as Record<string, unknown>)
                .connectionStatus,
              syncIssue: (roomPageState as Record<string, unknown>).syncIssue,
            }
          : null,
    },
    executionLog: {
      recentEntries: snapshot.entries,
      playbackEvents: snapshot.entries.filter(
        (entry) => entry.category === "playback",
      ),
      roomSyncEvents: snapshot.entries.filter((entry) => entry.category === "sync"),
      socketEvents: snapshot.entries.filter((entry) => entry.category === "socket"),
      castLifecycleEvents,
      castHistoricalFailures,
      castCurrentHealth: castHealthState,
      uploadEvents: snapshot.entries.filter((entry) => entry.category === "upload"),
      warningsAndErrors: snapshot.entries.filter(
        (entry) => entry.level === "warn" || entry.level === "error",
      ),
      lastKnownActionSource: snapshot.lastKnownActionSource,
    },
    networkResourceLoadInfo: {
      effectiveOrigins: {
        appOrigin: effectiveAppOrigin,
        mediaOrigin: effectiveMediaOrigin,
        castMediaOrigin: effectiveCastMediaOrigin,
      },
      currentMediaUrls: currentMediaUrls
        ? {
            ...currentMediaUrls,
            videoUrlIsAbsolute:
              typeof currentMediaUrls.video === "string"
                ? /^[a-z][a-z0-9+.-]*:\/\//i.test(currentMediaUrls.video)
                : false,
            absoluteVideoUrlIsLanSafe:
              typeof currentMediaUrls.absoluteVideo === "string"
                ? isLanSafeUrl(currentMediaUrls.absoluteVideo)
                : false,
            castVideoUrlIsLanSafe:
              typeof currentMediaUrls.castVideo === "string"
                ? isLanSafeUrl(currentMediaUrls.castVideo)
                : false,
          }
        : null,
      recentlyRequestedResources: resourceEntries,
    },
    runtimeDiagnostics: {
      consoleErrors,
      consoleWarnings,
      runtimeErrors: snapshot.entries.filter(
        (entry) => entry.category === "runtime",
      ),
      hydrationDiagnostics: snapshot.entries.filter((entry) =>
        /hydration/i.test(entry.message),
      ),
      socketState:
        typeof roomPageState === "object" && roomPageState
          ? {
              connected: (roomPageState as Record<string, unknown>)
                .connectionStatus === "connected",
              connectionStatus: (roomPageState as Record<string, unknown>)
                .connectionStatus,
            }
          : null,
      castSdkAvailability:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).cast
          : null,
      castCurrentHealth: castHealthState,
      castRuntime: castRuntimeState,
      localAudioSelection:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).localAudio
          : null,
      participantSessionId:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).participantSessionId
          : null,
      roomId:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).roomId
          : null,
      playbackStateVersion:
        typeof roomPageState === "object" && roomPageState
          ? (roomPageState as Record<string, unknown>).playbackVersion
          : null,
    },
    domDebugSnapshotSummary: domSummary,
    featureFlagsAndCapabilities: snapshot.featureFlags,
  });
}

function downloadJsonFile(contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `video-web-cast-debug-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ExportDebugJsonButton({
  configuredPublicBaseUrl,
  configuredCastBaseUrl,
}: {
  configuredPublicBaseUrl: string | null;
  configuredCastBaseUrl: string | null;
}) {
  const [exportState, setExportState] = useState<ExportState>("idle");

  function buildPayloadJson() {
    return JSON.stringify(
      buildDebugPayload(
        getDebugStoreSnapshot(),
        configuredPublicBaseUrl,
        configuredCastBaseUrl,
      ),
      null,
      2,
    );
  }

  async function handleCopy() {
    try {
      const payloadJson = buildPayloadJson();
      await navigator.clipboard.writeText(payloadJson);
      setExportState("copied");
      logDebugEvent({
        level: "info",
        category: "app",
        message: "Copied debug JSON to clipboard.",
        source: "system",
      });
    } catch (error) {
      setExportState("failed");
      logDebugEvent({
        level: "error",
        category: "runtime",
        message: "Unable to copy debug JSON to the clipboard.",
        source: "system",
        data: error,
      });
    }
  }

  function handleDownload() {
    try {
      const payloadJson = buildPayloadJson();
      downloadJsonFile(payloadJson);
      setExportState("downloaded");
      logDebugEvent({
        level: "info",
        category: "app",
        message: "Downloaded debug JSON snapshot.",
        source: "system",
      });
    } catch (error) {
      setExportState("failed");
      logDebugEvent({
        level: "error",
        category: "runtime",
        message: "Unable to download the debug JSON snapshot.",
        source: "system",
        data: error,
      });
    }
  }

  return (
    <div className="fixed right-4 bottom-4 z-[1000] flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleDownload}
        data-debug-export-button="true"
        className="rounded-full border border-line bg-white/90 px-4 py-3 text-sm font-semibold shadow-[0_18px_45px_rgba(42,31,22,0.14)] backdrop-blur transition hover:border-accent hover:text-accent-strong"
      >
        Export Debug JSON
      </button>
      <div className="flex items-center gap-2 rounded-full border border-line bg-white/90 px-3 py-2 text-xs shadow-[0_18px_45px_rgba(42,31,22,0.14)] backdrop-blur">
        <button
          type="button"
          onClick={handleCopy}
          className="font-semibold transition hover:text-accent-strong"
        >
          Copy JSON
        </button>
        <span className="text-muted">
          {exportState === "copied"
            ? "Copied"
            : exportState === "downloaded"
              ? "Downloaded"
              : exportState === "failed"
                ? "Failed"
                : "Ready"}
        </span>
      </div>
    </div>
  );
}

export function DebugPageState({ scope, data }: DebugPageStateProps) {
  useEffect(() => {
    setDebugPageState(scope, data);

    return () => {
      removeDebugPageState(scope);
    };
  }, [data, scope]);

  return null;
}

export function useDebugPageState(scope: string, data: unknown) {
  useEffect(() => {
    setDebugPageState(scope, data);

    return () => {
      removeDebugPageState(scope);
    };
  }, [data, scope]);
}

export function useDebugRuntimeState(scope: string, data: unknown) {
  useEffect(() => {
    setDebugRuntimeState(scope, data);

    return () => {
      removeDebugRuntimeState(scope);
    };
  }, [data, scope]);
}

export function useDebugFeatureFlags(flags: Record<string, boolean>) {
  useEffect(() => {
    setDebugFeatureFlags(flags);
  }, [flags]);
}

export function DebugRuntimeProvider({
  appName,
  environment,
  configuredPublicBaseUrl,
  configuredCastBaseUrl,
  children,
}: DebugRuntimeProviderProps) {
  const pathname = usePathname();

  useEffect(() => {
    initializeDebugStore({
      appName,
      environment,
    });
    setDebugFeatureFlags({
      debugExportEnabled: true,
    });
  }, [appName, environment]);

  useEffect(() => {
    const route = `${pathname}${window.location.search}`;

    setDebugRuntimeState("app/context", {
      route,
      fullUrl: window.location.href,
      origin: window.location.origin,
      configuredPublicBaseUrl,
      configuredCastBaseUrl,
    });
    logDebugEvent({
      level: "info",
      category: "navigation",
      message: `Navigated to ${route}.`,
      source: "page",
    });
  }, [
    configuredCastBaseUrl,
    configuredPublicBaseUrl,
    pathname,
  ]);

  useEffect(() => {
    const updateViewport = () => {
      setDebugRuntimeState("app/viewport", {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalFetch = window.fetch.bind(window);

    console.warn = (...args: unknown[]) => {
      logDebugEvent({
        level: "warn",
        category: "console",
        message:
          typeof args[0] === "string"
            ? args[0]
            : "console.warn called with a non-string payload.",
        source: "system",
        data: args,
      });
      originalWarn(...args);
    };

    console.error = (...args: unknown[]) => {
      logDebugEvent({
        level: "error",
        category: "console",
        message:
          typeof args[0] === "string"
            ? args[0]
            : "console.error called with a non-string payload.",
        source: "system",
        data: args,
      });
      originalError(...args);
    };

    window.fetch = async (...args) => {
      const requestInput = args[0];
      const requestInit = args[1];
      const url =
        typeof requestInput === "string"
          ? requestInput
          : requestInput instanceof URL
            ? requestInput.toString()
            : requestInput.url;
      const method = requestInit?.method ?? "GET";
      const startedAt = performance.now();

      try {
        const response = await originalFetch(...args);
        logDebugEvent({
          level: "info",
          category: "network",
          message: `${method} ${url} completed with ${response.status}.`,
          source: "system",
          data: {
            method,
            url,
            status: response.status,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
          },
        });
        return response;
      } catch (error) {
        logDebugEvent({
          level: "error",
          category: "network",
          message: `${method} ${url} failed.`,
          source: "system",
          data: {
            method,
            url,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            error,
          },
        });
        throw error;
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      logDebugEvent({
        level: "error",
        category: "runtime",
        message: event.message || "Unhandled window error.",
        source: "system",
        data: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logDebugEvent({
        level: "error",
        category: "runtime",
        message: "Unhandled promise rejection.",
        source: "system",
        data: event.reason,
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      window.fetch = originalFetch;
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <>
      {children}
      <ExportDebugJsonButton
        configuredPublicBaseUrl={configuredPublicBaseUrl}
        configuredCastBaseUrl={configuredCastBaseUrl}
      />
    </>
  );
}
