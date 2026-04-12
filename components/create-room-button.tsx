"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useDebugRuntimeState } from "@/components/debug-runtime";
import { logDebugEvent } from "@/lib/debug-store";
import type { CreateRoomResponse } from "@/types/room-creation";

type CreateRoomButtonProps = {
  scope: string;
  catalogMovieId?: string | null;
  mediaAssetId?: string | null;
  movieTitle: string;
  label?: string;
  helperText?: string;
  variant?: "primary" | "secondary" | "ghost";
  fullWidth?: boolean;
};

type CreateRoomRequestStatus =
  | "idle"
  | "creating"
  | "success"
  | "error";

function getButtonClasses(
  variant: NonNullable<CreateRoomButtonProps["variant"]>,
  fullWidth: boolean,
) {
  const baseClasses =
    "inline-flex min-h-12 items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed";
  const widthClass = fullWidth ? " w-full" : "";

  switch (variant) {
    case "secondary":
      return `${baseClasses}${widthClass} border border-white/15 bg-white/6 text-white hover:border-[#89b2d8] hover:bg-white/10 disabled:border-white/8 disabled:text-white/45`;
    case "ghost":
      return `${baseClasses}${widthClass} border border-[#2f3948] bg-[#11151d] text-[#d6e6ff] hover:border-[#89b2d8] hover:text-white disabled:border-[#232833] disabled:text-[#657185]`;
    case "primary":
    default:
      return `${baseClasses}${widthClass} bg-[#cf7041] text-white hover:bg-[#b95e31] disabled:bg-[#6e4b39]`;
  }
}

export function CreateRoomButton({
  scope,
  catalogMovieId,
  mediaAssetId,
  movieTitle,
  label = "Create room",
  helperText,
  variant = "primary",
  fullWidth = false,
}: CreateRoomButtonProps) {
  const router = useRouter();
  const [requestStatus, setRequestStatus] =
    useState<CreateRoomRequestStatus>("idle");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);
  const [creationTimestamp, setCreationTimestamp] = useState<string | null>(null);
  const [requestStartedAt, setRequestStartedAt] = useState<string | null>(null);

  useDebugRuntimeState(scope, {
    selectedCatalogMovieId: catalogMovieId ?? null,
    linkedMediaAssetId: mediaAssetId ?? null,
    createRoomRequestStatus: requestStatus,
    createRoomFailureReason: failureReason,
    redirectTarget,
    creationTimestamp,
    requestStartedAt,
  });

  useEffect(() => {
    if (requestStatus !== "error" || !failureReason) {
      return;
    }

    logDebugEvent({
      level: "warn",
      category: "app",
      message: `Room creation failed for ${movieTitle}.`,
      source: "local_user",
      data: {
        catalogMovieId,
        mediaAssetId,
        failureReason,
      },
    });
  }, [catalogMovieId, failureReason, mediaAssetId, movieTitle, requestStatus]);

  async function handleCreateRoom() {
    const nextRequestStartedAt = new Date().toISOString();

    setRequestStatus("creating");
    setFailureReason(null);
    setRedirectTarget(null);
    setCreationTimestamp(null);
    setRequestStartedAt(nextRequestStartedAt);

    logDebugEvent({
      level: "info",
      category: "app",
      message: `Creating a room for ${movieTitle}.`,
      source: "local_user",
      data: {
        catalogMovieId,
        mediaAssetId,
        requestStartedAt: nextRequestStartedAt,
      },
    });

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          catalogMovieId,
          mediaAssetId,
        }),
      });
      const payload = (await response.json()) as CreateRoomResponse;

      if (!response.ok || !payload.ok) {
        setRequestStatus("error");
        setFailureReason(
          payload.ok ? "The room could not be created." : payload.message,
        );
        setCreationTimestamp(payload.createdAt);
        return;
      }

      setRequestStatus("success");
      setFailureReason(null);
      setRedirectTarget(payload.redirectTo);
      setCreationTimestamp(payload.createdAt);

      logDebugEvent({
        level: "info",
        category: "navigation",
        message: `Room ${payload.roomId} created for ${movieTitle}.`,
        source: "local_user",
        data: payload,
      });

      startTransition(() => {
        router.push(payload.redirectTo);
      });
    } catch (error) {
      setRequestStatus("error");
      setFailureReason(
        error instanceof Error
          ? error.message
          : "The room could not be created.",
      );
    }
  }

  return (
    <div className={fullWidth ? "w-full" : ""}>
      <button
        type="button"
        onClick={() => void handleCreateRoom()}
        disabled={requestStatus === "creating" || requestStatus === "success"}
        className={getButtonClasses(variant, fullWidth)}
      >
        {requestStatus === "creating"
          ? "Creating room..."
          : requestStatus === "success"
            ? "Opening room..."
            : label}
      </button>

      {helperText ? (
        <p className="mt-3 text-xs leading-6 text-[#8f99a8]">{helperText}</p>
      ) : null}

      {requestStatus === "error" && failureReason ? (
        <p className="mt-3 rounded-[1rem] border border-[#6a2a30]/50 bg-[#2b1317] px-4 py-3 text-sm leading-6 text-[#ffd4d1]">
          {failureReason}
        </p>
      ) : null}

      {redirectTarget ? (
        <p className="mt-3 text-xs leading-6 text-[#8f99a8]">
          Redirect target:{" "}
          <Link href={redirectTarget} className="font-mono text-[#d6e6ff]">
            {redirectTarget}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
