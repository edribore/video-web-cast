import type {
  RemoteDiagnosticsActivation,
  RemoteDiagnosticsAction,
  RemoteDiagnosticsClientType,
  RemoteDiagnosticsClockSyncSample,
  RemoteDiagnosticsEvent,
  RemoteDiagnosticsLifecycleStage,
  RemoteDiagnosticsRawInput,
  RemoteDiagnosticsSequenceRelation,
  RemoteDiagnosticsSequenceSnapshot,
  RemoteDiagnosticsTimeline,
} from "../types/remote-diagnostics";

export const remoteDiagnosticsStorageKey = "syncpass.remote-diagnostics";

export const remoteDiagnosticsBufferLimits = {
  events: 600,
  drifts: 240,
  overlays: 240,
  pips: 180,
  clockSyncSamples: 80,
  sequences: 240,
  players: 240,
} as const;

function normalizeFlagValue(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  if (
    normalizedValue === "1" ||
    normalizedValue === "true" ||
    normalizedValue === "yes" ||
    normalizedValue === "on"
  ) {
    return true;
  }

  if (
    normalizedValue === "0" ||
    normalizedValue === "false" ||
    normalizedValue === "no" ||
    normalizedValue === "off"
  ) {
    return false;
  }

  return null;
}

export function appendToBoundedList<T>(
  list: readonly T[],
  item: T,
  limit: number,
) {
  if (limit <= 1) {
    return [item];
  }

  if (list.length < limit) {
    return [...list, item];
  }

  return [...list.slice(-(limit - 1)), item];
}

export function resolveRemoteDiagnosticsActivation(input: {
  search: string;
  storedValue?: string | null;
}) {
  const searchParams = new URLSearchParams(input.search);
  const debugRemoteFlag = normalizeFlagValue(searchParams.get("debugRemote"));
  const debugSyncFlag = normalizeFlagValue(searchParams.get("debugSync"));
  const debugDiagnosticsFlag = normalizeFlagValue(
    searchParams.get("debugDiagnostics"),
  );
  const storedFlag = normalizeFlagValue(input.storedValue);
  const queryEnabled =
    debugDiagnosticsFlag === true ||
    debugRemoteFlag === true ||
    debugSyncFlag === true;
  const queryDisabled =
    debugDiagnosticsFlag === false ||
    (debugRemoteFlag === false && debugSyncFlag === false);
  const enabled = queryDisabled ? false : queryEnabled || storedFlag === true;
  const activation: RemoteDiagnosticsActivation = {
    enabled,
    debugRemote:
      enabled &&
      (debugDiagnosticsFlag === true ||
        debugRemoteFlag === true ||
        storedFlag === true),
    debugSync:
      enabled &&
      (debugDiagnosticsFlag === true ||
        debugSyncFlag === true ||
        storedFlag === true),
    persisted: storedFlag === true,
    sources: [],
  };

  if (debugDiagnosticsFlag != null || debugRemoteFlag != null || debugSyncFlag != null) {
    activation.sources.push("query");
  }

  if (storedFlag != null) {
    activation.sources.push("storage");
  }

  return activation;
}

export function buildRemoteDiagnosticsStorageValue(enabled: boolean) {
  return enabled ? "1" : "0";
}

export function getMonotonicTimestamp() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : null;
}

function describeEventTarget(target: EventTarget | null | undefined) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return {
      target: null,
      targetTag: null,
      targetRole: null,
    };
  }

  return {
    target:
      target.id ||
      target.getAttribute("aria-label") ||
      target.getAttribute("data-debug-id") ||
      target.className ||
      target.tagName.toLowerCase(),
    targetTag: target.tagName.toLowerCase(),
    targetRole: target.getAttribute("role"),
  };
}

export function createEmptyRawInput(): RemoteDiagnosticsRawInput {
  return {
    key: null,
    code: null,
    keyCode: null,
    which: null,
    repeat: null,
    eventType: null,
    defaultPrevented: null,
    target: null,
    targetTag: null,
    targetRole: null,
    button: null,
    pointerType: null,
    detail: null,
    playerState: null,
  };
}

export function buildRawInputFromKeyboardEvent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "keyCode"
    | "which"
    | "repeat"
    | "type"
    | "defaultPrevented"
    | "target"
  >,
) {
  return {
    ...createEmptyRawInput(),
    key: event.key ?? null,
    code: event.code ?? null,
    keyCode: typeof event.keyCode === "number" ? event.keyCode : null,
    which: typeof event.which === "number" ? event.which : null,
    repeat: Boolean(event.repeat),
    eventType: event.type ?? null,
    defaultPrevented: Boolean(event.defaultPrevented),
    ...describeEventTarget(event.target),
  } satisfies RemoteDiagnosticsRawInput;
}

