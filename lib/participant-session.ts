import { createSafeId } from "@/lib/create-safe-id";

const participantSessionStorageKey = "video-web-cast.participant-session-id";

export function getOrCreateParticipantSessionId() {
  if (typeof window === "undefined") {
    return createSafeId("session");
  }

  const existingSessionId = window.sessionStorage.getItem(
    participantSessionStorageKey,
  );

  if (existingSessionId) {
    return existingSessionId;
  }

  const nextSessionId = createSafeId("session");
  window.sessionStorage.setItem(participantSessionStorageKey, nextSessionId);
  return nextSessionId;
}
