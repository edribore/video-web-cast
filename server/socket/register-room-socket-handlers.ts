import type { Server, Socket } from "socket.io";
import { applySharedRoomControl, recordRoomJoin } from "../room-realtime";
import type {
  RoomDebugClockSyncRequest,
  RoomDebugClockSyncResponse,
  SharedRoomControlCommand,
  SharedRoomControlSource,
} from "../../types/room-sync";

type RoomJoinPayload = {
  roomId: string;
  actorSessionId: string;
};

function isRoomJoinPayload(value: unknown): value is RoomJoinPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RoomJoinPayload>;

  return (
    typeof candidate.roomId === "string" &&
    candidate.roomId.trim().length > 0 &&
    typeof candidate.actorSessionId === "string" &&
    candidate.actorSessionId.trim().length > 0
  );
}

function isSharedRoomControlCommand(
  value: unknown,
): value is SharedRoomControlCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SharedRoomControlCommand>;

  return (
    typeof candidate.roomId === "string" &&
    candidate.roomId.trim().length > 0 &&
    typeof candidate.actorSessionId === "string" &&
    candidate.actorSessionId.trim().length > 0 &&
    typeof candidate.clientEventId === "string" &&
    candidate.clientEventId.trim().length > 0 &&
    typeof candidate.type === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.currentTime === "number" &&
    Number.isFinite(candidate.currentTime) &&
    typeof candidate.playbackRate === "number" &&
    Number.isFinite(candidate.playbackRate) &&
    (candidate.commandSource == null ||
      isSharedRoomControlSource(candidate.commandSource))
  );
}

function isSharedRoomControlSource(
  value: unknown,
): value is SharedRoomControlSource {
  return (
    value === "local_user" ||
    value === "cast_local_command" ||
    value === "cast_remote"
  );
}

function isRoomDebugClockSyncRequest(
  value: unknown,
): value is RoomDebugClockSyncRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RoomDebugClockSyncRequest>;

  return (
    typeof candidate.sampleId === "string" &&
    candidate.sampleId.trim().length > 0 &&
    typeof candidate.clientSentAtMs === "number" &&
    Number.isFinite(candidate.clientSentAtMs)
  );
}

function getRoomChannel(roomId: string) {
  return `room:${roomId}`;
}

async function handleJoin(socket: Socket, payload: RoomJoinPayload) {
  const roomChannel = getRoomChannel(payload.roomId);

  await socket.join(roomChannel);
  socket.data.actorSessionId = payload.actorSessionId;
  socket.data.roomId = payload.roomId;

  const hydration = await recordRoomJoin(payload.roomId, payload.actorSessionId);

  if (!hydration) {
    socket.emit("room:error", {
      message: "The requested room could not be found.",
    });
    return;
  }

  socket.emit("room:hydrated", hydration);
  socket.to(roomChannel).emit("room:playback-sync", {
    playback: hydration.playback,
    event: hydration.lastEvent,
    sourceClientEventId: null,
  });
}

async function handleRoomCommand(
  io: Server,
  socket: Socket,
  command: SharedRoomControlCommand,
) {
  const roomChannel = getRoomChannel(command.roomId);
  const result = await applySharedRoomControl(command);

  if (!result) {
    socket.emit("room:error", {
      message: "Unable to apply the requested room command.",
    });
    return;
  }

  io.to(roomChannel).emit("room:playback-sync", result);
}

export function registerRoomSocketHandlers(io: Server) {
  io.on("connection", (socket) => {
    socket.on("room:join", async (payload: unknown) => {
      if (!isRoomJoinPayload(payload)) {
        socket.emit("room:error", {
          message: "Invalid room join payload.",
        });
        return;
      }

      try {
        await handleJoin(socket, payload);
      } catch (error) {
        console.error("Failed to join room socket channel", error);
        socket.emit("room:error", {
          message: "Unable to join the room right now.",
        });
      }
    });

    socket.on("room:command", async (payload: unknown) => {
      if (!isSharedRoomControlCommand(payload)) {
        socket.emit("room:error", {
          message: "Invalid room command payload.",
        });
        return;
      }

      try {
        await handleRoomCommand(io, socket, payload);
      } catch (error) {
        console.error("Failed to process room command", error);
        socket.emit("room:error", {
          message: "Unable to update the shared room playback right now.",
        });
      }
    });

    socket.on(
      "room:debug-clock-sync",
      (
        payload: unknown,
        callback?: (response: RoomDebugClockSyncResponse) => void,
      ) => {
        if (!isRoomDebugClockSyncRequest(payload) || typeof callback !== "function") {
          return;
        }

        const serverReceivedAtMs = Date.now();
        const response: RoomDebugClockSyncResponse = {
          sampleId: payload.sampleId,
          clientSentAtMs: payload.clientSentAtMs,
          serverReceivedAtMs,
          serverSentAtMs: Date.now(),
        };

        callback(response);
      },
    );
  });
}
