import type {
  RoomEvent as PrismaRoomEvent,
  RoomPlaybackState as PrismaRoomPlaybackState,
} from "../app/generated/prisma/client";
import {
  buildAuthoritativePlaybackState,
  clampPlaybackRate,
  createInitialPlaybackState,
  resolveSynchronizedPlaybackTime,
  roundPlaybackSeconds,
  roundWallClockMs,
} from "../lib/playback";
import { getPrismaClient } from "./prisma";
import type {
  RoomSocketHydrationPayload,
  RoomSocketPlaybackSyncPayload,
  RoomSyncEvent,
  SharedRoomControlCommand,
} from "../types/room-sync";
import type { PlaybackStateSnapshot, PlaybackStatus } from "../types/playback";

function normalizeCurrentTime(currentTime: number) {
  return roundPlaybackSeconds(currentTime);
}

function resolveEventStatus(
  eventType: PrismaRoomEvent["type"],
  fallbackStatus: PlaybackStatus,
) {
  switch (eventType) {
    case "play":
      return "playing";
    case "pause":
      return "paused";
    case "stop":
      return "stopped";
    case "seek":
    case "join":
    default:
      return fallbackStatus;
  }
}

function parseEventPayload(event: PrismaRoomEvent | null) {
  if (!event?.payload || typeof event.payload !== "object") {
    return null;
  }

  return event.payload as Record<string, unknown>;
}

function toPlaybackSnapshot(
  playbackState: PrismaRoomPlaybackState | null,
): PlaybackStateSnapshot {
  if (!playbackState) {
    return createInitialPlaybackState();
  }

  const updatedAtWallClockMs = playbackState.updatedAt.getTime();
  const basePlayback = createInitialPlaybackState({
    status: playbackState.status,
    currentTime: playbackState.currentTime,
    anchorMediaTime: playbackState.anchorMediaTime,
    anchorWallClockMs:
      playbackState.anchorWallClockMs > 0
        ? playbackState.anchorWallClockMs
        : updatedAtWallClockMs,
    scheduledStartWallClockMs: playbackState.scheduledStartWallClockMs,
    playbackRate: playbackState.playbackRate,
    version: playbackState.version,
    updatedAt: playbackState.updatedAt.toISOString(),
    sourceClientEventId: playbackState.sourceClientEventId,
  });

  return {
    ...basePlayback,
    currentTime: resolveSynchronizedPlaybackTime(basePlayback, Date.now()),
  };
}

function toRoomSyncEvent(
  roomId: string,
  event: PrismaRoomEvent | null,
  fallbackPlayback: PlaybackStateSnapshot,
): RoomSyncEvent | null {
  if (!event || event.playbackVersion == null) {
    return null;
  }

  const payload = parseEventPayload(event);
  const anchorMediaTime =
    typeof payload?.anchorMediaTime === "number"
      ? roundPlaybackSeconds(payload.anchorMediaTime)
      : normalizeCurrentTime(event.currentTime ?? fallbackPlayback.anchorMediaTime);
  const anchorWallClockMs =
    typeof payload?.anchorWallClockMs === "number"
      ? roundWallClockMs(payload.anchorWallClockMs)
      : event.createdAt.getTime();
  const status =
    typeof payload?.status === "string"
      ? (payload.status as PlaybackStatus)
      : resolveEventStatus(event.type, fallbackPlayback.status);
  const scheduledStartWallClockMs =
    typeof payload?.scheduledStartWallClockMs === "number"
      ? roundWallClockMs(payload.scheduledStartWallClockMs)
      : status === "playing"
        ? anchorWallClockMs
        : null;
  const playbackRate =
    typeof event.playbackRate === "number"
      ? clampPlaybackRate(event.playbackRate)
      : fallbackPlayback.playbackRate;
  const sourceClientEventId =
    typeof payload?.sourceClientEventId === "string"
      ? payload.sourceClientEventId
      : null;

  return {
    roomId,
    type: event.type,
    actorSessionId: event.actorSessionId,
    occurredAt: event.createdAt.toISOString(),
    version: event.playbackVersion,
    status,
    currentTime: normalizeCurrentTime(event.currentTime ?? anchorMediaTime),
    anchorMediaTime,
    anchorWallClockMs,
    scheduledStartWallClockMs,
    playbackRate,
    sourceClientEventId,
  };
}

