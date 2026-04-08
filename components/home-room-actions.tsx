"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { startTransition, useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { logDebugEvent } from "@/lib/debug-store";
import { createPublicRoomId, isValidRoomId, normalizeRoomId } from "@/lib/room-id";
import { roomHref, uploadHref } from "@/lib/routes";
import { useDebugRuntimeState } from "@/components/debug-runtime";

export function HomeRoomActions() {
  const router = useRouter();
  const [roomIdInput, setRoomIdInput] = useState("");
  const deferredRoomIdInput = useDeferredValue(roomIdInput);
  const normalizedRoomId = normalizeRoomId(deferredRoomIdInput);
  const canJoinRoom = isValidRoomId(normalizedRoomId);

  useDebugRuntimeState("home/room-actions", {
    roomIdInput,
    normalizedRoomId,
    canJoinRoom,
  });

  function handleCreateRoom() {
    const roomId = createPublicRoomId();
    logDebugEvent({
      level: "info",
      category: "app",
      message: "Generated a new room ID from the home page.",
      source: "local_user",
      data: { roomId },
    });

    startTransition(() => {
      router.push(roomHref(roomId));
    });
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canJoinRoom) {
      return;
    }

    logDebugEvent({
      level: "info",
      category: "app",
      message: "Joining an existing room from the home page.",
      source: "local_user",
      data: { normalizedRoomId },
    });

    startTransition(() => {
      router.push(roomHref(normalizedRoomId));
    });
  }

  return (
    <div className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
        Room actions
      </p>
      <div className="mt-6 grid gap-4">
        <button
          type="button"
          onClick={handleCreateRoom}
          className="flex items-center justify-between rounded-3xl border border-line bg-white/80 px-5 py-4 text-left transition hover:border-accent"
        >
          <span>
            <span className="block text-base font-semibold">Create a room</span>
            <span className="mt-1 block text-sm text-muted">
              Generate a shareable room route from the scaffolded room page.
            </span>
          </span>
          <span className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white">
            New room
          </span>
        </button>

        <Link
          href={uploadHref()}
          className="flex items-center justify-between rounded-3xl border border-line bg-white/80 px-5 py-4 text-left transition hover:border-accent"
        >
          <span>
            <span className="block text-base font-semibold">Upload media</span>
            <span className="mt-1 block text-sm text-muted">
              Prepare an MP4 with subtitle tracks before creating a room.
            </span>
          </span>
          <span className="rounded-full border border-line px-4 py-2 text-xs font-semibold">
            Upload
          </span>
        </Link>
      </div>

      <form
        onSubmit={handleJoinRoom}
        className="mt-8 rounded-3xl border border-line bg-white/70 p-5"
      >
        <label htmlFor="room-id" className="text-sm font-semibold">
          Join an existing room
        </label>
        <p className="mt-2 text-sm leading-6 text-muted">
          Enter a room ID or paste the final segment from a shared room URL.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            id="room-id"
            name="room-id"
            value={roomIdInput}
            onChange={(event) => setRoomIdInput(event.target.value)}
            placeholder="example: ab7m2c9q"
            className="min-h-12 flex-1 rounded-full border border-line bg-panel px-4 outline-none transition focus:border-accent"
          />
          <button
            type="submit"
            disabled={!canJoinRoom}
            className="min-h-12 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-[#d9c4b8]"
          >
            Join room
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Room IDs use lowercase letters, numbers, and dashes.
        </p>
      </form>
    </div>
  );
}
