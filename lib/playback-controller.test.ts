import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdlePlaybackScrubState,
  createInitialMobileOverlayState,
  previewPlaybackScrub,
  reduceMobileOverlayState,
  resolvePlaybackScrubCommit,
  shouldRenderMiniPlaybackShell,
  shouldScheduleMobileOverlayHide,
  startPlaybackScrub,
} from "./playback-controller";

test("mobile overlay pins while paused and hides after playback inactivity", () => {
  const pausedState = createInitialMobileOverlayState("paused");
  const resumedState = reduceMobileOverlayState(pausedState, {
    type: "playback_resumed",
  });
  const fadingState = reduceMobileOverlayState(resumedState, {
    type: "hide_timeout",
  });
  const hiddenState = reduceMobileOverlayState(fadingState, {
    type: "fade_complete",
  });

  assert.deepEqual(pausedState, {
    visibility: "pinned",
    pinnedReason: "paused",
  });
  assert.deepEqual(resumedState, {
    visibility: "visible",
    pinnedReason: null,
  });
  assert.deepEqual(fadingState, {
    visibility: "fading",
    pinnedReason: null,
  });
  assert.deepEqual(hiddenState, {
    visibility: "hidden",
    pinnedReason: null,
  });
});

test("mobile overlay stays pinned during scrub interactions", () => {
  const initialState = createInitialMobileOverlayState("playing");
  const scrubState = reduceMobileOverlayState(initialState, {
    type: "scrub_started",
  });
  const finishedState = reduceMobileOverlayState(scrubState, {
    type: "scrub_finished",
  });

  assert.deepEqual(scrubState, {
    visibility: "pinned",
    pinnedReason: "scrub",
  });
  assert.deepEqual(finishedState, {
    visibility: "visible",
    pinnedReason: null,
  });
});

test("scrub commit emits one authoritative seek target after previewing", () => {
  const started = startPlaybackScrub({
    currentTimeSeconds: 25,
    nowMs: 1_000,
  });
  const previewed = previewPlaybackScrub({
    durationSeconds: 120,
    scrubState: started,
    valueSeconds: 48.4,
  });
  const commit = resolvePlaybackScrubCommit({
    currentTimeSeconds: 25,
    durationSeconds: 120,
    scrubState: previewed,
  });

  assert.equal(previewed.phase, "scrubbing");
  assert.equal(previewed.previewTime, 48.4);
  assert.equal(commit.committedTimeSeconds, 48.4);
  assert.deepEqual(commit.nextState, createIdlePlaybackScrubState());
});

test("small scrub deltas do not emit a fake authoritative seek", () => {
  const started = startPlaybackScrub({
    currentTimeSeconds: 25,
    nowMs: 1_000,
  });
  const previewed = previewPlaybackScrub({
    durationSeconds: 120,
    scrubState: started,
    valueSeconds: 25.1,
  });
  const commit = resolvePlaybackScrubCommit({
    currentTimeSeconds: 25,
    durationSeconds: 120,
    scrubState: previewed,
  });

  assert.equal(commit.committedTimeSeconds, null);
});

test("mini shell only renders for hidden mobile playback while playing", () => {
  assert.equal(
    shouldRenderMiniPlaybackShell({
      isMobileClient: true,
      overlayState: {
        visibility: "hidden",
        pinnedReason: null,
      },
      playbackStatus: "playing",
    }),
    true,
  );
  assert.equal(
    shouldRenderMiniPlaybackShell({
      isMobileClient: true,
      overlayState: {
        visibility: "visible",
        pinnedReason: null,
      },
      playbackStatus: "playing",
    }),
    false,
  );
});

test("mobile overlay hide scheduling stops while scrubbing", () => {
  assert.equal(
    shouldScheduleMobileOverlayHide({
      activeMenu: null,
      isMobileClient: true,
      overlayState: {
        visibility: "visible",
        pinnedReason: null,
      },
      playbackStatus: "playing",
      scrubState: startPlaybackScrub({
        currentTimeSeconds: 10,
        nowMs: 500,
      }),
    }),
    false,
  );
});
