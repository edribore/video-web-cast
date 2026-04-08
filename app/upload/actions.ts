"use server";

import { redirect } from "next/navigation";
import { mediaHref } from "@/lib/routes";
import { createUploadedMediaAsset, validateUploadSubmission } from "@/server/media-library";
import type { UploadFormState } from "@/types/upload";

export async function uploadMediaAction(
  _previousState: UploadFormState,
  formData: FormData,
): Promise<UploadFormState> {
  const validationResult = validateUploadSubmission(formData);

  if (!validationResult.success) {
    return validationResult.state;
  }

  let mediaAsset;

  try {
    mediaAsset = await createUploadedMediaAsset(validationResult.data);
  } catch (error) {
    console.error("Failed to upload media asset", error);

    return {
      status: "error",
      message: "The upload could not be completed. Check the database connection and try again.",
      fieldErrors: {},
      values: {
        title: validationResult.data.titleInput,
      },
    };
  }

  redirect(mediaHref(mediaAsset.id));
}
