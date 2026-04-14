import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthoritativePlaybackState,
  isPlaybackActivelyRunning,
  playbackSynchronizationConfig,
  resolvePlaybackDriftCorrection,
  resolvePlaybackStartDelayMs,
  resolveSynchronizedPlaybackTime,
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
    actualTime: 9.6,
    basePlaybackRate: 1,
    expectedTime: 10,
  });

  assert.equal(correction.kind, "hard_seek");
  assert.equal(correction.targetPlaybackRate, 1);
  assert.equal(correction.targetTime, 10);
});
