export type UploadScaffoldConfig = {
  videoAccept: string;
  audioAccept: string;
  subtitleAccept: string;
  allowMultipleAudioTracks: boolean;
  allowMultipleSubtitles: boolean;
};

export type UploadFormValues = {
  title: string;
};

export type UploadFieldErrors = Partial<
  Record<"title" | "videoFile" | "audioTracks" | "subtitleTracks", string>
>;

export type UploadFormState = {
  status: "idle" | "error";
  message: string;
  fieldErrors: UploadFieldErrors;
  values: UploadFormValues;
};

export type UploadClientStatus =
  | "idle"
  | "uploading"
  | "processing"
  | "success"
  | "error";

export type UploadClientState = {
  status: UploadClientStatus;
  progressPercent: number;
  uploadedBytes: number;
  totalBytes: number;
  message: string;
  fieldErrors: UploadFieldErrors;
  serverError: string | null;
  redirectTriggered: boolean;
  redirectTarget: string | null;
};

export type UploadApiSuccessResponse = {
  ok: true;
  mediaId: string;
  redirectTo: string;
  message: string;
};

export type UploadApiFailureResponse = {
  ok: false;
  message: string;
  fieldErrors: UploadFieldErrors;
  values: UploadFormValues;
};

export type UploadApiResponse =
  | UploadApiSuccessResponse
  | UploadApiFailureResponse;

export const initialUploadFormState: UploadFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
  values: {
    title: "",
  },
};

export const initialUploadClientState: UploadClientState = {
  status: "idle",
  progressPercent: 0,
  uploadedBytes: 0,
  totalBytes: 0,
  message: "",
  fieldErrors: {},
  serverError: null,
  redirectTriggered: false,
  redirectTarget: null,
};
