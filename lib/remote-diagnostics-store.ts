"use client";

import { createSafeId } from "@/lib/create-safe-id";
import {
  appendToBoundedList,
  buildRemoteDiagnosticsTimelines,
  createClockSyncSample,
  createSequenceSnapshot,
  getMonotonicTimestamp,
  remoteDiagnosticsBufferLimits,
} from "@/lib/remote-diagnostics";
import type {
  RemoteDiagnosticsActivation,
  RemoteDiagnosticsClockSyncSample,
  RemoteDiagnosticsClientType,
  RemoteDiagnosticsDriftSnapshot,
  RemoteDiagnosticsEvent,
  RemoteDiagnosticsExport,
  RemoteDiagnosticsOverlaySnapshot,
  RemoteDiagnosticsPipSnapshot,
  RemoteDiagnosticsPlayerSnapshot,
  RemoteDiagnosticsSequenceSnapshot,
  RemoteDiagnosticsSession,
} from "@/types/remote-diagnostics";

type RemoteDiagnosticsStoreState = {
  enabled: boolean;
  session: RemoteDiagnosticsSession;
  events: RemoteDiagnosticsEvent[];
  driftSnapshots: RemoteDiagnosticsDriftSnapshot[];
  overlaySnapshots: RemoteDiagnosticsOverlaySnapshot[];
  pipSnapshots: RemoteDiagnosticsPipSnapshot[];
  clockSyncSamples: RemoteDiagnosticsClockSyncSample[];
  sequenceSnapshots: RemoteDiagnosticsSequenceSnapshot[];
  playerSnapshots: RemoteDiagnosticsPlayerSnapshot[];
  lastSequenceNumber: number | null;
  lastStateVersion: number | null;
  lastCommandEventId: string | null;
  lastCommandAction: RemoteDiagnosticsEvent["action"] | null;
  lastCommandReceivedAtMs: number | null;
  latestServerOffsetMs: number | null;
};

type RemoteDiagnosticsStore = {
  subscribe(listener: () => void): () => void;
  getState(): RemoteDiagnosticsStoreState;
  setEnabled(enabled: boolean, activation: RemoteDiagnosticsActivation): void;
  configureSession(input: Partial<Omit<RemoteDiagnosticsSession, "activation">>): void;
  logEvent(event: Omit<RemoteDiagnosticsEvent, "clientId" | "clientType" | "estimatedServerOffsetMs" | "estimatedServerTimeMs" | "monotonicTs" | "roomId"> & {
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    estimatedServerOffsetMs?: number | null;
    estimatedServerTimeMs?: number | null;
    monotonicTs?: number | null;
  }): RemoteDiagnosticsEvent | null;
  recordDriftSnapshot(snapshot: Omit<RemoteDiagnosticsDriftSnapshot, "clientId" | "clientType" | "id" | "roomId"> & {
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    id?: string;
  }): RemoteDiagnosticsDriftSnapshot | null;
  recordOverlaySnapshot(snapshot: Omit<RemoteDiagnosticsOverlaySnapshot, "clientId" | "clientType" | "id" | "roomId"> & {
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    id?: string;
  }): RemoteDiagnosticsOverlaySnapshot | null;
  recordPipSnapshot(snapshot: Omit<RemoteDiagnosticsPipSnapshot, "clientId" | "clientType" | "id" | "roomId"> & {
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    id?: string;
  }): RemoteDiagnosticsPipSnapshot | null;
  recordPlayerSnapshot(snapshot: Omit<RemoteDiagnosticsPlayerSnapshot, "clientId" | "clientType" | "id" | "roomId"> & {
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    id?: string;
  }): RemoteDiagnosticsPlayerSnapshot | null;
  recordClockSyncSample(sample: {
    sampleId: string;
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    recordedAtMs: number;
    clientSentAtMs: number;
    clientReceivedAtMs: number;
    serverReceivedAtMs: number;
    serverSentAtMs: number;
  }): RemoteDiagnosticsClockSyncSample | null;
  recordSequenceSnapshot(snapshot: {
    eventId: string | null;
    roomId?: string | null;
    clientId?: string | null;
    clientType?: RemoteDiagnosticsClientType;
    recordedAtMs: number;
    sequenceNumber: number | null;
    roomVersion: number | null;
    stateVersion: number | null;
    sourceClientEventId: string | null;
    notes?: string | null;
  }): RemoteDiagnosticsSequenceSnapshot | null;
  clear(): void;
};

const remoteDiagnosticsStoreKey = "__VIDEO_WEB_CAST_REMOTE_DIAGNOSTICS_STORE__";

