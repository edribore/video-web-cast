import assert from "node:assert/strict";
import {
  appendToBoundedList,
  buildRemoteDiagnosticsTimelines,
  calculateClockSyncSample,
  calculateDriftMilliseconds,
  createClockSyncSample,
  createSequenceSnapshot,
  evaluateSequenceProgress,
  normalizeRoomPlaybackKeyboardAction,
} from "../lib/remote-diagnostics";
import type { RemoteDiagnosticsEvent } from "../types/remote-diagnostics";

function createEvent(
  input: Partial<RemoteDiagnosticsEvent> &
    Pick<RemoteDiagnosticsEvent, "eventId" | "stage">,
): RemoteDiagnosticsEvent {
  return {
    eventId: input.eventId,
    parentEventId: input.parentEventId ?? null,
    roomId: input.roomId ?? "room-1",
    clientId: input.clientId ?? "client-1",
    clientType: input.clientType ?? "web",
    source: input.source ?? "keyboard",
    action: input.action ?? "play_pause",
    rawInput: input.rawInput ?? null,
    wallClockTs: input.wallClockTs ?? 0,
    monotonicTs: input.monotonicTs ?? null,
    estimatedServerOffsetMs: input.estimatedServerOffsetMs ?? null,
    estimatedServerTimeMs: input.estimatedServerTimeMs ?? null,
    stage: input.stage,
    sequenceNumber: input.sequenceNumber ?? null,
    roomVersion: input.roomVersion ?? null,
    stateVersion: input.stateVersion ?? null,
    playbackStateVersion: input.playbackStateVersion ?? null,
    currentTimeSec: input.currentTimeSec ?? null,
    durationSec: input.durationSec ?? null,
    paused: input.paused ?? null,
    playbackRate: input.playbackRate ?? null,
    buffering: input.buffering ?? null,
    seeking: input.seeking ?? null,
    module: input.module ?? null,
    functionName: input.functionName ?? null,
    notes: input.notes ?? null,
    reason: input.reason ?? null,
    status: input.status ?? null,
    actorSessionId: input.actorSessionId ?? null,
    transportDirection: input.transportDirection ?? null,
    extra: input.extra ?? null,
  };
}