function buildPlaybackEventPayload(playback: PlaybackStateSnapshot) {
  return {
    status: playback.status,
    anchorMediaTime: playback.anchorMediaTime,
    anchorWallClockMs: playback.anchorWallClockMs,
    scheduledStartWallClockMs: playback.scheduledStartWallClockMs,
    sourceClientEventId: playback.sourceClientEventId,
  };
}

export async function getRoomRealtimeSnapshot(
  publicRoomId: string,
): Promise<RoomSocketHydrationPayload | null> {
  const prisma = getPrismaClient();

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

  const playback = toPlaybackSnapshot(room.playbackState);

  return {
    playback,
    lastEvent: toRoomSyncEvent(publicRoomId, room.events[0] ?? null, playback),
  };
}

export async function recordRoomJoin(
  publicRoomId: string,
  actorSessionId: string,
): Promise<RoomSocketHydrationPayload | null> {
  const prisma = getPrismaClient();

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
          anchorWallClockMs: Date.now(),
        },
      }));
    const playback = toPlaybackSnapshot(playbackState);
    const joinEvent = await tx.roomEvent.create({
      data: {
        roomId: room.id,
        type: "join",
        actorSessionId,
        currentTime: resolveSynchronizedPlaybackTime(playback, Date.now()),
        playbackRate: playback.playbackRate,
        playbackVersion: playback.version,
        payload: buildPlaybackEventPayload(playback),
      },
    });

    return {
      playback,
      lastEvent: toRoomSyncEvent(publicRoomId, joinEvent, playback),
    };
  });
}

export async function applySharedRoomControl(
  command: SharedRoomControlCommand,
): Promise<RoomSocketPlaybackSyncPayload | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({
      where: {
        publicId: command.roomId,
      },
      select: {
        id: true,
        playbackState: {
          select: {
            version: true,
          },
        },
      },
    });

    if (!room) {
      return null;
    }

    const nowWallClockMs = Date.now();
    const nextPlayback = buildAuthoritativePlaybackState({
      clientEventId: command.clientEventId,
      currentTime:
        command.type === "stop" ? 0 : normalizeCurrentTime(command.currentTime),
      nowWallClockMs,
      playbackRate: command.playbackRate,
      status: command.status,
      type: command.type,
      version: room.playbackState ? room.playbackState.version + 1 : 1,
    });

    const playbackState = await tx.roomPlaybackState.upsert({
      where: {
        roomId: room.id,
      },
      create: {
        roomId: room.id,
        status: nextPlayback.status,
        currentTime: nextPlayback.anchorMediaTime,
        anchorMediaTime: nextPlayback.anchorMediaTime,
        anchorWallClockMs: nextPlayback.anchorWallClockMs,
        scheduledStartWallClockMs: nextPlayback.scheduledStartWallClockMs,
        playbackRate: nextPlayback.playbackRate,
        sourceClientEventId: nextPlayback.sourceClientEventId,
        version: nextPlayback.version,
      },
      update: {
        status: nextPlayback.status,
        currentTime: nextPlayback.anchorMediaTime,
        anchorMediaTime: nextPlayback.anchorMediaTime,
        anchorWallClockMs: nextPlayback.anchorWallClockMs,
        scheduledStartWallClockMs: nextPlayback.scheduledStartWallClockMs,
        playbackRate: nextPlayback.playbackRate,
        sourceClientEventId: nextPlayback.sourceClientEventId,
        version: {
          increment: 1,
        },
      },
    });

    const playbackSnapshot = toPlaybackSnapshot(playbackState);
    const roomEvent = await tx.roomEvent.create({
      data: {
        roomId: room.id,
        type: command.type,
        actorSessionId: command.actorSessionId,
        currentTime: playbackSnapshot.anchorMediaTime,
        playbackRate: playbackSnapshot.playbackRate,
        playbackVersion: playbackSnapshot.version,
        payload: buildPlaybackEventPayload(playbackSnapshot),
      },
    });

    return {
      playback: playbackSnapshot,
      event: toRoomSyncEvent(command.roomId, roomEvent, playbackSnapshot)!,
      sourceClientEventId: command.clientEventId,
    };
  });
}