function createInitialSession(): RemoteDiagnosticsSession {
  return {
    sessionId: createSafeId("remote-diagnostics"),
    startedAt: new Date().toISOString(),
    roomId: null,
    clientId: null,
    clientType: "unknown",
    activation: {
      enabled: false,
      debugRemote: false,
      debugSync: false,
      persisted: false,
      sources: [],
    },
  };
}

function createInitialRemoteDiagnosticsState(): RemoteDiagnosticsStoreState {
  return {
    enabled: false,
    session: createInitialSession(),
    events: [],
    driftSnapshots: [],
    overlaySnapshots: [],
    pipSnapshots: [],
    clockSyncSamples: [],
    sequenceSnapshots: [],
    playerSnapshots: [],
    lastSequenceNumber: null,
    lastStateVersion: null,
    lastCommandEventId: null,
    lastCommandAction: null,
    lastCommandReceivedAtMs: null,
    latestServerOffsetMs: null,
  };
}

function createRemoteDiagnosticsStore(): RemoteDiagnosticsStore {
  const listeners = new Set<() => void>();
  let state = createInitialRemoteDiagnosticsState();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const store: RemoteDiagnosticsStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState() {
      return state;
    },
    setEnabled(enabled, activation) {
      if (!enabled) {
        state = {
          ...createInitialRemoteDiagnosticsState(),
          enabled: false,
          session: {
            ...createInitialSession(),
            activation,
          },
        };
        notify();
        return;
      }

      if (!state.enabled) {
        state = {
          ...createInitialRemoteDiagnosticsState(),
          enabled: true,
          session: {
            ...createInitialSession(),
            activation: {
              ...activation,
              enabled: true,
            },
          },
        };
        notify();
        return;
      }

      state = {
        ...state,
        enabled: true,
        session: {
          ...state.session,
          activation: {
            ...activation,
            enabled: true,
          },
        },
      };
      notify();
    },
    configureSession(input) {
      if (!state.enabled) {
        return;
      }

      state = {
        ...state,
        session: {
          ...state.session,
          ...input,
        },
      };
      notify();
    },
    logEvent(event) {
      if (!state.enabled) {
        return null;
      }

      const resolvedServerOffsetMs =
        event.estimatedServerOffsetMs ?? state.latestServerOffsetMs;

      const nextEvent: RemoteDiagnosticsEvent = {
        ...event,
        roomId: event.roomId ?? state.session.roomId,
        clientId: event.clientId ?? state.session.clientId,
        clientType: event.clientType ?? state.session.clientType,
        estimatedServerOffsetMs: resolvedServerOffsetMs,
        estimatedServerTimeMs:
          event.estimatedServerTimeMs ??
          (resolvedServerOffsetMs != null
            ? event.wallClockTs + resolvedServerOffsetMs
            : null),
        monotonicTs: event.monotonicTs ?? getMonotonicTimestamp(),
      };

      state = {
        ...state,
        events: appendToBoundedList(
          state.events,
          nextEvent,
          remoteDiagnosticsBufferLimits.events,
        ),
        lastCommandEventId:
          nextEvent.action === "play" ||
          nextEvent.action === "pause" ||
          nextEvent.action === "play_pause" ||
          nextEvent.action === "seek_forward" ||
          nextEvent.action === "seek_backward" ||
          nextEvent.action === "seek_to" ||
          nextEvent.action === "state_sync"
            ? nextEvent.eventId
            : state.lastCommandEventId,
        lastCommandAction:
          nextEvent.action === "play" ||
          nextEvent.action === "pause" ||
          nextEvent.action === "play_pause" ||
          nextEvent.action === "seek_forward" ||
          nextEvent.action === "seek_backward" ||
          nextEvent.action === "seek_to" ||
          nextEvent.action === "state_sync"
            ? nextEvent.action
            : state.lastCommandAction,
        lastCommandReceivedAtMs:
          nextEvent.stage === "received" ||
          nextEvent.stage === "applied" ||
          nextEvent.stage === "rendered"
            ? nextEvent.wallClockTs
            : state.lastCommandReceivedAtMs,
      };
      notify();
      return nextEvent;
    },
    recordDriftSnapshot(snapshot) {
      if (!state.enabled) {
        return null;
      }

      const nextSnapshot: RemoteDiagnosticsDriftSnapshot = {
        ...snapshot,
        id: snapshot.id ?? createSafeId("drift"),
        roomId: snapshot.roomId ?? state.session.roomId,
        clientId: snapshot.clientId ?? state.session.clientId,
        clientType: snapshot.clientType ?? state.session.clientType,
      };

      state = {
        ...state,
        driftSnapshots: appendToBoundedList(
          state.driftSnapshots,
          nextSnapshot,
          remoteDiagnosticsBufferLimits.drifts,
        ),
      };
      notify();
      return nextSnapshot;
    },
    recordOverlaySnapshot(snapshot) {
      if (!state.enabled) {
        return null;
      }

      const nextSnapshot: RemoteDiagnosticsOverlaySnapshot = {
        ...snapshot,
        id: snapshot.id ?? createSafeId("overlay"),
        roomId: snapshot.roomId ?? state.session.roomId,
        clientId: snapshot.clientId ?? state.session.clientId,
        clientType: snapshot.clientType ?? state.session.clientType,
      };

      state = {
        ...state,
        overlaySnapshots: appendToBoundedList(
          state.overlaySnapshots,
          nextSnapshot,
          remoteDiagnosticsBufferLimits.overlays,
        ),
      };
      notify();
      return nextSnapshot;
    },
    recordPipSnapshot(snapshot) {
      if (!state.enabled) {
        return null;
      }

      const nextSnapshot: RemoteDiagnosticsPipSnapshot = {
        ...snapshot,
        id: snapshot.id ?? createSafeId("pip"),
        roomId: snapshot.roomId ?? state.session.roomId,
        clientId: snapshot.clientId ?? state.session.clientId,
        clientType: snapshot.clientType ?? state.session.clientType,
        lastCommandEventId:
          snapshot.lastCommandEventId ?? state.lastCommandEventId,
        lastCommandAction:
          snapshot.lastCommandAction ?? state.lastCommandAction,
        lastCommandReceivedAtMs:
          snapshot.lastCommandReceivedAtMs ?? state.lastCommandReceivedAtMs,
      };

      state = {
        ...state,
        pipSnapshots: appendToBoundedList(
          state.pipSnapshots,
          nextSnapshot,
          remoteDiagnosticsBufferLimits.pips,
        ),
      };
      notify();
      return nextSnapshot;
    },
    recordPlayerSnapshot(snapshot) {
      if (!state.enabled) {
        return null;
      }

      const nextSnapshot: RemoteDiagnosticsPlayerSnapshot = {
        ...snapshot,
        id: snapshot.id ?? createSafeId("player"),
        roomId: snapshot.roomId ?? state.session.roomId,
        clientId: snapshot.clientId ?? state.session.clientId,
        clientType: snapshot.clientType ?? state.session.clientType,
      };

      state = {
        ...state,
        playerSnapshots: appendToBoundedList(
          state.playerSnapshots,
          nextSnapshot,
          remoteDiagnosticsBufferLimits.players,
        ),
      };
      notify();
      return nextSnapshot;
    },
    recordClockSyncSample(sample) {
      if (!state.enabled) {
        return null;
      }

      const nextSample = createClockSyncSample({
        id: createSafeId("clock-sync"),
        sampleId: sample.sampleId,
        roomId: sample.roomId ?? state.session.roomId,
        clientId: sample.clientId ?? state.session.clientId,
        clientType: sample.clientType ?? state.session.clientType,
        recordedAtMs: sample.recordedAtMs,
        clientSentAtMs: sample.clientSentAtMs,
        clientReceivedAtMs: sample.clientReceivedAtMs,
        serverReceivedAtMs: sample.serverReceivedAtMs,
        serverSentAtMs: sample.serverSentAtMs,
      });

      state = {
        ...state,
        clockSyncSamples: appendToBoundedList(
          state.clockSyncSamples,
          nextSample,
          remoteDiagnosticsBufferLimits.clockSyncSamples,
        ),
        latestServerOffsetMs: nextSample.estimatedOffsetMs,
      };
      notify();
      return nextSample;
    },
    recordSequenceSnapshot(snapshot) {
      if (!state.enabled) {
        return null;
      }

      const nextSnapshot = createSequenceSnapshot({
        eventId: snapshot.eventId,
        roomId: snapshot.roomId ?? state.session.roomId,
        clientId: snapshot.clientId ?? state.session.clientId,
        clientType: snapshot.clientType ?? state.session.clientType,
        recordedAtMs: snapshot.recordedAtMs,
        sequenceNumber: snapshot.sequenceNumber,
        previousSequenceNumber: state.lastSequenceNumber,
        roomVersion: snapshot.roomVersion,
        stateVersion: snapshot.stateVersion,
        previousStateVersion: state.lastStateVersion,
        sourceClientEventId: snapshot.sourceClientEventId,
        notes: snapshot.notes,
      });

      state = {
        ...state,
        sequenceSnapshots: appendToBoundedList(
          state.sequenceSnapshots,
          nextSnapshot,
          remoteDiagnosticsBufferLimits.sequences,
        ),
        lastSequenceNumber:
          snapshot.sequenceNumber ?? state.lastSequenceNumber,
        lastStateVersion: snapshot.stateVersion ?? state.lastStateVersion,
      };
      notify();
      return nextSnapshot;
    },
    clear() {
      state = {
        ...createInitialRemoteDiagnosticsState(),
        enabled: state.enabled,
        session: {
          ...createInitialSession(),
          roomId: state.session.roomId,
          clientId: state.session.clientId,
          clientType: state.session.clientType,
          activation: state.session.activation,
        },
      };
      notify();
    },
  };

  return store;
}

