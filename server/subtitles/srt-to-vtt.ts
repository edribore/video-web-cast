import "server-only";

function normalizeLineEndings(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function normalizeCueTiming(line: string) {
  if (!line.includes("-->")) {
    return line;
  }

  return line.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    (_match, timestamp, milliseconds) => `${timestamp}.${milliseconds}`,
  );
}

export function convertSrtToWebVtt(srtContent: string) {
  const normalizedContent = normalizeLineEndings(srtContent).trim();

  if (!normalizedContent) {
    return "WEBVTT\n";
  }

  const convertedLines = normalizedContent
    .split("\n")
    .map(normalizeCueTiming);

  return `WEBVTT\n\n${convertedLines.join("\n")}\n`;
}
