import { mediaHref } from "@/lib/routes";
import {
  createUploadedMediaAsset,
  validateUploadSubmission,
} from "@/server/media-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildJsonHeaders() {
  return {
    "cache-control": "no-store",
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const validationResult = validateUploadSubmission(formData);

  if (!validationResult.success) {
    return Response.json(
      {
        ok: false,
        message: validationResult.state.message,
        fieldErrors: validationResult.state.fieldErrors,
        values: validationResult.state.values,
      },
      {
        headers: buildJsonHeaders(),
        status: 400,
      },
    );
  }

  try {
    const mediaAsset = await createUploadedMediaAsset(validationResult.data);

    return Response.json(
      {
        ok: true,
        mediaId: mediaAsset.id,
        redirectTo: mediaHref(mediaAsset.id),
        message: "Upload complete. Opening the media details page.",
      },
      {
        headers: buildJsonHeaders(),
      },
    );
  } catch (error) {
    console.error("Failed to upload media asset", error);

    return Response.json(
      {
        ok: false,
        message:
          "The upload could not be completed. Check the database connection and try again.",
        fieldErrors: {},
        values: {
          title: validationResult.data.titleInput,
        },
      },
      {
        headers: buildJsonHeaders(),
        status: 500,
      },
    );
  }
}
