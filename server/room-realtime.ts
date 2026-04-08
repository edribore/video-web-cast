import type {
  RoomEvent as PrismaRoomEvent,
  RoomPlaybackState as PrismaRoomPlaybackState,
} from "../app/generated/prisma/client";
import {
  createInitialPlaybackState,
  resolveSynchronizedPlaybackTime,
} from "../lib/playback";
import { prisma } from "./prisma";
import type {
  RoomSocketHydrationPayload,
  RoomSocketPlaybackSyncPayload,
  RoomSyncEvent,
  SharedRoomControlCommand,
} from "../types/room-sync";

function clampPlaybackRate(playbackRate: number) {
  return Math.min(Math.max(playbackRate, 0.25), 3);
}

function normalizeCurrentTime(currentTime: number) {
  return Math.max(0, Math.round(currentTime * 1000) / 1000);
}

function toPlaybackSnapshot(
  playbackState: PrismaRoomPlaybackState | null,
) {
  if (!playbackState) {
    return createInitialPlaybackState();
  }

  return createInitialPlaybackState({
    status: playbackState.status,
    currentTime: playbackState.currentTime,
    playbackRate: playbackState.playbackRate,
    version: playbackState.version,
    updatedAt: playbackState.updatedAt.toISOString(),
  });
}

function toRoomSyncEvent(
  roomId: string,
  event: PrismaRoomEvent | null,
): RoomSyncEvent | null {
  if (!event || event.playbackVersion == null) {
    return null;
  }

  return {
    roomId,
    type: event.type,
    actorSessionId: event.actorSessionId,
    occurredAt: event.createdAt.toISOString(),
    version: event.playbackVersion,
    currentTime: event.currentTime ?? 0,
    playbackRate: event.playbackRate ?? 1,
  };
}

export async function getRoomRealtimeSnapshot(
  publicRoomId: string,
): Promise<RoomSocketHydrationPayload | null> {
  const room = await prisma.room.findUnique({
    where: {
      publicId: publicRoomId,
    },
    select: {
      playbackState: true,
      events: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (!room) {
    return null;
  }

  return {
    playback: toPlaybackSnapshot(room.playbackState),
    lastEvent: toRoomSyncEvent(publicRoomId, room.events[0] ?? null),
  };
}

export async function recordRoomJoin(
  publicRoomId: string,
  actorSessionId: string,
): Promise<RoomSocketHydrationPayload | null> {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({
      where: {
        publicId: publicRoomId,
      },
      select: {
        id: true,
        playbackState: true,
      },
    });

    if (!room) {
      return null;
    }

    const playbackState =
      room.playbackState ??
      (await tx.roomPlaybackState.create({
        data: {
          roomId: room.id,
        },
      }));
    const playback = toPlaybackSnapshot(playbackState);
    const joinEvent = await tx.roomEvent.create({
      data: {
        roomId: room.id,
        type: "join",
        actorSessionId,
        currentTime: resolveSynchronizedPlaybackTime(playback),
        playbackRate: playback.playbackRate,
        playbackVersion: playback.version,
      },
    });

    return {
      playback,
      lastEvent: toRoomSyncEvent(publicRoomId, joinEvent),
    };
  });
}

export async function applySharedRoomControl(
  command: SharedRoomControlCommand,
): Promise<RoomSocketPlaybackSyncPayload | null> {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({
      where: {
        publicId: command.roomId,
      },
      select: {
        id: true,
      },
    });

    if (!room) {
      return null;
    }

    const nextStatus =
      command.type === "stop"
        ? "stopped"
        : command.type === "play"
          ? "playing"
          : command.type === "pause"
            ? "paused"
            : command.status;
    const nextCurrentTime =
      command.type === "stop" ? 0 : normalizeCurrentTime(command.currentTime);
    const nextPlaybackRate = clampPlaybackRate(command.playbackRate);

    const playbackState = await tx.roomPlaybackState.upsert({
      where: {
        roomId: room.id,
      },
      create: {
        roomId: room.id,
        status: nextStatus,
        currentTime: nextCurrentTime,
        playbackRate: nextPlaybackRate,
      },
      update: {
        status: nextStatus,
        currentTime: nextCurrentTime,
        playbackRate: nextPlaybackRate,
        version: {
          increment: 1,
        },
      },
    });

    const roomEvent = await tx.roomEvent.create({
      data: {
        roomId: room.id,
        type: command.type,
        actorSessionId: command.actorSessionId,
        currentTime: playbackState.currentTime,
        playbackRate: playbackState.playbackRate,
        playbackVersion: playbackState.version,
        payload: {
          clientEventId: command.clientEventId,
        },
      },
    });

    return {
      playback: toPlaybackSnapshot(playbackState),
      event: toRoomSyncEvent(command.roomId, roomEvent)!,
      sourceClientEventId: command.clientEventId,
    };
  });
}