function getStoreHost() {
  return globalThis as typeof globalThis & {
    [remoteDiagnosticsStoreKey]?: RemoteDiagnosticsStore;
  };
}

function getRemoteDiagnosticsStore() {
  const storeHost = getStoreHost();
  storeHost[remoteDiagnosticsStoreKey] ??= createRemoteDiagnosticsStore();
  return storeHost[remoteDiagnosticsStoreKey]!;
}

export function subscribeToRemoteDiagnosticsStore(listener: () => void) {
  return getRemoteDiagnosticsStore().subscribe(listener);
}

export function getRemoteDiagnosticsStoreSnapshot() {
  return getRemoteDiagnosticsStore().getState();
}

export function setRemoteDiagnosticsEnabled(
  enabled: boolean,
  activation: RemoteDiagnosticsActivation,
) {
  getRemoteDiagnosticsStore().setEnabled(enabled, activation);
}

export function configureRemoteDiagnosticsSession(
  input: Partial<Omit<RemoteDiagnosticsSession, "activation">>,
) {
  getRemoteDiagnosticsStore().configureSession(input);
}

export function logRemoteDiagnosticsEvent(
  event: Parameters<RemoteDiagnosticsStore["logEvent"]>[0],
) {
  return getRemoteDiagnosticsStore().logEvent(event);
}