const tests: Array<{ name: string; run(): void }> = [
  {
    name: "normalizeRoomPlaybackKeyboardAction maps supported shortcuts",
    run() {
      assert.equal(normalizeRoomPlaybackKeyboardAction(" "), "play_pause");
      assert.equal(
        normalizeRoomPlaybackKeyboardAction("ArrowLeft"),
        "seek_backward",
      );
      assert.equal(
        normalizeRoomPlaybackKeyboardAction("ArrowRight"),
        "seek_forward",
      );
      assert.equal(normalizeRoomPlaybackKeyboardAction("Escape"), "back");
      assert.equal(normalizeRoomPlaybackKeyboardAction("x"), null);
    },
  },
  {
    name: "appendToBoundedList keeps only the newest items",
    run() {
      assert.deepEqual(appendToBoundedList([1, 2, 3], 4, 3), [2, 3, 4]);
      assert.deepEqual(appendToBoundedList([], 1, 1), [1]);
    },
  },
  {
    name: "calculateClockSyncSample derives offset and one-way latency",
    run() {
      const sample = calculateClockSyncSample({
        clientSentAtMs: 1_000,
        clientReceivedAtMs: 1_120,
        serverReceivedAtMs: 1_050,
        serverSentAtMs: 1_070,
      });

      assert.equal(sample.roundTripMs, 120);
      assert.equal(sample.estimatedOffsetMs, 0);
      assert.equal(sample.estimatedOneWayLatencyMs, 60);
      assert.equal(sample.estimatedServerTimeMs, 1_120);
    },
  },
  {
    name: "calculateDriftMilliseconds returns signed drift",
    run() {
      assert.equal(calculateDriftMilliseconds(12.5, 10), 2500);
      assert.equal(calculateDriftMilliseconds(10, 12.5), -2500);
      assert.equal(calculateDriftMilliseconds(null, 12.5), null);
    },
  },
  {
    name: "evaluateSequenceProgress detects duplicates, gaps, out-of-order and stale state",
    run() {
      assert.deepEqual(
        evaluateSequenceProgress({
          nextSequenceNumber: 8,
          previousSequenceNumber: 7,
          nextStateVersion: 8,
          previousStateVersion: 7,
        }),
        { relation: "in_order", gapSize: null },
      );
      assert.deepEqual(
        evaluateSequenceProgress({
          nextSequenceNumber: 7,
          previousSequenceNumber: 7,
          nextStateVersion: 7,
          previousStateVersion: 7,
        }),
        { relation: "duplicate", gapSize: null },
      );
      assert.deepEqual(
        evaluateSequenceProgress({
          nextSequenceNumber: 10,
          previousSequenceNumber: 7,
          nextStateVersion: 10,
          previousStateVersion: 7,
        }),
        { relation: "gap", gapSize: 2 },
      );
      assert.deepEqual(
        evaluateSequenceProgress({
          nextSequenceNumber: 6,
          previousSequenceNumber: 7,
          nextStateVersion: 6,
          previousStateVersion: 7,
        }),
        { relation: "out_of_order", gapSize: null },
      );
      assert.deepEqual(
        evaluateSequenceProgress({
          nextSequenceNumber: 8,
          previousSequenceNumber: 7,
          nextStateVersion: 6,
          previousStateVersion: 7,
        }),
        { relation: "stale", gapSize: null },
      );
    },
  },
  {
    name: "createSequenceSnapshot preserves causality metadata",
    run() {
      const snapshot = createSequenceSnapshot({
        eventId: "evt-1",
        roomId: "room-1",
        clientId: "client-1",
        clientType: "web",
        recordedAtMs: 2_000,
        sequenceNumber: 12,
        previousSequenceNumber: 10,
        roomVersion: 12,
        stateVersion: 12,
        previousStateVersion: 10,
        sourceClientEventId: "source-1",
        notes: "gap detected",
      });

      assert.equal(snapshot.relation, "gap");
      assert.equal(snapshot.gapSize, 1);
      assert.equal(snapshot.sourceClientEventId, "source-1");
    },
  },
  {
    name: "buildRemoteDiagnosticsTimelines correlates a lifecycle under one event id",
    run() {
      const events = [
        createEvent({
          eventId: "evt-1",
          stage: "captured",
          wallClockTs: 1_000,
          action: "play",
          source: "keyboard",
        }),
        createEvent({
          eventId: "evt-1",
          stage: "sent",
          wallClockTs: 1_040,
          action: "play",
          source: "keyboard",
        }),
        createEvent({
          eventId: "evt-1",
          stage: "rendered",
          wallClockTs: 1_140,
          action: "play",
          source: "transport",
        }),
        createEvent({
          eventId: "evt-2",
          stage: "captured",
          wallClockTs: 900,
          action: "pause",
          source: "ui-button",
        }),
      ];

      const timelines = buildRemoteDiagnosticsTimelines(events);
      const target = timelines.find((timeline) => timeline.eventId === "evt-1");

      assert.ok(target);
      assert.equal(target?.events.length, 3);
      assert.equal(target?.stageTimes.captured, 1_000);
      assert.equal(target?.stageTimes.sent, 1_040);
      assert.equal(target?.stageTimes.rendered, 1_140);
      assert.equal(target?.totalDurationMs, 140);
    },
  },
  {
    name: "createClockSyncSample wraps calculated fields into an exportable record",
    run() {
      const sample = createClockSyncSample({
        id: "clock-1",
        sampleId: "sample-1",
        roomId: "room-1",
        clientId: "client-1",
        clientType: "web",
        recordedAtMs: 5_000,
        clientSentAtMs: 4_000,
        clientReceivedAtMs: 4_120,
        serverReceivedAtMs: 4_055,
        serverSentAtMs: 4_070,
      });

      assert.equal(sample.id, "clock-1");
      assert.equal(sample.roundTripMs, 120);
      assert.equal(sample.estimatedOneWayLatencyMs, 60);
    },
  },
];

let failures = 0;

for (const testCase of tests) {
  try {
    testCase.run();
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS ${tests.length} diagnostics tests`);
}
