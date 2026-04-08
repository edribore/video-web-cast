"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { uploadMediaAction } from "@/app/upload/actions";
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
  initialUploadFormState,
  type UploadScaffoldConfig,
} from "@/types/upload";

type UploadFormScaffoldProps = {
  config: UploadScaffoldConfig;
};

type TrackRow = {
  id: string;
};

function createTrackRow(): TrackRow {
  return {
    id: createSafeId("track"),
  };
}

function UploadSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-[#d9c4b8]"
    >
      {pending ? "Uploading..." : "Upload media"}
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
    <fieldset className="rounded-3xl border border-line bg-white/75 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <legend className="text-base font-semibold">{legend}</legend>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAddRow}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent-strong"
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
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition hover:border-accent hover:text-accent-strong"
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
                  className="mt-2 block w-full rounded-2xl border border-dashed border-line bg-white px-4 py-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold">
                Language code
                <input
                  name={languageFieldName}
                  type="text"
                  placeholder="en"
                  className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-white px-4 outline-none transition focus:border-accent"
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
                  className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-white px-4 outline-none transition focus:border-accent"
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
  const [state, formAction] = useActionState(
    uploadMediaAction,
    initialUploadFormState,
  );
  const [titleInput, setTitleInput] = useState(state.values.title);
  const [audioRows, setAudioRows] = useState<TrackRow[]>(() => [createTrackRow()]);
  const [subtitleRows, setSubtitleRows] = useState<TrackRow[]>(() => [
    createTrackRow(),
  ]);
  const [defaultAudioIndex, setDefaultAudioIndex] = useState(0);
  const [defaultSubtitleIndex, setDefaultSubtitleIndex] = useState(0);

  useDebugFeatureFlags({
    debugExportEnabled: true,
  });

  useDebugRuntimeState("upload/form", {
    status: state.status,
    message: state.message,
    fieldErrors: state.fieldErrors,
    titleInput,
    audioRowCount: audioRows.length,
    subtitleRowCount: subtitleRows.length,
    defaultAudioIndex,
    defaultSubtitleIndex,
    accept: config,
  });

  useEffect(() => {
    if (state.status !== "error") {
      return;
    }

    logDebugEvent({
      level: "warn",
      category: "upload",
      message: state.message || "Upload validation failed.",
      source: "local_user",
      data: state.fieldErrors,
    });
  }, [state.fieldErrors, state.message, state.status]);

  function removeAudioRow(index: number) {
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

  return (
    <section className="rounded-[2rem] border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(42,31,22,0.08)]">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
        Upload media
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">
        Store one MP4 with optional audio and subtitle tracks
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Files are stored locally in the project&apos;s development storage
        directory. Prisma keeps the media asset plus each uploaded audio and
        subtitle language track as separate records.
      </p>

      <form
        action={formAction}
        onSubmit={() => {
          logDebugEvent({
            level: "info",
            category: "upload",
            message: "Submitted the upload form.",
            source: "local_user",
            data: {
              titleInput,
              audioRowCount: audioRows.length,
              subtitleRowCount: subtitleRows.length,
            },
          });
        }}
        data-debug-upload-form="true"
        className="mt-8 space-y-6"
      >
        {state.status === "error" ? (
          <div className="rounded-3xl border border-[#d7b7a6] bg-[#fff3ec] px-5 py-4 text-sm leading-6 text-[#7f4022]">
            <p className="font-semibold">{state.message}</p>
            <p className="mt-2">
              If the request included files, reselect them before submitting
              again.
            </p>
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
            className="mt-4 block w-full rounded-2xl border border-dashed border-line bg-panel px-4 py-4 text-sm"
          />
          {state.fieldErrors.videoFile ? (
            <p className="mt-3 text-sm font-semibold text-[#7f4022]">
              {state.fieldErrors.videoFile}
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
          onDefaultIndexChange={setDefaultAudioIndex}
          onAddRow={() => {
            setAudioRows((rows) => [...rows, createTrackRow()]);
            logDebugEvent({
              level: "info",
              category: "upload",
              message: "Added an audio upload row.",
              source: "local_user",
            });
          }}
          onRemoveRow={removeAudioRow}
          fieldError={state.fieldErrors.audioTracks}
        />

        <TrackSection
          legend="Subtitle language tracks"
          description="Upload .vtt directly or .srt for automatic server-side conversion to WebVTT. Other subtitle files are stored and marked for later normalization."
          groupName="subtitle"
          rows={subtitleRows}
          accept={config.subtitleAccept}
          supportedExtensions={acceptedSubtitleExtensions}
          defaultIndex={defaultSubtitleIndex}
          onDefaultIndexChange={setDefaultSubtitleIndex}
          onAddRow={() => {
            setSubtitleRows((rows) => [...rows, createTrackRow()]);
            logDebugEvent({
              level: "info",
              category: "upload",
              message: "Added a subtitle upload row.",
              source: "local_user",
            });
          }}
          onRemoveRow={removeSubtitleRow}
          fieldError={state.fieldErrors.subtitleTracks}
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
            className="mt-4 min-h-12 w-full rounded-2xl border border-line bg-panel px-4 outline-none transition focus:border-accent"
          />
          <p className="mt-3 text-sm leading-6 text-muted">
            If left blank, the title is generated from the uploaded MP4
            filename.
          </p>
          {state.fieldErrors.title ? (
            <p className="mt-3 text-sm font-semibold text-[#7f4022]">
              {state.fieldErrors.title}
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

        <UploadSubmitButton />
      </form>
    </section>
  );
}