export function buildRawInputFromPointerEvent(
  event: Pick<
    MouseEvent,
    "button" | "detail" | "type" | "defaultPrevented" | "target"
  > & {
    pointerType?: string;
  },
) {
  return {
    ...createEmptyRawInput(),
    button: typeof event.button === "number" ? event.button : null,
    detail:
      typeof event.detail === "number" ? String(event.detail) : event.detail ?? null,
    eventType: event.type ?? null,
    defaultPrevented: Boolean(event.defaultPrevented),
    pointerType: event.pointerType ?? null,
    ...describeEventTarget(event.target),
  } satisfies RemoteDiagnosticsRawInput;
}

export function buildRawInputFromCastObservation(input: {
  eventType: string;
  playerState: string | null;
  currentTime: number;
  isPaused: boolean | null;
}) {
  return {
    ...createEmptyRawInput(),
    eventType: input.eventType,
    playerState: input.playerState,
    detail: JSON.stringify({
      currentTime: input.currentTime,
      isPaused: input.isPaused,
    }),
  } satisfies RemoteDiagnosticsRawInput;
}

export function normalizeRoomPlaybackKeyboardAction(
  key: string,
): RemoteDiagnosticsAction | null {
  const normalizedKey = key === " " ? " " : key.trim().toLowerCase();

  switch (normalizedKey) {
    case " ":
    case "k":
      return "play_pause";
    case "j":
    case "arrowleft":
      return "seek_backward";
    case "l":
    case "arrowright":
      return "seek_forward";
    case "escape":
      return "back";
    default:
      return null;
  }
}

export function inferClientTypeFromUserAgent(userAgent: string) {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent)
    ? ("mobile-web" as RemoteDiagnosticsClientType)
    : ("web" as RemoteDiagnosticsClientType);
}

export function calculateClockSyncSample(input: {
  clientSentAtMs: number;
  clientReceivedAtMs: number;
  serverReceivedAtMs: number;
  serverSentAtMs: number;
}) {
  const roundTripMs = Math.max(
    0,
    input.clientReceivedAtMs - input.clientSentAtMs,
  );
  const clientMidpointMs = input.clientSentAtMs + roundTripMs / 2;
  const serverMidpointMs =
    input.serverReceivedAtMs +
    Math.max(0, input.serverSentAtMs - input.serverReceivedAtMs) / 2;
  const estimatedOffsetMs = Math.round(serverMidpointMs - clientMidpointMs);

  return {
    roundTripMs,
    estimatedOffsetMs,
    estimatedServerTimeMs: input.clientReceivedAtMs + estimatedOffsetMs,
    estimatedOneWayLatencyMs: Math.round(roundTripMs / 2),
  };
}

export function calculateDriftMilliseconds(
  localTimeSec: number | null,
  canonicalTimeSec: number | null,
) {
  if (
    typeof localTimeSec !== "number" ||
    !Number.isFinite(localTimeSec) ||
    typeof canonicalTimeSec !== "number" ||
    !Number.isFinite(canonicalTimeSec)
  ) {
    return null;
  }

  return Math.round((localTimeSec - canonicalTimeSec) * 1000);
}

export function resolveEventPausedState(status: string | null | undefined) {
  if (status === "playing") {
    return false;
  }

  if (status === "paused" || status === "stopped") {
    return true;
  }

  return null;
}

export function evaluateSequenceProgress(input: {
  nextSequenceNumber: number | null;
  previousSequenceNumber: number | null;
  nextStateVersion?: number | null;
  previousStateVersion?: number | null;
}) {
  let relation: RemoteDiagnosticsSequenceRelation = "initial";
  let gapSize: number | null = null;

  if (input.nextSequenceNumber == null) {
    relation = "stale";
  } else if (input.previousSequenceNumber == null) {
    relation = "initial";
  } else if (input.nextSequenceNumber === input.previousSequenceNumber) {
    relation = "duplicate";
  } else if (input.nextSequenceNumber < input.previousSequenceNumber) {
    relation = "out_of_order";
  } else if (input.nextSequenceNumber > input.previousSequenceNumber + 1) {
    relation = "gap";
    gapSize = input.nextSequenceNumber - input.previousSequenceNumber - 1;
  } else {
    relation = "in_order";
  }

  if (
    relation === "in_order" &&
    typeof input.nextStateVersion === "number" &&
    typeof input.previousStateVersion === "number" &&
    input.nextStateVersion < input.previousStateVersion
  ) {
    relation = "stale";
  }

  return {
    relation,
    gapSize,
  };
}

function compareEventsByTime(left: RemoteDiagnosticsEvent, right: RemoteDiagnosticsEvent) {
  if (left.wallClockTs === right.wallClockTs) {
    return 0;
  }

  return left.wallClockTs < right.wallClockTs ? -1 : 1;
}

