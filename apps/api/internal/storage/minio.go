package storage

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// presignExpiry is how long a presigned URL remains valid.
const presignExpiry = 15 * time.Minute

// MinIOClient wraps the minio-go client and the target bucket so that
// handlers can request presigned upload/download URLs without dealing with
// low-level details.
type MinIOClient struct {
	client   *minio.Client
	bucket   string
	endpoint string
	logger   *slog.Logger
}

// NewMinIOClient creates a MinIOClient for the given endpoint and credentials.
// endpoint should include the scheme, e.g. "http://localhost:9000".
// If the bucket does not exist yet it is created with a best-effort call so
// that local development works out of the box.
func NewMinIOClient(endpoint, accessKey, secretKey, bucket string, logger *slog.Logger) (*MinIOClient, error) {
	if logger == nil {
		logger = slog.Default()
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid minio endpoint %q: %w", endpoint, err)
	}

	useSSL := u.Scheme == "https"
	host := u.Host

	client, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ensure the bucket exists; ignore the "already owned by you" error so that
	// multiple instances booting at the same time don't race.
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("check minio bucket: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("create minio bucket %q: %w", bucket, err)
		}
		logger.Info("minio bucket created", "bucket", bucket)
	}

	logger.Info("minio client ready", "endpoint", host, "bucket", bucket, "ssl", useSSL)

	return &MinIOClient{
		client:   client,
		bucket:   bucket,
		endpoint: host,
		logger:   logger,
	}, nil
}

// Bucket returns the configured bucket name.
func (m *MinIOClient) Bucket() string {
	return m.bucket
}

// PresignUpload signs a PUT URL that the client can use to upload an object
// directly to MinIO. The URL expires after 15 minutes.
func (m *MinIOClient) PresignUpload(ctx context.Context, key string, contentType string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("storage key is required")
	}

	presignedURL, err := m.client.PresignedPutObject(ctx, m.bucket, key, presignExpiry)
	if err != nil {
		return "", fmt.Errorf("presign upload for %q: %w", key, err)
	}

	// minio-go does not let us inject the Content-Type header directly into the
	// signature for a PUT presign, but exposing the recommended content type via
	// a query param keeps the contract explicit for clients that want to set it.
	if contentType != "" {
		q := presignedURL.Query()
		q.Set("content-type", contentType)
		presignedURL.RawQuery = q.Encode()
	}

	return presignedURL.String(), nil
}

// PresignDownload signs a GET URL that the client can use to download an object.
// The URL expires after 15 minutes.
func (m *MinIOClient) PresignDownload(ctx context.Context, key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("storage key is required")
	}

	presignedURL, err := m.client.PresignedGetObject(ctx, m.bucket, key, presignExpiry, nil)
	if err != nil {
		return "", fmt.Errorf("presign download for %q: %w", key, err)
	}

	return presignedURL.String(), nil
}
