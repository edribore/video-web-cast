import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["server.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  external: [
    "next",
    "next/*",
    "react",
    "react-dom",
    "pg",
    "socket.io",
    "socket.io-client",
    "dotenv"
  ]
});