export function recordRemoteDiagnosticsDriftSnapshot(
  snapshot: Parameters<RemoteDiagnosticsStore["recordDriftSnapshot"]>[0],
) {
  return getRemoteDiagnosticsStore().recordDriftSnapshot(snapshot);
}

export function recordRemoteDiagnosticsOverlaySnapshot(
  snapshot: Parameters<RemoteDiagnosticsStore["recordOverlaySnapshot"]>[0],
) {
  return getRemoteDiagnosticsStore().recordOverlaySnapshot(snapshot);
}

export function recordRemoteDiagnosticsPipSnapshot(
  snapshot: Parameters<RemoteDiagnosticsStore["recordPipSnapshot"]>[0],
) {
  return getRemoteDiagnosticsStore().recordPipSnapshot(snapshot);
}

export function recordRemoteDiagnosticsClockSyncSample(
  sample: Parameters<RemoteDiagnosticsStore["recordClockSyncSample"]>[0],
) {
  return getRemoteDiagnosticsStore().recordClockSyncSample(sample);
}

export function recordRemoteDiagnosticsSequenceSnapshot(
  snapshot: Parameters<RemoteDiagnosticsStore["recordSequenceSnapshot"]>[0],
) {
  return getRemoteDiagnosticsStore().recordSequenceSnapshot(snapshot);
}

export function recordRemoteDiagnosticsPlayerSnapshot(
  snapshot: Parameters<RemoteDiagnosticsStore["recordPlayerSnapshot"]>[0],
) {
  return getRemoteDiagnosticsStore().recordPlayerSnapshot(snapshot);
}

export function clearRemoteDiagnosticsStore() {
  getRemoteDiagnosticsStore().clear();
}

export function exportRemoteDiagnosticsSnapshot(legacyDebugSnapshot: unknown) {
  const snapshot = getRemoteDiagnosticsStore().getState();
  const exportPayload: RemoteDiagnosticsExport = {
    exportedAt: new Date().toISOString(),
    session: snapshot.session,
    events: snapshot.events,
    correlatedTimelines: buildRemoteDiagnosticsTimelines(snapshot.events),
    driftSnapshots: snapshot.driftSnapshots,
    sequenceSnapshots: snapshot.sequenceSnapshots,
    overlaySnapshots: snapshot.overlaySnapshots,
    pipSnapshots: snapshot.pipSnapshots,
    clockSyncSamples: snapshot.clockSyncSamples,
    playerSnapshots: snapshot.playerSnapshots,
    legacyDebugSnapshot,
  };

  return exportPayload;
}
