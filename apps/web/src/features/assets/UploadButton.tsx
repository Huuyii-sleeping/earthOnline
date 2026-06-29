import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createAsset,
  presignUpload,
  uploadFileToStorage,
} from "@/features/assets/assetApi";
import type { Asset } from "@earth-online/shared";

export interface UploadButtonProps {
  /** Optional experience to attach the asset to. */
  experienceId?: string;
  /** Called once the asset record has been created on the backend. */
  onUploaded?: (asset: Asset) => void;
  /** Maximum file size in bytes. Defaults to 10MB. */
  maxSizeBytes?: number;
  className?: string;
}

type UploadStatus = "idle" | "uploading" | "done" | "error";

const ACCEPTED_MIME_PREFIX = "image/";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function UploadButton({
  experienceId,
  onUploaded,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  className,
}: UploadButtonProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  // Keep the latest preview URL in a ref so cleanup always revokes the right one.
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Revoke object URLs to avoid leaking memory.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const resetState = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setError(null);
    setAsset(null);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    setPreviewUrl(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith(ACCEPTED_MIME_PREFIX)) {
        setStatus("error");
        setError("仅支持上传图片文件（PNG / JPG / GIF / WEBP）。");
        return;
      }
      if (file.size > maxSizeBytes) {
        setStatus("error");
        setError(
          `文件过大，最大支持 ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB。`,
        );
        return;
      }

      // Local preview.
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      setStatus("uploading");
      setProgress(0);
      setError(null);
      setAsset(null);

      try {
        // 1. Presign.
        const presigned = await presignUpload("image", file.type || "image/png");

        // 2. PUT to object storage.
        await uploadFileToStorage(presigned.upload_url, file, (percent) => {
          setProgress(percent);
        });

        // 3. Create the asset record. The stored url is the stable object URL
        //    (without signature); the backend mints fresh download URLs on read.
        const objectUrlWithoutSignature = presigned.upload_url.split("?")[0];
        const created = await createAsset({
          storage_key: presigned.storage_key,
          url: objectUrlWithoutSignature,
          mime_type: file.type || "image/png",
          asset_type: "image",
          size_bytes: file.size,
          experience_id: experienceId,
        });

        setAsset(created);
        setStatus("done");
        setProgress(100);
        onUploaded?.(created);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "上传失败，请重试。");
      }
    },
    [experienceId, maxSizeBytes, onUploaded],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current -= 1;
      if (dragDepthRef.current <= 0) {
        dragDepthRef.current = 0;
        setIsDragging(false);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const isUploading = status === "uploading";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleInputChange}
        disabled={isUploading}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging && "border-primary bg-primary/5",
          isUploading && "pointer-events-none opacity-70",
        )}
      >
        {previewUrl ? (
          <div className="flex w-full flex-col items-center gap-3">
            <img
              src={previewUrl}
              alt="上传预览"
              className="max-h-40 w-auto max-w-full rounded-md border object-contain"
            />
            <p className="text-xs text-muted-foreground">{asset ? "上传完成" : "准备上传..."}</p>
          </div>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm">
              <span className="font-medium text-primary">点击上传</span>
              <span className="text-muted-foreground"> 或拖拽图片到此处</span>
            </div>
            <p className="text-xs text-muted-foreground">
              PNG / JPG / GIF / WEBP，最大 {(maxSizeBytes / 1024 / 1024).toFixed(0)}MB
            </p>
          </>
        )}
      </div>

      {isUploading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>上传中 {progress}%</span>
          <div className="ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {status === "done" && asset && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{asset.storage_key.split("/").pop()}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(event) => {
              event.stopPropagation();
              resetState();
            }}
            aria-label="移除已上传图片"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {status === "error" && error && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="truncate">{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetState}
            className="h-6 px-2 text-destructive"
          >
            重试
          </Button>
        </div>
      )}
    </div>
  );
}

export default UploadButton;
