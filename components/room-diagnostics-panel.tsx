"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  buildRemoteDiagnosticsTimelines,
  findLatestCompleteTimeline,
} from "@/lib/remote-diagnostics";
import {
  clearRemoteDiagnosticsStore,
  exportRemoteDiagnosticsSnapshot,
  getRemoteDiagnosticsStoreSnapshot,
  subscribeToRemoteDiagnosticsStore,
} from "@/lib/remote-diagnostics-store";
import { getDebugStoreSnapshot } from "@/lib/debug-store";
import type {
  RemoteDiagnosticsEvent,
  RemoteDiagnosticsTimeline,
} from "@/types/remote-diagnostics";

type RoomDiagnosticsPanelProps = {
  roomId: string;
};

function shortId(value: string | null | undefined) {
  if (!value) {
    return "n/a";
  }

  return value.length <= 12 ? value : value.slice(0, 12);
}

function formatClock(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return new Date(value).toLocaleTimeString([], {
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function formatMetric(value: number | null | undefined, suffix = "ms") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${Math.round(value)}${suffix}`;
}

function formatSeconds(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return value.toFixed(3);
}

function formatSequence(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return String(value);
}

function stageDelta(
  timeline: RemoteDiagnosticsTimeline | null,
  start: keyof RemoteDiagnosticsTimeline["stageTimes"],
  end: keyof RemoteDiagnosticsTimeline["stageTimes"],
) {
  if (!timeline) {
    return null;
  }

  const startAt = timeline.stageTimes[start];
  const endAt = timeline.stageTimes[end];

  if (startAt == null || endAt == null) {
    return null;
  }

  return Math.round(endAt - startAt);
}

function buildLagRows(timeline: RemoteDiagnosticsTimeline | null) {
  return [
    { label: "capture -> normalize", value: stageDelta(timeline, "captured", "normalized") },
    { label: "normalize -> send", value: stageDelta(timeline, "normalized", "sent") },
    { label: "send -> server", value: stageDelta(timeline, "sent", "server_received") },
    { label: "server -> broadcast", value: stageDelta(timeline, "server_received", "broadcast") },
    { label: "broadcast -> receive", value: stageDelta(timeline, "broadcast", "received") },
    { label: "receive -> apply", value: stageDelta(timeline, "received", "applied") },
    { label: "apply -> render", value: stageDelta(timeline, "applied", "rendered") },
    { label: "total", value: timeline?.totalDurationMs ?? null },
  ];
}

function downloadDiagnosticsPayload(roomId: string) {
  const payload = exportRemoteDiagnosticsSnapshot(getDebugStoreSnapshot());
  const fileName = `remote-diagnostics-${roomId}-${new Date()
    .toISOString()
    .replaceAll(":", "-")}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resolveEventSearchText(event: RemoteDiagnosticsEvent) {
  return [
    event.eventId,
    event.parentEventId,
    event.clientType,
    event.source,
    event.action,
    event.stage,
    event.rawInput?.key,
    event.rawInput?.code,
    event.rawInput?.eventType,
    event.module,
    event.functionName,
    event.notes,
    event.reason,
    event.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function RoomDiagnosticsPanel({ roomId }: RoomDiagnosticsPanelProps) {
  const diagnostics = useSyncExternalStore(
    subscribeToRemoteDiagnosticsStore,
    getRemoteDiagnosticsStoreSnapshot,
    getRemoteDiagnosticsStoreSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const enabled =
    diagnostics.enabled &&
    diagnostics.session.activation.enabled &&
    diagnostics.session.roomId === roomId;

  const timelines = useMemo(
    () => buildRemoteDiagnosticsTimelines(diagnostics.events),
    [diagnostics.events],
  );
  const latestTimeline = useMemo(
    () => findLatestCompleteTimeline(timelines),
    [timelines],
  );
  const latestDrift = diagnostics.driftSnapshots.at(-1) ?? null;
  const latestOverlay = diagnostics.overlaySnapshots.at(-1) ?? null;
  const latestPip = diagnostics.pipSnapshots.at(-1) ?? null;
  const latestClock = diagnostics.clockSyncSamples.at(-1) ?? null;
  const latestSequence = diagnostics.sequenceSnapshots.at(-1) ?? null;
  const latestCastSnapshot =
    [...diagnostics.playerSnapshots]
      .reverse()
      .find((snapshot) => snapshot.playerKind === "chromecast-remote") ?? null;
  const latestWebSnapshot =
    [...diagnostics.playerSnapshots]
      .reverse()
      .find((snapshot) => snapshot.playerKind === "local-web") ?? null;

  const filteredEvents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...diagnostics.events]
      .reverse()
      .filter((event) => {
        if (stageFilter !== "all" && event.stage !== stageFilter) {
          return false;
        }

        if (clientFilter !== "all" && event.clientType !== clientFilter) {
          return false;
        }

        if (actionFilter !== "all" && event.action !== actionFilter) {
          return false;
        }

        if (
          normalizedSearch &&
          !resolveEventSearchText(event).includes(normalizedSearch)
        ) {
          return false;
        }

        return true;
      })
      .slice(0, 80);
  }, [actionFilter, clientFilter, diagnostics.events, search, stageFilter]);

  const effectiveSelectedEventId =
    selectedEventId &&
    diagnostics.events.some((event) => event.eventId === selectedEventId)
      ? selectedEventId
      : (latestTimeline?.eventId ?? diagnostics.events.at(-1)?.eventId ?? null);

  const selectedTimeline =
    timelines.find((timeline) => timeline.eventId === effectiveSelectedEventId) ??
    latestTimeline;
  const selectedEvents = useMemo(() => {
    if (!selectedTimeline) {
      return [] as RemoteDiagnosticsEvent[];
    }

    const selectedIds = new Set<string>();
    selectedIds.add(selectedTimeline.eventId);

    if (selectedTimeline.parentEventId) {
      selectedIds.add(selectedTimeline.parentEventId);
    }

    return diagnostics.events
      .filter(
        (event) =>
          selectedIds.has(event.eventId) ||
          event.parentEventId === selectedTimeline.eventId ||
          (selectedTimeline.parentEventId != null &&
            event.parentEventId === selectedTimeline.parentEventId),
      )
      .sort((left, right) => left.wallClockTs - right.wallClockTs);
  }, [diagnostics.events, selectedTimeline]);

  if (!enabled) {
    return null;
  }

  const lagRows = buildLagRows(selectedTimeline);
  const uniqueStages = [
    "all",
    ...new Set(diagnostics.events.map((event) => event.stage)),
  ];
  const uniqueClients = [
    "all",
    ...new Set(diagnostics.events.map((event) => event.clientType)),
  ];
  const uniqueActions = [
    "all",
    ...new Set(diagnostics.events.map((event) => event.action)),
  ];

  return (
    <div className="fixed bottom-4 right-4 z-[80]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mb-3 rounded-full border border-[#7bb7ff]/35 bg-[#08111d]/92 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#d8e8ff] shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      >
        {open ? "Hide Sync Diagnostics" : "Show Sync Diagnostics"}
      </button>
      {open ? (
        <div
          data-debug-room-diagnostics="true"
          className="h-[min(78vh,58rem)] w-[min(92vw,70rem)] overflow-hidden rounded-[1.6rem] border border-[#7bb7ff]/18 bg-[#09111a]/96 text-[#d7dfeb] shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8fb4e4]">
                Remote Sync Diagnostics
              </p>
              <p className="mt-1 text-sm text-white/75">
                Room `{roomId}` · session `{shortId(diagnostics.session.clientId)}`
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => clearRemoteDiagnosticsStore()}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/75"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => downloadDiagnosticsPayload(roomId)}
                className="rounded-full border border-[#7bb7ff]/28 bg-[#103258] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#e9f3ff]"
              >
                Export JSON
              </button>
            </div>
          </div>

          <div className="grid h-[calc(100%-4.5rem)] grid-cols-[1.1fr_0.9fr]">
            <div className="flex min-h-0 flex-col border-r border-white/10">
              <div className="grid gap-3 border-b border-white/10 px-5 py-4 md:grid-cols-4">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search eventId, key, module, reason"
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 md:col-span-4"
                />
                <select
                  value={stageFilter}
                  onChange={(event) => setStageFilter(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                >
                  {uniqueStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
                <select
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                >
                  {uniqueClients.map((client) => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                </select>
                <select
                  value={actionFilter}
                  onChange={(event) => setActionFilter(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                >
                  {uniqueActions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/55">
                  {filteredEvents.length} visible / {diagnostics.events.length} total
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <div className="space-y-2">
                  {filteredEvents.map((event) => {
                    const selected = event.eventId === selectedTimeline?.eventId;
                    return (
                      <button
                        key={`${event.eventId}:${event.stage}:${event.wallClockTs}`}
                        type="button"
                        onClick={() => setSelectedEventId(event.eventId)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                          selected
                            ? "border-[#7bb7ff]/55 bg-[#102235]"
                            : "border-white/8 bg-black/18 hover:border-white/16 hover:bg-black/24"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-white/55">
                          <span>{formatClock(event.wallClockTs)}</span>
                          <span>{event.clientType}</span>
                          <span>{shortId(event.eventId)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white">
                          <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-[#b9d5ff]">
                            {event.source}
                          </span>
                          <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-[#ffd7a8]">
                            {event.action}
                          </span>
                          <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-white/70">
                            {event.stage}
                          </span>
                          <span className="text-white/70">
                            {event.rawInput?.key ?? event.rawInput?.code ?? event.rawInput?.eventType ?? "--"}
                          </span>
                        </div>
                        <div className="mt-2 text-xs leading-5 text-white/62">
                          {event.module ?? "--"} / {event.functionName ?? "--"} · status{" "}
                          {event.status ?? "--"} · seq {formatSequence(event.sequenceNumber)}
                        </div>
                        {event.notes ? (
                          <div className="mt-1 text-xs leading-5 text-[#9fb4ca]">
                            {event.notes}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <section className="rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Selected Timeline
                </p>
                <p className="mt-2 text-sm text-white">
                  {selectedTimeline
                    ? `${selectedTimeline.action} via ${selectedTimeline.source} (${shortId(
                        selectedTimeline.eventId,
                      )})`
                    : "No correlated event selected yet."}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-white/68">
                  {lagRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <span>{row.label}</span>
                      <span className="font-mono text-white">{formatMetric(row.value)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
                  {selectedEvents.map((event) => (
                    <div
                      key={`${event.eventId}:${event.stage}:${event.wallClockTs}:detail`}
                      className="flex items-center justify-between gap-3 text-xs text-white/68"
                    >
                      <span className="font-mono text-[#b9d5ff]">{event.stage}</span>
                      <span>{formatClock(event.wallClockTs)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Sync Drift
                </p>
                <div className="mt-3 grid gap-2 text-xs text-white/68">
                  <div className="flex items-center justify-between gap-3">
                    <span>Authoritative room</span>
                    <span className="font-mono text-white">
                      {formatSeconds(latestDrift?.authoritativeRoomTimeSec)}s
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Chromecast actual</span>
                    <span className="font-mono text-white">
                      {formatSeconds(latestDrift?.chromecastTimeSec)}s / {formatMetric(latestDrift?.chromecastMinusRoomMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Web actual</span>
                    <span className="font-mono text-white">
                      {formatSeconds(latestDrift?.webClientTimeSec)}s / {formatMetric(latestDrift?.webMinusRoomMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>PiP actual</span>
                    <span className="font-mono text-white">
                      {formatSeconds(latestDrift?.pipTimeSec)}s / {formatMetric(latestDrift?.pipMinusRoomMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Chromecast vs web</span>
                    <span className="font-mono text-white">
                      {formatMetric(latestDrift?.chromecastMinusWebMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Statuses</span>
                    <span className="text-right text-white">
                      room {latestDrift?.authoritativeStatus ?? "--"} / cast{" "}
                      {latestDrift?.chromecastStatus ?? "--"} / web{" "}
                      {latestDrift?.webStatus ?? "--"} / pip {latestDrift?.pipStatus ?? "--"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Sequence</span>
                    <span className="text-right text-white">
                      last seq {formatSequence(latestDrift?.lastSequenceNumber)} · state{" "}
                      {formatSequence(latestDrift?.lastAppliedStateVersion)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Ordering warnings</span>
                    <span className="text-right text-white">
                      stale {latestDrift?.staleWarning ? "yes" : "no"} · out-of-order{" "}
                      {latestDrift?.outOfOrderWarning ? "yes" : "no"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Overlay And PiP
                </p>
                <div className="mt-3 space-y-3 text-xs text-white/68">
                  <div>
                    <p className="font-semibold uppercase tracking-[0.18em] text-white/55">
                      Overlay lifecycle
                    </p>
                    <p className="mt-1">
                      {latestOverlay
                        ? `${latestOverlay.visibility} · ${latestOverlay.eventType} · keep-alive ${latestOverlay.lastKeepAliveAction ?? "--"}`
                        : "No overlay events yet."}
                    </p>
                    {latestOverlay ? (
                      <p className="mt-1 font-mono text-white">
                        hide {latestOverlay.hideTimerState} ({formatMetric(latestOverlay.hideTimerDurationMs)}) · fade{" "}
                        {latestOverlay.fadeTimerState} ({formatMetric(latestOverlay.fadeTimerDurationMs)})
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="font-semibold uppercase tracking-[0.18em] text-white/55">
                      PiP divergence
                    </p>
                    <p className="mt-1">
                      {latestPip
                        ? `${latestPip.active ? "active" : "inactive"} · ${latestPip.mode} · following canonical ${
                            latestPip.followingCanonicalState == null
                              ? "--"
                              : latestPip.followingCanonicalState
                                ? "yes"
                                : "no"
                          }`
                        : "No PiP snapshots yet."}
                    </p>
                    {latestPip ? (
                      <p className="mt-1 font-mono text-white">
                        pip {formatSeconds(latestPip.pipCurrentTimeSec)}s / main{" "}
                        {formatSeconds(latestPip.mainPlayerCurrentTimeSec)}s / room{" "}
                        {formatSeconds(latestPip.authoritativeRoomTimeSec)}s
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Clock And Ordering
                </p>
                <div className="mt-3 grid gap-2 text-xs text-white/68">
                  <div className="flex items-center justify-between gap-3">
                    <span>Clock offset</span>
                    <span className="font-mono text-white">
                      {formatMetric(latestClock?.estimatedOffsetMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>RTT / one-way</span>
                    <span className="font-mono text-white">
                      {formatMetric(latestClock?.roundTripMs)} /{" "}
                      {formatMetric(latestClock?.estimatedOneWayLatencyMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Sequence relation</span>
                    <span className="text-right text-white">
                      {latestSequence?.relation ?? "--"}
                      {latestSequence?.gapSize != null
                        ? ` (gap ${latestSequence.gapSize})`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Source client event</span>
                    <span className="font-mono text-white">
                      {shortId(latestSequence?.sourceClientEventId)}
                    </span>
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Player Snapshots
                </p>
                <div className="mt-3 space-y-2 text-xs text-white/68">
                  <div className="flex items-center justify-between gap-3">
                    <span>Chromecast player</span>
                    <span className="text-right text-white">
                      {latestCastSnapshot
                        ? `${formatSeconds(latestCastSnapshot.currentTimeSec)}s · ${
                            latestCastSnapshot.status ?? "--"
                          }`
                        : "--"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Web player</span>
                    <span className="text-right text-white">
                      {latestWebSnapshot
                        ? `${formatSeconds(latestWebSnapshot.currentTimeSec)}s · ${
                            latestWebSnapshot.status ?? "--"
                          }`
                        : "--"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb4e4]">
                  Event Detail
                </p>
                <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-[#060c14] p-3 text-[11px] leading-5 text-[#c6d3e2]">
                  {JSON.stringify(
                    {
                      timeline: selectedTimeline,
                      events: selectedEvents,
                    },
                    null,
                    2,
                  )}
                </pre>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
