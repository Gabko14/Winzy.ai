package auth

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func TestValidateAvatarBytes_HappyPath_AcceptsJPEGPNG(t *testing.T) {
	t.Parallel()
	pngData := mustPNG(t, 8, 8)
	data, stored, err := validateAvatarBytes("image/png", bytes.NewReader(pngData))
	if err != nil {
		t.Fatalf("png: %v", err)
	}
	if stored != "image/png" || !bytes.Equal(data, pngData) {
		t.Fatalf("png stored/type = %q len=%d", stored, len(data))
	}
	jpegData := mustJPEG(t, 8, 8, 90)
	_, stored, err = validateAvatarBytes("image/jpeg", bytes.NewReader(jpegData))
	if err != nil {
		t.Fatalf("jpeg: %v", err)
	}
	if stored != "image/jpeg" {
		t.Fatalf("jpeg stored type = %q", stored)
	}
}

func TestValidateAvatarBytes_HappyPath_DeclaredTypeIgnoredForStoredType(t *testing.T) {
	t.Parallel()
	jpegData := mustJPEG(t, 8, 8, 90)
	_, stored, err := validateAvatarBytes("image/png", bytes.NewReader(jpegData))
	if err != nil {
		t.Fatalf("mismatched header: %v", err)
	}
	if stored != "image/jpeg" {
		t.Fatalf("stored type = %q, want image/jpeg (decoded truth)", stored)
	}
}

func TestValidateAvatarBytes_EdgeCase_ExactMaxDimensionsAccepted(t *testing.T) {
	t.Parallel()
	data := mustPNG(t, maxAvatarDim, maxAvatarDim)
	if _, _, err := validateAvatarBytes("image/png", bytes.NewReader(data)); err != nil {
		t.Fatalf("1024x1024 png: %v", err)
	}
}

func TestValidateAvatarBytes_ErrorCase_OversizeRejected(t *testing.T) {
	t.Parallel()
	oversized := bytes.Repeat([]byte{0x01}, maxAvatarBytes+1)
	_, _, err := validateAvatarBytes("image/png", bytes.NewReader(oversized))
	verrs := mustValidation(t, err)
	if !strings.Contains(strings.Join(verrs["avatar"], " "), "512KB") {
		t.Errorf("errors = %v, want 512KB message", verrs)
	}
}

func TestValidateAvatarBytes_ErrorCase_UnsupportedContentType(t *testing.T) {
	t.Parallel()
	_, _, err := validateAvatarBytes("image/gif", bytes.NewReader(mustPNG(t, 4, 4)))
	verrs := mustValidation(t, err)
	if len(verrs["avatar"]) == 0 {
		t.Fatal("want avatar validation error")
	}
}

func TestValidateAvatarBytes_ErrorCase_NonImageBytes(t *testing.T) {
	t.Parallel()
	_, _, err := validateAvatarBytes("image/png", strings.NewReader("not-an-image"))
	verrs := mustValidation(t, err)
	if len(verrs["avatar"]) == 0 {
		t.Fatal("want avatar validation error")
	}
}

func TestValidateAvatarBytes_ErrorCase_DimensionsTooLarge(t *testing.T) {
	t.Parallel()
	data := mustPNG(t, maxAvatarDim+1, 10)
	_, _, err := validateAvatarBytes("image/png", bytes.NewReader(data))
	verrs := mustValidation(t, err)
	if !strings.Contains(strings.Join(verrs["avatar"], " "), "1024") {
		t.Errorf("errors = %v, want dimension message", verrs)
	}
}

func mustValidation(t *testing.T, err error) validationErrors {
	t.Helper()
	if err == nil {
		t.Fatal("want validation error, got nil")
	}
	var verrs validationErrors
	if !errors.As(err, &verrs) {
		t.Fatalf("err = %v, want validationErrors", err)
	}
	return verrs
}

func mustPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func mustJPEG(t *testing.T, w, h, quality int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
}