export function buildRemoteDiagnosticsTimelines(
  events: readonly RemoteDiagnosticsEvent[],
) {
  const timelineMap = new Map<string, RemoteDiagnosticsTimeline>();

  for (const event of [...events].sort(compareEventsByTime)) {
    const existingTimeline = timelineMap.get(event.eventId);

    if (existingTimeline) {
      existingTimeline.events.push(event);
      existingTimeline.stageTimes[event.stage] ??= event.wallClockTs;
      continue;
    }

    timelineMap.set(event.eventId, {
      eventId: event.eventId,
      parentEventId: event.parentEventId,
      action: event.action,
      source: event.source,
      clientType: event.clientType,
      stageTimes: {
        [event.stage]: event.wallClockTs,
      } satisfies Partial<Record<RemoteDiagnosticsLifecycleStage, number>>,
      events: [event],
      totalDurationMs: null,
    });
  }

  return [...timelineMap.values()]
    .map((timeline) => {
      const capturedAt =
        timeline.stageTimes.captured ??
        timeline.stageTimes.received ??
        timeline.events[0]?.wallClockTs ??
        null;
      const renderedAt =
        timeline.stageTimes.rendered ??
        timeline.stageTimes.applied ??
        timeline.events.at(-1)?.wallClockTs ??
        null;

      return {
        ...timeline,
        totalDurationMs:
          capturedAt != null && renderedAt != null
            ? Math.max(0, Math.round(renderedAt - capturedAt))
            : null,
      };
    })
    .sort((left, right) => {
      const leftTime =
        left.stageTimes.rendered ??
        left.stageTimes.received ??
        left.stageTimes.captured ??
        0;
      const rightTime =
        right.stageTimes.rendered ??
        right.stageTimes.received ??
        right.stageTimes.captured ??
        0;

      return rightTime - leftTime;
    });
}

export function findLatestCompleteTimeline(
  timelines: readonly RemoteDiagnosticsTimeline[],
) {
  return (
    timelines.find(
      (timeline) =>
        timeline.stageTimes.received != null || timeline.stageTimes.sent != null,
    ) ?? null
  );
}

export function createSequenceSnapshot(input: {
  eventId: string | null;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  sequenceNumber: number | null;
  previousSequenceNumber: number | null;
  roomVersion: number | null;
  stateVersion: number | null;
  previousStateVersion: number | null;
  sourceClientEventId: string | null;
  notes?: string | null;
}): RemoteDiagnosticsSequenceSnapshot {
  const progress = evaluateSequenceProgress({
    nextSequenceNumber: input.sequenceNumber,
    previousSequenceNumber: input.previousSequenceNumber,
    nextStateVersion: input.stateVersion,
    previousStateVersion: input.previousStateVersion,
  });

  return {
    id: `${input.eventId ?? "sequence"}:${input.recordedAtMs}`,
    roomId: input.roomId,
    clientId: input.clientId,
    clientType: input.clientType,
    recordedAtMs: input.recordedAtMs,
    eventId: input.eventId,
    sequenceNumber: input.sequenceNumber,
    previousSequenceNumber: input.previousSequenceNumber,
    relation: progress.relation,
    gapSize: progress.gapSize,
    roomVersion: input.roomVersion,
    stateVersion: input.stateVersion,
    previousStateVersion: input.previousStateVersion,
    sourceClientEventId: input.sourceClientEventId,
    notes: input.notes ?? null,
  };
}

export function createClockSyncSample(input: {
  id: string;
  sampleId: string;
  roomId: string | null;
  clientId: string | null;
  clientType: RemoteDiagnosticsClientType;
  recordedAtMs: number;
  clientSentAtMs: number;
  clientReceivedAtMs: number;
  serverReceivedAtMs: number;
  serverSentAtMs: number;
}): RemoteDiagnosticsClockSyncSample {
  const calculated = calculateClockSyncSample({
    clientSentAtMs: input.clientSentAtMs,
    clientReceivedAtMs: input.clientReceivedAtMs,
    serverReceivedAtMs: input.serverReceivedAtMs,
    serverSentAtMs: input.serverSentAtMs,
  });

  return {
    id: input.id,
    sampleId: input.sampleId,
    roomId: input.roomId,
    clientId: input.clientId,
    clientType: input.clientType,
    recordedAtMs: input.recordedAtMs,
    clientSentAtMs: input.clientSentAtMs,
    clientReceivedAtMs: input.clientReceivedAtMs,
    serverReceivedAtMs: input.serverReceivedAtMs,
    serverSentAtMs: input.serverSentAtMs,
    roundTripMs: calculated.roundTripMs,
    estimatedOffsetMs: calculated.estimatedOffsetMs,
    estimatedServerTimeMs: calculated.estimatedServerTimeMs,
    estimatedOneWayLatencyMs: calculated.estimatedOneWayLatencyMs,
  };
}
