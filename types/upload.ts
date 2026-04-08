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

export type UploadFormState = {
  status: "idle" | "error";
  message: string;
  fieldErrors: Partial<
    Record<"title" | "videoFile" | "audioTracks" | "subtitleTracks", string>
  >;
  values: UploadFormValues;
};

export const initialUploadFormState: UploadFormState = {
  status: "idle",
  message: "",
  fieldErrors: {},
  values: {
    title: "",
  },
};
