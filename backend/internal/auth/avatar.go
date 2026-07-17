package auth

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"

	_ "golang.org/x/image/webp"
)

const (
	maxAvatarBytes   = 512 * 1024
	maxAvatarDim     = 1024
	avatarServingFmt = "/auth/users/%s/avatar"
)

var allowedAvatarContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

var decodedFormatContentType = map[string]string{
	"jpeg": "image/jpeg",
	"png":  "image/png",
	"webp": "image/webp",
}

func avatarServingPath(userID string) string {
	return fmt.Sprintf(avatarServingFmt, userID)
}

// validateAvatarBytes checks the declared Content-Type against the allowlist,
// then size/dimensions/decodability. On success it returns the raw bytes and
// the Content-Type derived from the DECODED format (not the declared header),
// so a mislabeled but valid image is stored/served truthfully.
func validateAvatarBytes(contentType string, r io.Reader) ([]byte, string, error) {
	if !allowedAvatarContentTypes[contentType] {
		return nil, "", validationErrors{"avatar": []string{"Content-Type must be image/jpeg, image/png, or image/webp."}}
	}

	limited := io.LimitReader(r, int64(maxAvatarBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", fmt.Errorf("auth: reading avatar body: %w", err)
	}
	if len(data) == 0 {
		return nil, "", validationErrors{"avatar": []string{"Avatar body is required."}}
	}
	if len(data) > maxAvatarBytes {
		return nil, "", validationErrors{"avatar": []string{"Avatar must be at most 512KB."}}
	}

	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", validationErrors{"avatar": []string{"Avatar must be a valid image."}}
	}
	storedType, ok := decodedFormatContentType[format]
	if !ok {
		return nil, "", validationErrors{"avatar": []string{"Avatar must be a valid JPEG, PNG, or WebP image."}}
	}
	if cfg.Width > maxAvatarDim || cfg.Height > maxAvatarDim {
		return nil, "", validationErrors{"avatar": []string{"Avatar dimensions must be at most 1024x1024."}}
	}

	// Full decode proves the payload is a complete, decodable image (Config
	// alone can accept truncated headers for some formats).
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, "", validationErrors{"avatar": []string{"Avatar must be a valid image."}}
	}

	return data, storedType, nil
}
