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
    <div className="rounded-[2rem] border border-white/10 bg-[#17131a]/85 p-8 shadow-[0_22px_60px_rgba(0,0,0,0.24)]">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#b99f78]">
        Join an existing room
      </p>
      <form
        onSubmit={handleJoinRoom}
        className="mt-6 rounded-[1.6rem] border border-white/10 bg-black/20 p-5"
      >
        <label htmlFor="room-id" className="text-sm font-semibold text-white">
          Join an existing room
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

      <div className="mt-6 rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-5">
        <p className="text-sm font-semibold text-white">Admin tools</p>
        <p className="mt-2 text-sm leading-6 text-[#c7c2ca]">
          Uploads and catalog curation now live behind the admin workflow so the
          public home stays focused on curated watch-room launches.
        </p>
        <Link
          href={adminHref()}
          className="mt-4 inline-flex rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-[#8fa7c7] hover:text-[#dbe8ff]"
        >
          Open admin console
        </Link>
      </div>
    </div>
  );
}
