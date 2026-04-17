"use client";

import { createSafeId } from "@/lib/create-safe-id";

type DebugLogLevel = "info" | "warn" | "error";
type DebugCategory =
  | "app"
  | "navigation"
  | "playback"
  | "sync"
  | "socket"
  | "cast"
  | "upload"
  | "resource"
  | "network"
  | "console"
  | "runtime";

type DebugActionSource =
  | "local_user"
  | "socket"
  | "socket_echo"
  | "cast_remote"
  | "cast_local_command"
  | "reconciliation"
  | "cast"
  | "hydration"
  | "system"
  | "page";

export type DebugLogEntry = {
  id: string;
  timestamp: string;
  level: DebugLogLevel;
  category: DebugCategory;
  message: string;
  source?: DebugActionSource;
  data?: unknown;
};

type DebugSnapshotEntry = {
  updatedAt: string;
  data: unknown;
};

type DebugStoreState = {
  appName: string;
  environment: string;
  initializedAt: string;
  entries: DebugLogEntry[];
  pageState: Record<string, DebugSnapshotEntry>;
  runtimeState: Record<string, DebugSnapshotEntry>;
  featureFlags: Record<string, boolean>;
  lastKnownActionSource: DebugActionSource | null;
};

type DebugStore = {
  subscribe(listener: () => void): () => void;
  getState(): DebugStoreState;
  initialize(metadata: Partial<Pick<DebugStoreState, "appName" | "environment">>): void;
  log(entry: Omit<DebugLogEntry, "id" | "timestamp">): DebugLogEntry;
  setPageState(scope: string, data: unknown): void;
  removePageState(scope: string): void;
  setRuntimeState(scope: string, data: unknown): void;
  removeRuntimeState(scope: string): void;
  setFeatureFlags(flags: Record<string, boolean>): void;
  setLastKnownActionSource(source: DebugActionSource | null): void;
};

const debugStoreKey = "__VIDEO_WEB_CAST_DEBUG_STORE__";
const redactedValue = "[REDACTED]";
const sensitiveKeyPattern =
  /(authorization|cookie|secret|token|password|passphrase|database_url|api[_-]?key|client[_-]?secret)/i;
const sensitiveQueryPattern =
  /(authorization|token|signature|secret|password|api[_-]?key|key)/i;

function trimString(value: string, maximumLength = 4000) {
  if (value.length <= maximumLength) {
    return value;
  }

  return `${value.slice(0, maximumLength)}...`;
}

function sanitizeUrlString(value: string) {
  try {
    const url = new URL(value);

    for (const [key] of url.searchParams.entries()) {
      if (sensitiveQueryPattern.test(key)) {
        url.searchParams.set(key, redactedValue);
      }
    }

    return url.toString();
  } catch {
    return trimString(value);
  }
}

function sanitizeDebugValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) {
    return value;
  }

  if (depth > 5) {
    return "[Max depth reached]";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? sanitizeUrlString(value) : value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return sanitizeUrlString(value.toString());
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: trimString(value.message),
      stack: value.stack ? trimString(value.stack, 12000) : undefined,
    };
  }

  if (typeof File !== "undefined" && value instanceof File) {
    return {
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified,
    };
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return {
      size: value.size,
      type: value.type,
    };
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((entry) => sanitizeDebugValue(entry, depth + 1, seen));
  }

  if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) {
    return {
      tagName: value.tagName.toLowerCase(),
      id: value.id || undefined,
      className: value.className || undefined,
      text: trimString(value.textContent?.trim() ?? "", 300),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
    const nextObject: Record<string, unknown> = {};

    for (const [key, nestedValue] of entries) {
      if (sensitiveKeyPattern.test(key)) {
        nextObject[key] = redactedValue;
        continue;
      }

      const sanitizedNestedValue = sanitizeDebugValue(
        nestedValue,
        depth + 1,
        seen,
      );

      if (sanitizedNestedValue !== undefined) {
        nextObject[key] = sanitizedNestedValue;
      }
    }

    return nextObject;
  }

  return String(value);
}

