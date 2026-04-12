export type CreateRoomRequest = {
  catalogMovieId?: string | null;
  mediaAssetId?: string | null;
};

export type CreateRoomSuccessResponse = {
  ok: true;
  sourceType: "catalog_movie" | "media_asset";
  catalogMovieId: string | null;
  mediaAssetId: string;
  roomId: string;
  sharePath: string;
  shareUrl: string;
  redirectTo: string;
  createdAt: string;
};

export type CreateRoomFailureResponse = {
  ok: false;
  errorCode: string;
  message: string;
  catalogMovieId: string | null;
  mediaAssetId: string | null;
  createdAt: string;
};

export type CreateRoomResponse =
  | CreateRoomSuccessResponse
  | CreateRoomFailureResponse;
