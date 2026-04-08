import "server-only";

export type SaveFileInput = {
  directory: string;
  originalFilename: string;
  bytes: Uint8Array;
  contentType: string;
};

export type StoredFile = {
  relativePath: string;
  absolutePath: string;
  contentType: string;
  byteLength: number;
  originalFilename: string;
};

export interface FileStorage {
  saveFile(input: SaveFileInput): Promise<StoredFile>;
  removeDirectory(relativeDirectory: string): Promise<void>;
}
