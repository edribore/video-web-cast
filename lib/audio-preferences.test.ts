import test from "node:test";
import assert from "node:assert/strict";
import {
  getPreferredBrowserLanguages,
  resolvePreferredExternalAudioTrack,
} from "./audio-preferences";

test("preferred browser languages normalize language and region aliases", () => {
  const languages = getPreferredBrowserLanguages({
    language: "es-MX",
    languages: ["es-MX", "en-US"],
  });

  assert.deepEqual(languages.slice(0, 4), ["es-mx", "es", "en-us", "en"]);
});

test("external audio selection prefers the best navigator language match", () => {
  const resolved = resolvePreferredExternalAudioTrack({
    audioTracks: [
      { id: "audio-en", label: "English", language: "en" },
      { id: "audio-es", label: "Español", language: "es-ES" },
    ],
    preferredLanguages: getPreferredBrowserLanguages({
      language: "es-MX",
      languages: ["es-MX", "en-US"],
    }),
  });

  assert.equal(resolved.reason, "language_match");
  assert.equal(resolved.trackId, "audio-es");
});

test("external audio selection falls back to the first external track", () => {
  const resolved = resolvePreferredExternalAudioTrack({
    audioTracks: [
      { id: "audio-fr", label: "French", language: "fr" },
      { id: "audio-de", label: "German", language: "de" },
    ],
    preferredLanguages: ["ja", "ko"],
  });

  assert.equal(resolved.reason, "first_external");
  assert.equal(resolved.trackId, "audio-fr");
});

test("external audio selection falls back to embedded audio when no tracks exist", () => {
  const resolved = resolvePreferredExternalAudioTrack({
    audioTracks: [],
    preferredLanguages: ["es"],
  });

  assert.equal(resolved.reason, "embedded");
  assert.equal(resolved.trackId, null);
});

test("manual audio selection is preserved over language auto-selection", () => {
  const resolved = resolvePreferredExternalAudioTrack({
    audioTracks: [
      { id: "audio-en", label: "English", language: "en" },
      { id: "audio-es", label: "Spanish", language: "es" },
    ],
    preferredLanguages: ["es"],
    requestedAudioTrackId: "audio-en",
  });

  assert.equal(resolved.reason, "manual");
  assert.equal(resolved.trackId, "audio-en");
});
