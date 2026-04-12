"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { startTransition, useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { logDebugEvent } from "@/lib/debug-store";
import { isValidRoomId, normalizeRoomId } from "@/lib/room-id";
import { adminHref, roomHref } from "@/lib/routes";
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
    <div
      id="join-room"
      className="rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,19,28,0.96),rgba(11,14,21,0.96))] p-8 shadow-[0_24px_65px_rgba(0,0,0,0.28)]"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
        Already have an invite?
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
        Step straight into a live screening.
      </h2>
      <p className="mt-3 text-sm leading-7 text-[#c7c2ca]">
        Drop in with a room code or the final segment from a shared SyncPass
        link. The browser will reconnect to the room timeline and its current
        playback destination automatically.
      </p>
      <form
        onSubmit={handleJoinRoom}
        className="mt-6 rounded-[1.8rem] border border-white/10 bg-black/20 p-5"
      >
        <label htmlFor="room-id" className="text-sm font-semibold text-white">
          Room code
        </label>
        <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
          Enter a room ID or paste the final segment from a shared room URL.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            id="room-id"
            name="room-id"
            value={roomIdInput}
            onChange={(event) => setRoomIdInput(event.target.value)}
            placeholder="example: ab7m2c9q"
            className="min-h-12 flex-1 rounded-full border border-white/10 bg-[#120e13] px-4 text-white outline-none transition focus:border-[#8fa7c7]"
          />
          <button
            type="submit"
            disabled={!canJoinRoom}
            className="min-h-12 rounded-full bg-[#d07a3e] px-5 text-sm font-semibold text-white transition hover:bg-[#b76630] disabled:cursor-not-allowed disabled:bg-[#5b4637]"
          >
            Join room
          </button>
        </div>
        <p className="mt-3 text-xs text-[#8c8a91]">
          Room IDs use lowercase letters, numbers, and dashes.
        </p>
      </form>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-5">
        <div>
          <p className="text-sm font-semibold text-white">Need staff tools?</p>
          <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
            Uploads, catalog curation, and asset inspection live behind the
            admin workflow.
          </p>
        </div>
        <Link
          href={adminHref()}
          className="inline-flex rounded-full border border-[#2a3342] bg-[#10151d] px-4 py-3 text-sm font-semibold text-[#d6e6ff] transition hover:border-[#8fa7c7] hover:text-white"
        >
          Staff
        </Link>
      </div>
    </div>
  );
}