function createInitialDebugState(): DebugStoreState {
  return {
    appName: "SyncPass",
    environment: "development",
    initializedAt: new Date().toISOString(),
    entries: [],
    pageState: {},
    runtimeState: {},
    featureFlags: {
      localPlaybackEnabled: true,
      roomSyncEnabled: true,
      castEnabled: true,
      debugExportEnabled: true,
      subtitleRenderingEnabled: true,
      alternateAudioTrackSupportEnabled: true,
    },
    lastKnownActionSource: null,
  };
}

function createDebugStore(): DebugStore {
  const listeners = new Set<() => void>();
  let state = createInitialDebugState();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const store: DebugStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState() {
      return state;
    },
    initialize(metadata) {
      state = {
        ...state,
        ...metadata,
      };
      notify();
    },
    log(entry) {
      const nextEntry: DebugLogEntry = {
        id: createSafeId(),
        timestamp: new Date().toISOString(),
        level: entry.level,
        category: entry.category,
        message: entry.message,
        source: entry.source,
        data: sanitizeDebugValue(entry.data),
      };

      state = {
        ...state,
        entries: [...state.entries.slice(-199), nextEntry],
        lastKnownActionSource: entry.source ?? state.lastKnownActionSource,
      };
      notify();
      return nextEntry;
    },
    setPageState(scope, data) {
      state = {
        ...state,
        pageState: {
          ...state.pageState,
          [scope]: {
            updatedAt: new Date().toISOString(),
            data: sanitizeDebugValue(data),
          },
        },
      };
      notify();
    },
    removePageState(scope) {
      const nextPageState = { ...state.pageState };
      delete nextPageState[scope];
      state = {
        ...state,
        pageState: nextPageState,
      };
      notify();
    },
    setRuntimeState(scope, data) {
      state = {
        ...state,
        runtimeState: {
          ...state.runtimeState,
          [scope]: {
            updatedAt: new Date().toISOString(),
            data: sanitizeDebugValue(data),
          },
        },
      };
      notify();
    },
    removeRuntimeState(scope) {
      const nextRuntimeState = { ...state.runtimeState };
      delete nextRuntimeState[scope];
      state = {
        ...state,
        runtimeState: nextRuntimeState,
      };
      notify();
    },
    setFeatureFlags(flags) {
      state = {
        ...state,
        featureFlags: {
          ...state.featureFlags,
          ...flags,
        },
      };
      notify();
    },
    setLastKnownActionSource(source) {
      state = {
        ...state,
        lastKnownActionSource: source,
      };
      notify();
    },
  };

  return store;
}

function getStoreHost() {
  return globalThis as typeof globalThis & {
    [debugStoreKey]?: DebugStore;
  };
}

export function getDebugStore() {
  const storeHost = getStoreHost();
  storeHost[debugStoreKey] ??= createDebugStore();
  return storeHost[debugStoreKey]!;
}

export function initializeDebugStore(
  metadata: Partial<Pick<DebugStoreState, "appName" | "environment">>,
) {
  getDebugStore().initialize(metadata);
}

export function subscribeToDebugStore(listener: () => void) {
  return getDebugStore().subscribe(listener);
}

export function getDebugStoreSnapshot() {
  return getDebugStore().getState();
}

export function logDebugEvent(entry: Omit<DebugLogEntry, "id" | "timestamp">) {
  return getDebugStore().log(entry);
}

export function setDebugPageState(scope: string, data: unknown) {
  getDebugStore().setPageState(scope, data);
}

export function removeDebugPageState(scope: string) {
  getDebugStore().removePageState(scope);
}

export function setDebugRuntimeState(scope: string, data: unknown) {
  getDebugStore().setRuntimeState(scope, data);
}

export function removeDebugRuntimeState(scope: string) {
  getDebugStore().removeRuntimeState(scope);
}

export function setDebugFeatureFlags(flags: Record<string, boolean>) {
  getDebugStore().setFeatureFlags(flags);
}

export function setDebugLastActionSource(source: DebugActionSource | null) {
  getDebugStore().setLastKnownActionSource(source);
}

export function sanitizeDebugPayload(value: unknown) {
  return sanitizeDebugValue(value);
}
