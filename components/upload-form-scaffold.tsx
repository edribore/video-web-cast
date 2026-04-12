"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSafeId } from "@/lib/create-safe-id";
import { logDebugEvent } from "@/lib/debug-store";
import {
  acceptedAudioExtensions,
  acceptedSubtitleExtensions,
} from "@/lib/media";
import {
  useDebugFeatureFlags,
  useDebugRuntimeState,
} from "@/components/debug-runtime";
import {
  initialUploadClientState,
  type UploadApiFailureResponse,
  type UploadApiSuccessResponse,
  type UploadScaffoldConfig,
} from "@/types/upload";

type UploadFormScaffoldProps = {
  config: UploadScaffoldConfig;
};

type TrackRow = {
  id: string;
};

type UploadRequestCallbacks = {
  onProcessing(): void;
  onProgress(progress: { loaded: number; total: number }): void;
};

type UploadRequestError = {
  message: string;
  payload: UploadApiFailureResponse | null;
  status: number | null;
};

function createTrackRow(): TrackRow {
  return {
    id: createSafeId("track"),
  };
}

function formatByteCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let currentValue = value;
  let unitIndex = 0;

  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 ? 0 : currentValue >= 100 ? 0 : 1;
  return `${currentValue.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function calculateSelectedFileBytes(formData: FormData) {
  let totalBytes = 0;

  for (const value of formData.values()) {
    if (value instanceof File && value.size > 0) {
      totalBytes += value.size;
    }
  }

  return totalBytes;
}

function parseUploadApiPayload(xhr: XMLHttpRequest) {
  const response = xhr.response;

  if (response && typeof response === "object") {
    return response as UploadApiSuccessResponse | UploadApiFailureResponse;
  }

  if (!xhr.responseText) {
    return null;
  }

  try {
    return JSON.parse(xhr.responseText) as
      | UploadApiSuccessResponse
      | UploadApiFailureResponse;
  } catch {
    return null;
  }
}

function submitUploadRequest(
  formData: FormData,
  callbacks: UploadRequestCallbacks,
) {
  return new Promise<UploadApiSuccessResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      callbacks.onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      });
    });

    xhr.upload.addEventListener("load", () => {
      callbacks.onProcessing();
    });

    xhr.addEventListener("error", () => {
      reject({
        message: "The upload request failed before the server returned a response.",
        payload: null,
        status: null,
      } satisfies UploadRequestError);
    });

    xhr.addEventListener("abort", () => {
      reject({
        message: "The upload request was interrupted before it finished.",
        payload: null,
        status: null,
      } satisfies UploadRequestError);
    });

    xhr.addEventListener("load", () => {
      const payload = parseUploadApiPayload(xhr);

      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok) {
        resolve(payload);
        return;
      }

      reject({
        message:
          payload && !payload.ok
            ? payload.message
            : "The upload could not be completed.",
        payload: payload && !payload.ok ? payload : null,
        status: xhr.status,
      } satisfies UploadRequestError);
    });

    xhr.send(formData);
  });
}

function UploadSubmitButton({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-[#d9c4b8]"
    >
      {label}
    </button>
  );
}

type TrackSectionProps = {
  legend: string;
  description: string;
  groupName: "audio" | "subtitle";
  rows: TrackRow[];
  accept: string;
  supportedExtensions: readonly string[];
  defaultIndex: number;
  disabled: boolean;
  onDefaultIndexChange(nextIndex: number): void;
  onAddRow(): void;
  onRemoveRow(index: number): void;
  fieldError?: string;
};

function TrackSection({
  legend,
  description,
  groupName,
  rows,
  accept,
  supportedExtensions,
  defaultIndex,
  disabled,
  onDefaultIndexChange,
  onAddRow,
  onRemoveRow,
  fieldError,
}: TrackSectionProps) {
  const fileFieldName =
    groupName === "audio" ? "audioTrackFiles" : "subtitleTrackFiles";
  const languageFieldName =
    groupName === "audio" ? "audioTrackLanguages" : "subtitleTrackLanguages";
  const labelFieldName =
    groupName === "audio" ? "audioTrackLabels" : "subtitleTrackLabels";
  const defaultFieldName =
    groupName === "audio"
      ? "defaultAudioTrackIndex"
      : "defaultSubtitleTrackIndex";

  return (
    <fieldset className="rounded-3xl border border-line bg-white/75 p-5" disabled={disabled}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <legend className="text-base font-semibold">{legend}</legend>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAddRow}
          disabled={disabled}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent-strong disabled:cursor-not-allowed disabled:text-muted"
        >
          Add {groupName} track
        </button>
      </div>

      <input type="hidden" name={defaultFieldName} value={String(defaultIndex)} />

      <div className="mt-6 space-y-4">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="rounded-3xl border border-line/80 bg-panel p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">
                  {groupName === "audio" ? "Audio language" : "Subtitle language"}{" "}
                  {index + 1}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Upload a file and label this track for participant-side
                  language selection.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemoveRow(index)}
                disabled={disabled}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition hover:border-accent hover:text-accent-strong disabled:cursor-not-allowed disabled:text-muted"
              >
                Remove
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.35fr_0.65fr_1fr]">
              <label className="text-sm font-semibold">
                File
                <input
                  name={fileFieldName}
                  type="file"
                  accept={accept}
                  disabled={disabled}
                  className="mt-2 block w-full rounded-2xl border border-dashed border-line bg-white px-4 py-4 text-sm disabled:cursor-not-allowed disabled:text-muted"
                />
              </label>
              <label className="text-sm font-semibold">
                Language code
                <input
                  name={languageFieldName}
                  type="text"
                  placeholder="en"
                  disabled={disabled}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-white px-4 outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:text-muted"
                />
              </label>
              <label className="text-sm font-semibold">
                Label
                <input
                  name={labelFieldName}
                  type="text"
                  placeholder={
                    groupName === "audio" ? "English dubbing" : "English captions"
                  }
                  disabled={disabled}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-white px-4 outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:text-muted"
                />
              </label>
            </div>

            <label className="mt-4 inline-flex items-center gap-3 text-sm text-muted">
              <input
                type="radio"
                name={`${groupName}-default-choice`}
                value={String(index)}
                checked={defaultIndex === index}
                onChange={() => onDefaultIndexChange(index)}
                disabled={disabled}
                className="h-4 w-4 accent-accent"
              />
              Use as this media asset&apos;s default {groupName} track
            </label>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        Supported {groupName} extensions: {supportedExtensions.join(", ")}
      </p>
      {fieldError ? (
        <p className="mt-3 text-sm font-semibold text-[#7f4022]">{fieldError}</p>
      ) : null}
    </fieldset>
  );
}

export function UploadFormScaffold({ config }: UploadFormScaffoldProps) {
  const router = useRouter();
  const [uploadState, setUploadState] = useState(initialUploadClientState);
  const [titleInput, setTitleInput] = useState("");
  const [audioRows, setAudioRows] = useState<TrackRow[]>(() => [createTrackRow()]);
  const [subtitleRows, setSubtitleRows] = useState<TrackRow[]>(() => [
    createTrackRow(),
  ]);
  const [defaultAudioIndex, setDefaultAudioIndex] = useState(0);
  const [defaultSubtitleIndex, setDefaultSubtitleIndex] = useState(0);
  const isBusy =
    uploadState.status === "uploading" ||
    uploadState.status === "processing" ||
    uploadState.status === "success";
  const submitButtonLabel =
    uploadState.status === "uploading"
      ? "Uploading..."
      : uploadState.status === "processing"
        ? "Processing..."
        : uploadState.status === "success"
          ? "Redirecting..."
          : "Upload media asset";
  const showProgressCard =
    uploadState.status === "uploading" ||
    uploadState.status === "processing" ||
    uploadState.status === "success";

  useDebugFeatureFlags({
    debugExportEnabled: true,
  });

  useDebugRuntimeState("upload/form", {
    status: uploadState.status,
    progressPercent: uploadState.progressPercent,
    uploadedBytes: uploadState.uploadedBytes,
    totalBytes: uploadState.totalBytes,
    message: uploadState.message,
    fieldErrors: uploadState.fieldErrors,
    serverError: uploadState.serverError,
    redirectTriggered: uploadState.redirectTriggered,
    redirectTarget: uploadState.redirectTarget,
    titleInput,
    audioRowCount: audioRows.length,
    subtitleRowCount: subtitleRows.length,
    defaultAudioIndex,
    defaultSubtitleIndex,
    accept: config,
  });

  useEffect(() => {
    if (uploadState.status !== "error") {
      return;
    }

    logDebugEvent({
      level: "warn",
      category: "upload",
      message: uploadState.message || "Upload failed.",
      source: "local_user",
      data: {
        fieldErrors: uploadState.fieldErrors,
        serverError: uploadState.serverError,
      },
    });
  }, [uploadState]);

  function removeAudioRow(index: number) {
    if (isBusy) {
      return;
    }

    setAudioRows((currentRows) => {
      if (currentRows.length === 1) {
        return currentRows;
      }

      const nextRows = currentRows.filter(
        (_, currentIndex) => currentIndex !== index,
      );

      setDefaultAudioIndex((currentDefaultIndex) => {
        if (currentDefaultIndex === index) {
          return 0;
        }

        return currentDefaultIndex > index
          ? currentDefaultIndex - 1
          : currentDefaultIndex;
      });

      logDebugEvent({
        level: "info",
        category: "upload",
        message: "Removed an audio upload row.",
        source: "local_user",
        data: { index },
      });

      return nextRows;
    });
  }

  function removeSubtitleRow(index: number) {
    if (isBusy) {
      return;
    }

    setSubtitleRows((currentRows) => {
      if (currentRows.length === 1) {
        return currentRows;
      }

      const nextRows = currentRows.filter(
        (_, currentIndex) => currentIndex !== index,
      );

      setDefaultSubtitleIndex((currentDefaultIndex) => {
        if (currentDefaultIndex === index) {
          return 0;
        }

        return currentDefaultIndex > index
          ? currentDefaultIndex - 1
          : currentDefaultIndex;
      });

      logDebugEvent({
        level: "info",
        category: "upload",
        message: "Removed a subtitle upload row.",
        source: "local_user",
        data: { index },
      });

      return nextRows;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const estimatedTotalBytes = calculateSelectedFileBytes(formData);

    setUploadState({
      status: "uploading",
      progressPercent: 0,
      uploadedBytes: 0,
      totalBytes: estimatedTotalBytes,
      message:
        estimatedTotalBytes > 0
          ? "Uploading media files to the server..."
          : "Starting upload...",
      fieldErrors: {},
      serverError: null,
      redirectTriggered: false,
      redirectTarget: null,
    });

    logDebugEvent({
      level: "info",
      category: "upload",
      message: "Submitted the upload form.",
      source: "local_user",
      data: {
        titleInput,
        audioRowCount: audioRows.length,
        subtitleRowCount: subtitleRows.length,
        estimatedTotalBytes,
      },
    });

    try {
      const response = await submitUploadRequest(formData, {
        onProcessing: () => {
          setUploadState((currentState) => ({
            ...currentState,
            status: "processing",
            progressPercent: 100,
            uploadedBytes:
              currentState.totalBytes > 0
                ? currentState.totalBytes
                : currentState.uploadedBytes,
            message: "Upload finished. Processing media files on the server...",
            fieldErrors: {},
            serverError: null,
          }));
          logDebugEvent({
            level: "info",
            category: "upload",
            message: "Upload transfer finished. Waiting for server-side processing.",
            source: "local_user",
          });
        },
        onProgress: ({ loaded, total }) => {
          const nextTotal = total > 0 ? total : estimatedTotalBytes;
          const nextProgressPercent =
            nextTotal > 0
              ? Math.max(0, Math.min(100, Math.round((loaded / nextTotal) * 100)))
              : 0;

          setUploadState((currentState) => ({
            ...currentState,
            status: "uploading",
            progressPercent: nextProgressPercent,
            uploadedBytes: loaded,
            totalBytes: nextTotal,
            message: `Uploading media files... ${nextProgressPercent}%`,
            fieldErrors: {},
            serverError: null,
          }));
        },
      });

      setUploadState((currentState) => ({
        ...currentState,
        status: "success",
        progressPercent: 100,
        uploadedBytes:
          currentState.totalBytes > 0
            ? currentState.totalBytes
            : currentState.uploadedBytes,
        message: response.message,
        fieldErrors: {},
        serverError: null,
        redirectTriggered: true,
        redirectTarget: response.redirectTo,
      }));

      logDebugEvent({
        level: "info",
        category: "upload",
        message: "Upload completed successfully. Redirecting to the media details page.",
        source: "local_user",
        data: {
          mediaId: response.mediaId,
          redirectTo: response.redirectTo,
        },
      });

      startTransition(() => {
        router.push(response.redirectTo);
      });
    } catch (error) {
      const uploadError =
        error && typeof error === "object" && "message" in error
          ? (error as UploadRequestError)
          : null;
      const nextFieldErrors = uploadError?.payload?.fieldErrors ?? {};
      const nextServerError =
        Object.keys(nextFieldErrors).length > 0
          ? null
          : uploadError?.message ?? "The upload could not be completed.";

      setUploadState((currentState) => ({
        ...currentState,
        status: "error",
        message: uploadError?.message ?? "The upload could not be completed.",
        fieldErrors: nextFieldErrors,
        serverError: nextServerError,
        redirectTriggered: false,
        redirectTarget: null,
      }));
    }
  }

  return (
    <section className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
        Upload media asset
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">
        Store one MP4 with optional audio and subtitle tracks
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Files are stored locally in the project&apos;s development storage
        directory. Prisma keeps the media asset plus each uploaded audio and
        subtitle track as separate records.
      </p>

      {showProgressCard ? (
        <div className="mt-6 rounded-3xl border border-[#c9d5f0] bg-[#f1f6ff] px-5 py-5 text-sm leading-6 text-[#244f8f]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">{uploadState.message}</p>
            <p className="text-base font-semibold">
              {uploadState.progressPercent}%
            </p>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full rounded-full bg-[#244f8f] transition-[width] duration-200"
              style={{ width: `${uploadState.progressPercent}%` }}
            />
          </div>
          {uploadState.totalBytes > 0 ? (
            <p className="mt-3 text-xs leading-6 text-[#486595]">
              {formatByteCount(uploadState.uploadedBytes)} /{" "}
              {formatByteCount(uploadState.totalBytes)}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void handleSubmit(event)}
        data-debug-upload-form="true"
        className="mt-8 space-y-6"
      >
        {uploadState.status === "error" ? (
          <div className="rounded-3xl border border-[#d7b7a6] bg-[#fff3ec] px-5 py-4 text-sm leading-6 text-[#7f4022]">
            <p className="font-semibold">{uploadState.message}</p>
            {uploadState.serverError ? (
              <p className="mt-2">{uploadState.serverError}</p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-3xl border border-line bg-white/75 p-5">
          <label htmlFor="video-file" className="text-base font-semibold">
            Primary MP4 video
          </label>
          <p className="mt-2 text-sm leading-6 text-muted">
            The shared room timeline is driven by this uploaded MP4.
          </p>
          <input
            id="video-file"
            name="videoFile"
            type="file"
            accept={config.videoAccept}
            required
            disabled={isBusy}
            className="mt-4 block w-full rounded-2xl border border-dashed border-line bg-panel px-4 py-4 text-sm disabled:cursor-not-allowed disabled:text-muted"
          />
          {uploadState.fieldErrors.videoFile ? (
            <p className="mt-3 text-sm font-semibold text-[#7f4022]">
              {uploadState.fieldErrors.videoFile}
            </p>
          ) : null}
        </div>

        <TrackSection
          legend="Audio language tracks"
          description="Optional alternate audio files stay local to each participant. Everyone shares the same playback timeline, but each browser can choose its own audio."
          groupName="audio"
          rows={audioRows}
          accept={config.audioAccept}
          supportedExtensions={acceptedAudioExtensions}
          defaultIndex={defaultAudioIndex}
          disabled={isBusy}
          onDefaultIndexChange={setDefaultAudioIndex}
          onAddRow={() => {
            if (isBusy) {
              return;
            }

            setAudioRows((rows) => [...rows, createTrackRow()]);
            logDebugEvent({
              level: "info",
              category: "upload",
              message: "Added an audio upload row.",
              source: "local_user",
            });
          }}
          onRemoveRow={removeAudioRow}
          fieldError={uploadState.fieldErrors.audioTracks}
        />

        <TrackSection
          legend="Subtitle language tracks"
          description="Upload .vtt directly or .srt for automatic server-side conversion to WebVTT. Other subtitle files are stored and marked for later normalization."
          groupName="subtitle"
          rows={subtitleRows}
          accept={config.subtitleAccept}
          supportedExtensions={acceptedSubtitleExtensions}
          defaultIndex={defaultSubtitleIndex}
          disabled={isBusy}
          onDefaultIndexChange={setDefaultSubtitleIndex}
          onAddRow={() => {
            if (isBusy) {
              return;
            }

            setSubtitleRows((rows) => [...rows, createTrackRow()]);
            logDebugEvent({
              level: "info",
              category: "upload",
              message: "Added a subtitle upload row.",
              source: "local_user",
            });
          }}
          onRemoveRow={removeSubtitleRow}
          fieldError={uploadState.fieldErrors.subtitleTracks}
        />

        <div className="rounded-3xl border border-line bg-white/75 p-5">
          <label htmlFor="media-title" className="text-base font-semibold">
            Media title
          </label>
          <input
            id="media-title"
            name="title"
            type="text"
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            placeholder="Leave blank to derive the title from the MP4 filename"
            disabled={isBusy}
            className="mt-4 min-h-12 w-full rounded-2xl border border-line bg-panel px-4 outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:text-muted"
          />
          <p className="mt-3 text-sm leading-6 text-muted">
            If left blank, the title is generated from the uploaded MP4
            filename.
          </p>
          {uploadState.fieldErrors.title ? (
            <p className="mt-3 text-sm font-semibold text-[#7f4022]">
              {uploadState.fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="rounded-3xl border border-line bg-white/75 p-5">
          <p className="text-base font-semibold">Storage and sync notes</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
            <li>
              Files are stored under `storage/dev/uploads` through a swappable
              storage abstraction.
            </li>
            <li>
              SRT subtitles are converted to WebVTT on upload so browsers can
              render them immediately.
            </li>
            <li>
              Audio and subtitle language choices are local per participant;
              shared playback timing is handled separately at the room layer.
            </li>
          </ul>
        </div>

        <UploadSubmitButton disabled={isBusy} label={submitButtonLabel} />
      </form>
    </section>
  );
}
