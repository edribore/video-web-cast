import { build } from "esbuild";

await build({
  entryPoints: ["server.ts"],
  outfile: ".next/standalone-server.js",
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
    "@prisma/client",
    "pg",
    "socket.io",
    "socket.io-client",
  ],
});