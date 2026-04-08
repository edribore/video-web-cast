import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { registerRoomSocketHandlers } from "./server/socket/register-room-socket-handlers";

const isDev = process.argv.includes("--dev") || !process.argv.includes("--prod");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "0.0.0.0";
const mutableEnv = process.env as Record<string, string | undefined>;

mutableEnv.NODE_ENV ??= isDev ? "development" : "production";

const app = next({
  dev: isDev,
  hostname,
  port,
});
const handle = app.getRequestHandler();

async function startServer() {
  await app.prepare();

  const httpServer = createServer((request, response) => {
    void handle(request, response);
  });
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin: true,
      credentials: true,
    },
  });

  registerRoomSocketHandlers(io);

  httpServer.listen(port, hostname, () => {
    console.log(
      `> video-web-cast server listening on http://${hostname}:${port} (${isDev ? "development" : "production"})`,
    );
  });
}

startServer().catch((error) => {
  console.error("Failed to start the video-web-cast server", error);
  process.exit(1);
});
