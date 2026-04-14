import test from "node:test";
import assert from "node:assert/strict";
import {
  assessCastRemoteObservationPlausibility,
  assessPlaybackProgressStall,
  buildAuthoritativePlaybackState,
  estimateCastObservationDelayMs,
  isPlaybackActivelyRunning,
  playbackSynchronizationConfig,
  resolvePlaybackReconciliationProfileKey,
  resolvePlaybackDriftCorrection,
  resolvePlaybackStartDelayMs,
  resolveSynchronizedPlaybackTime,
  updatePlaybackSuppressionState,
} from "./playback";

test("pause convergence keeps every client anchored to the paused media time", () => {
  const pausedPlayback = buildAuthoritativePlaybackState({
    clientEventId: "event-pause",
    currentTime: 10,
    nowWallClockMs: 5_000,
    playbackRate: 1,
    status: "paused",
    type: "pause",
    version: 3,
  });

  assert.equal(pausedPlayback.status, "paused");
  assert.equal(pausedPlayback.anchorMediaTime, 10);
  assert.equal(pausedPlayback.scheduledStartWallClockMs, null);
  assert.equal(resolveSynchronizedPlaybackTime(pausedPlayback, 9_000), 10);
});

test("scheduled play alignment holds all clients at the anchor until the shared start time", () => {
  const playingPlayback = buildAuthoritativePlaybackState({
    clientEventId: "event-play",
    currentTime: 10,
    nowWallClockMs: 5_000,
    playbackRate: 1,
    status: "playing",
    type: "play",
    version: 4,
  });

  assert.equal(
    playingPlayback.anchorWallClockMs,
    5_000 + playbackSynchronizationConfig.scheduledStartLeadTimeMs,
  );
  assert.equal(resolvePlaybackStartDelayMs(playingPlayback, 5_200), 800);
  assert.equal(resolveSynchronizedPlaybackTime(playingPlayback, 5_800), 10);
  assert.equal(isPlaybackActivelyRunning(playingPlayback, 6_000), true);
  assert.equal(resolveSynchronizedPlaybackTime(playingPlayback, 6_250), 10.25);
});

test("join while paused resolves immediately to the authoritative paused anchor", () => {
  const pausedPlayback = buildAuthoritativePlaybackState({
    clientEventId: "join-paused",
    currentTime: 42.125,
    nowWallClockMs: 11_000,
    playbackRate: 1,
    status: "paused",
    type: "seek",
    version: 8,
  });

  assert.equal(resolveSynchronizedPlaybackTime(pausedPlayback, 25_000), 42.125);
});

test("join while playing resolves against the authoritative wall clock anchor", () => {
  const playingPlayback = buildAuthoritativePlaybackState({
    clientEventId: "join-playing",
    currentTime: 42.125,
    nowWallClockMs: 11_000,
    playbackRate: 1,
    status: "playing",
    type: "seek",
    version: 9,
  });
  const joinWallClockMs =
    playingPlayback.anchorWallClockMs + 2_500;

  assert.equal(resolveSynchronizedPlaybackTime(playingPlayback, joinWallClockMs), 44.625);
});

test("moderate drift uses smooth rate correction instead of a hard seek", () => {
  const correction = resolvePlaybackDriftCorrection({
    actualTime: 9.85,
    basePlaybackRate: 1,
    expectedTime: 10,
  });

  assert.equal(correction.kind, "smooth");
  assert.equal(correction.targetPlaybackRate, 1.03);
  assert.equal(correction.targetTime, null);
});

test("large drift uses a hard seek back to the authoritative room time", () => {
  const correction = resolvePlaybackDriftCorrection({
    actualTime: 9,
    basePlaybackRate: 1,
    expectedTime: 10,
  });

  assert.equal(correction.kind, "hard_seek");
  assert.equal(correction.targetPlaybackRate, 1);
  assert.equal(correction.targetTime, 10);
});

test("hard seek cooldown forces large drift back into smooth correction temporarily", () => {
  const correction = resolvePlaybackDriftCorrection({
    actualTime: 9,
    basePlaybackRate: 1,
    expectedTime: 10,
    lastHardSeekAtMs: 10_000,
    nowMs: 11_000,
  });

  assert.equal(correction.kind, "smooth");
  assert.equal(correction.targetPlaybackRate, 1.03);
});

test("post-seek suppression window blocks repeated hard seeks during media recovery", () => {
  const correction = resolvePlaybackDriftCorrection({
    actualTime: 9,
    basePlaybackRate: 1,
    expectedTime: 10,
    nowMs: 10_500,
    suppressHardSeekUntilMs: 12_000,
  });

  assert.equal(correction.kind, "smooth");
  assert.equal(correction.targetTime, null);
});

test("cast-driven mobile followers with external audio use the most tolerant reconciliation profile", () => {
  const profileKey = resolvePlaybackReconciliationProfileKey({
    hasExternalAudio: true,
    isMobile: true,
    leadershipMode: "cast_driven_local_follower",
  });

  assert.equal(profileKey, "mobile_external_audio_follower");
});

test("equivalent suppression renewals are ignored inside the renewal cooldown", () => {
  const initialSuppression = updatePlaybackSuppressionState({
    cause: "media_recovery",
    durationMs: 2000,
    nowMs: 10_000,
    previous: null,
    targetTime: 15,
  });
  const repeatedSuppression = updatePlaybackSuppressionState({
    cause: "media_recovery",
    durationMs: 2000,
    nowMs: 10_400,
    previous: initialSuppression.nextState,
    targetTime: 15.02,
  });

  assert.equal(initialSuppression.action, "started");
  assert.equal(repeatedSuppression.action, "ignored_equivalent");
});

test("stalled playback detection trips when time barely advances over the stall window", () => {
  const firstSample = assessPlaybackProgressStall({
    currentTime: 20,
    nowMs: 5_000,
    previousSample: null,
  });
  const secondSample = assessPlaybackProgressStall({
    currentTime: 20.05,
    nowMs:
      5_000 + playbackSynchronizationConfig.stalledProgressWindowMs + 100,
    previousSample: firstSample.nextSample,
  });

  assert.equal(firstSample.assessment.isStalled, false);
  assert.equal(secondSample.assessment.isStalled, true);
});

test("cast observation delay estimates are smoothed and clamped", () => {
  assert.equal(
    estimateCastObservationDelayMs(null, 50),
    playbackSynchronizationConfig.castRemoteObservation.minimumDelayMs,
  );
  assert.equal(
    estimateCastObservationDelayMs(700, 1100),
    Math.round(700 * 0.75 + 1100 * 0.25),
  );
});

test("cast remote plausibility rejects absurd regressions to startup time", () => {
  const plausibility = assessCastRemoteObservationPlausibility({
    commandType: "seek",
    expectedTime: 365,
    observedTime: 0.7,
  });

  assert.equal(plausibility.plausible, false);
});
