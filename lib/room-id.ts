const ROOM_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const ROOM_ID_LENGTH = 8;

export function normalizeRoomId(roomId: string) {
  return roomId.trim().toLowerCase();
}

export function isValidRoomId(roomId: string) {
  return /^[a-z0-9-]{4,32}$/.test(roomId);
}

export function createPublicRoomId() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));

  return Array.from(randomBytes, (byte) => {
    return ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length];
  }).join("");
}
