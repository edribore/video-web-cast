import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmCastRemoteControlSession,
  isCastRemoteInteractionSessionActive,
  isCastRemoteControlTrustedContinuationActive,
  markCastRemoteControlSessionConfirming,
} from "./cast-remote-control";

const durations = {
  controlSessionWindowMs: 6_000,
  trustedContinuationWindowMs: 4_500,
} as const;

test("confirmed remote pause starts a trusted Cast interaction session", () => {
  const confirmed = confirmCastRemoteControlSession(
    null,
    {
      contentId: "movie-1",
      currentTime: 120,
      selectionSignature: "signature-1",
      sessionId: "cast-session-1",
      status: "paused",
      type: "pause",
    },
    10_000,
    durations,
  );

  assert.equal(confirmed.transition, "started");
  assert.equal(
    isCastRemoteInteractionSessionActive(
      confirmed.session,
      {
        contentId: "movie-1",
        selectionSignature: "signature-1",
        sessionId: "cast-session-1",
      },
      11_000,
    ),
    true,
  );
  assert.equal(
    isCastRemoteControlTrustedContinuationActive(
      confirmed.session,
      {
        contentId: "movie-1",
        selectionSignature: "signature-1",
        sessionId: "cast-session-1",
      },
      11_000,
    ),
    true,
  );
});

test("coherent follow-up remote actions extend the same interaction session", () => {
  const started = confirmCastRemoteControlSession(
    null,
    {
      contentId: "movie-1",
      currentTime: 120,
      selectionSignature: "signature-1",
      sessionId: "cast-session-1",
      status: "paused",
      type: "pause",
    },
    10_000,
    durations,
  );
  const observed = markCastRemoteControlSessionConfirming(
    started.session,
    {
      contentId: "movie-1",
      currentTime: 185,
      selectionSignature: "signature-1",
      sessionId: "cast-session-1",
      status: "playing",
      type: "seek",
    },
    12_000,
    durations,
  );
  const confirmed = confirmCastRemoteControlSession(
    observed.session,
    {
      contentId: "movie-1",
      currentTime: 185,
      selectionSignature: "signature-1",
      sessionId: "cast-session-1",
      status: "playing",
      type: "play",
    },
    12_400,
    durations,
  );

  assert.equal(observed.session.controlSessionId, started.session.controlSessionId);
  assert.equal(confirmed.session.controlSessionId, started.session.controlSessionId);
  assert.equal(confirmed.session.expiresAtMs, 18_400);
  assert.equal(
    isCastRemoteInteractionSessionActive(
      confirmed.session,
      {
        contentId: "movie-1",
        selectionSignature: "signature-1",
        sessionId: "cast-session-1",
      },
      13_000,
    ),
    true,
  );
});

test("trusted continuation stays constrained to the same cast session and selection", () => {
  const confirmed = confirmCastRemoteControlSession(
    null,
    {
      contentId: "movie-1",
      currentTime: 50,
      selectionSignature: "signature-1",
      sessionId: "cast-session-1",
      status: "paused",
      type: "pause",
    },
    5_000,
    durations,
  );

  assert.equal(
    isCastRemoteControlTrustedContinuationActive(
      confirmed.session,
      {
        contentId: "movie-1",
        selectionSignature: "signature-2",
        sessionId: "cast-session-1",
      },
      5_500,
    ),
    false,
  );
});
