import axios, { type AxiosProgressEvent } from "axios";
import { apiClient } from "@/lib/api/client";
import type { Asset } from "@earth-online/shared";

// --- Asset API ---

/** Asset types that can be presigned for direct upload. */
export type UploadableAssetType = "image" | "audio";

export interface PresignUploadResult {
  upload_url: string;
  storage_key: string;
  asset_type: string;
  mime_type: string;
  expires_in: number;
}

export interface CreateAssetInput {
  storage_key: string;
  url: string;
  mime_type: string;
  asset_type: string;
  size_bytes?: number;
  experience_id?: string;
  visibility?: "public" | "friends" | "private";
}

/**
 * Request a presigned upload URL from the API. The returned `upload_url` is
 * meant to be used as the target of a PUT request carrying the raw file bytes.
 */
export async function presignUpload(
  assetType: UploadableAssetType,
  mimeType: string,
): Promise<PresignUploadResult> {
  const res = await apiClient.post<{ data: PresignUploadResult }>("/assets/presign", {
    asset_type: assetType,
    mime_type: mimeType,
  });
  return res.data.data;
}

/**
 * Upload a file directly to object storage using a presigned PUT URL.
 * The `onProgress` callback is invoked as bytes are transferred so the UI can
 * render a progress indicator.
 */
export async function uploadFileToStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await axios.put(uploadUrl, file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
}

/**
 * Persist the asset record after a successful direct upload.
 */
export async function createAsset(data: CreateAssetInput): Promise<Asset> {
  const res = await apiClient.post<{ data: Asset }>("/assets", data);
  return res.data.data;
}

/**
 * Fetch a single asset by id.
 */
export async function getAsset(id: string): Promise<Asset> {
  const res = await apiClient.get<{ data: Asset }>(`/assets/${id}`);
  return res.data.data;
}
