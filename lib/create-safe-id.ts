function buildUuidFromRandomValues(cryptoApi: Crypto) {
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function getCryptoApi() {
  return typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
}

export function createSafeId(prefix?: string) {
  const cryptoApi = getCryptoApi();
  let id: string;

  if (cryptoApi?.randomUUID) {
    id = cryptoApi.randomUUID();
  } else if (cryptoApi?.getRandomValues) {
    id = buildUuidFromRandomValues(cryptoApi);
  } else {
    id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return prefix ? `${prefix}-${id}` : id;
}

export function createSafeIdSegment(length = 8) {
  return createSafeId().replace(/-/g, "").slice(0, length);
}
