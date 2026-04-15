import type { PlaybackStatus } from "@/types/playback";

export type CastRemoteRoomCommandType = "play" | "pause" | "seek" | "stop";

export type CastRemoteControlSessionState =
  | "idle"
  | "remote_control_session_started"
  | "remote_control_session_active"
  | "remote_control_session_confirming"
  | "remote_control_session_expired";

export type CastRemoteControlObservation = {
  contentId: string | null;
  currentTime: number;
  selectionSignature: string | null;
  sessionId: string | null;
  status: PlaybackStatus;
  type: CastRemoteRoomCommandType;
};

export type CastRemoteControlSession = {
  contentId: string | null;
  controlSessionId: string;
  expiresAtMs: number;
  lastConfirmedRemoteAction: CastRemoteRoomCommandType | null;
  lastConfirmedRemoteState: PlaybackStatus | null;
  lastConfirmedRemoteTime: number | null;
  selectionSignature: string | null;
  sessionId: string | null;
  startedAtMs: number;
  state: CastRemoteControlSessionState;
  trustedContinuationUntilMs: number | null;
  trustedContinuationSource: "pause" | "seek" | null;
};

type CastRemoteControlDurations = {
  controlSessionWindowMs: number;
  trustedContinuationWindowMs: number;
};

type CastRemoteControlSessionUpdate = {
  session: CastRemoteControlSession;
  transition: "started" | "extended" | "confirmed";
};

let castRemoteControlSessionSequence = 0;

function buildControlSessionId() {
  castRemoteControlSessionSequence += 1;
  return `cast-remote-control-${castRemoteControlSessionSequence}`;
}

function hasCompatibleSelectionSignature(
  currentSelectionSignature: string | null,
  nextSelectionSignature: string | null,
) {
  return (
    currentSelectionSignature == null ||
    nextSelectionSignature == null ||
    currentSelectionSignature === nextSelectionSignature
  );
}

function isMatchingControlSession(
  session: CastRemoteControlSession | null,
  observation: CastRemoteControlObservation,
  nowMs: number,
) {
  return Boolean(
    session &&
      session.state !== "remote_control_session_expired" &&
      session.expiresAtMs > nowMs &&
      session.sessionId === observation.sessionId &&
      session.contentId === observation.contentId &&
      hasCompatibleSelectionSignature(
        session.selectionSignature,
        observation.selectionSignature,
      ),
  );
}

function createControlSession(
  observation: CastRemoteControlObservation,
  nowMs: number,
  durations: CastRemoteControlDurations,
  state: CastRemoteControlSessionState,
) {
  return {
    contentId: observation.contentId,
    controlSessionId: buildControlSessionId(),
    expiresAtMs: nowMs + durations.controlSessionWindowMs,
    lastConfirmedRemoteAction: null,
    lastConfirmedRemoteState: null,
    lastConfirmedRemoteTime: null,
    selectionSignature: observation.selectionSignature,
    sessionId: observation.sessionId,
    startedAtMs: nowMs,
    state,
    trustedContinuationSource: null,
    trustedContinuationUntilMs: null,
  } satisfies CastRemoteControlSession;
}

export function expireCastRemoteControlSession(
  session: CastRemoteControlSession | null,
  nowMs = Date.now(),
) {
  if (
    !session ||
    session.state === "remote_control_session_expired" ||
    session.expiresAtMs > nowMs
  ) {
    return {
      didExpire: false,
      session,
    };
  }

  return {
    didExpire: true,
    session: {
      ...session,
      state: "remote_control_session_expired" as const,
    },
  };
}

export function markCastRemoteControlSessionConfirming(
  session: CastRemoteControlSession | null,
  observation: CastRemoteControlObservation,
  nowMs: number,
  durations: CastRemoteControlDurations,
): CastRemoteControlSessionUpdate {
  if (!isMatchingControlSession(session, observation, nowMs)) {
    return {
      session: createControlSession(
        observation,
        nowMs,
        durations,
        "remote_control_session_started",
      ),
      transition: "started",
    };
  }

  const activeSession = session as CastRemoteControlSession;

  return {
    session: {
      ...activeSession,
      contentId: observation.contentId,
      expiresAtMs: Math.max(
        activeSession.expiresAtMs,
        nowMs + durations.controlSessionWindowMs,
      ),
      selectionSignature:
        observation.selectionSignature ?? activeSession.selectionSignature,
      state:
        activeSession.lastConfirmedRemoteAction == null
          ? "remote_control_session_started"
          : "remote_control_session_confirming",
    },
    transition: "extended",
  };
}

export function confirmCastRemoteControlSession(
  session: CastRemoteControlSession | null,
  observation: CastRemoteControlObservation,
  nowMs: number,
  durations: CastRemoteControlDurations,
): CastRemoteControlSessionUpdate {
  const activeSession: CastRemoteControlSession = isMatchingControlSession(
    session,
    observation,
    nowMs,
  )
    ? (session as CastRemoteControlSession)
    : createControlSession(
        observation,
        nowMs,
        durations,
        "remote_control_session_active",
      );
  const trustedContinuationSource: "pause" | "seek" | null =
    observation.type === "pause" || observation.type === "seek"
      ? observation.type
      : null;

  return {
    session: {
      ...activeSession,
      contentId: observation.contentId,
      expiresAtMs: Math.max(
        activeSession.expiresAtMs,
        nowMs + durations.controlSessionWindowMs,
      ),
      lastConfirmedRemoteAction: observation.type,
      lastConfirmedRemoteState: observation.status,
      lastConfirmedRemoteTime: observation.currentTime,
      selectionSignature:
        observation.selectionSignature ?? activeSession.selectionSignature,
      sessionId: observation.sessionId,
      state: "remote_control_session_active",
      trustedContinuationSource,
      trustedContinuationUntilMs: trustedContinuationSource
        ? nowMs + durations.trustedContinuationWindowMs
        : null,
    },
    transition:
      session == null || !isMatchingControlSession(session, observation, nowMs)
        ? "started"
        : "confirmed",
  };
}

export function isCastRemoteControlTrustedContinuationActive(
  session: CastRemoteControlSession | null,
  observation: Pick<
    CastRemoteControlObservation,
    "contentId" | "selectionSignature" | "sessionId"
  >,
  nowMs = Date.now(),
) {
  return Boolean(
    session &&
      session.state !== "remote_control_session_expired" &&
      session.expiresAtMs > nowMs &&
      session.trustedContinuationUntilMs != null &&
      session.trustedContinuationUntilMs > nowMs &&
      session.sessionId === observation.sessionId &&
      session.contentId === observation.contentId &&
      hasCompatibleSelectionSignature(
        session.selectionSignature,
        observation.selectionSignature,
      ),
  );
}
