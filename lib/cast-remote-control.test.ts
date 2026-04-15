import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmCastRemoteControlSession,
  expireCastRemoteControlSession,
  isCastRemoteControlTrustedContinuationActive,
  markCastRemoteControlSessionConfirming,
} from "./cast-remote-control";

const durations = {
  controlSessionWindowMs: 4500,
  trustedContinuationWindowMs: 3500,
};

test("confirmed remote pause opens a trusted continuation for follow-up play", () => {
  const pauseObservation = {
    contentId: "content-1",
    currentTime: 44,
    selectionSignature: "tracks-a",
    sessionId: "cast-session-1",
    status: "paused" as const,
    type: "pause" as const,
  };
  const started = markCastRemoteControlSessionConfirming(
    null,
    pauseObservation,
    1_000,
    durations,
  );
  const confirmed = confirmCastRemoteControlSession(
    started.session,
    pauseObservation,
    1_200,
    durations,
  );

  assert.equal(started.transition, "started");
  assert.equal(confirmed.session.lastConfirmedRemoteAction, "pause");
  assert.equal(confirmed.session.trustedContinuationSource, "pause");
  assert.equal(
    isCastRemoteControlTrustedContinuationActive(
      confirmed.session,
      {
        contentId: "content-1",
        selectionSignature: "tracks-a",
        sessionId: "cast-session-1",
      },
      1_700,
    ),
    true,
  );
});

test("confirmed remote seek keeps the same control session active for seek-then-play flows", () => {
  const seekObservation = {
    contentId: "content-2",
    currentTime: 130,
    selectionSignature: "tracks-b",
    sessionId: "cast-session-2",
    status: "paused" as const,
    type: "seek" as const,
  };
  const confirmedSeek = confirmCastRemoteControlSession(
    null,
    seekObservation,
    10_000,
    durations,
  );
  const followUpPlay = markCastRemoteControlSessionConfirming(
    confirmedSeek.session,
    {
      ...seekObservation,
      currentTime: 130.3,
      status: "playing" as const,
      type: "play" as const,
    },
    10_250,
    durations,
  );

  assert.equal(followUpPlay.transition, "extended");
  assert.equal(
    followUpPlay.session.controlSessionId,
    confirmedSeek.session.controlSessionId,
  );
  assert.equal(followUpPlay.session.state, "remote_control_session_confirming");
  assert.equal(
    isCastRemoteControlTrustedContinuationActive(
      confirmedSeek.session,
      {
        contentId: "content-2",
        selectionSignature: "tracks-b",
        sessionId: "cast-session-2",
      },
      10_500,
    ),
    true,
  );
});

test("remote control sessions expire after the configured window", () => {
  const confirmedPause = confirmCastRemoteControlSession(
    null,
    {
      contentId: "content-3",
      currentTime: 5,
      selectionSignature: "tracks-c",
      sessionId: "cast-session-3",
      status: "paused" as const,
      type: "pause" as const,
    },
    20_000,
    durations,
  );
  const expiration = expireCastRemoteControlSession(
    confirmedPause.session,
    25_000,
  );

  assert.equal(expiration.didExpire, true);
  assert.equal(expiration.session?.state, "remote_control_session_expired");
});
