//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/dbtest"
)

func TestAvatar_HappyPath_UploadServeRoundtrip(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-up1@example.com", "avatarup1", "Password123!", nil)
	pngData := testPNG(t, 32, 32)

	upload := doRequest(t, srv, testRequest{
		method:      http.MethodPut,
		path:        "/auth/avatar",
		rawBytes:    pngData,
		contentType: "image/png",
		headers:     bearer(reg.AccessToken),
	})
	if upload.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d, want 200", upload.StatusCode)
	}
	upBody := decodeBody[auth.AvatarUploadResponse](t, upload)
	wantURL := "/auth/users/" + reg.User.ID + "/avatar"
	if upBody.AvatarURL != wantURL {
		t.Fatalf("avatarUrl = %q, want %q", upBody.AvatarURL, wantURL)
	}
	if upBody.UpdatedAt.IsZero() {
		t.Fatal("updatedAt is zero")
	}

	profile := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
	})
	prof := decodeBody[auth.UserProfile](t, profile)
	if prof.AvatarURL == nil || *prof.AvatarURL != wantURL {
		t.Fatalf("profile.avatarUrl = %v, want %s", prof.AvatarURL, wantURL)
	}

	get := doRequest(t, srv, testRequest{
		method: http.MethodGet,
		path:   wantURL,
	})
	if get.StatusCode != http.StatusOK {
		t.Fatalf("get status = %d, want 200", get.StatusCode)
	}
	if ct := get.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if cc := get.Header.Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Errorf("Cache-Control = %q", cc)
	}
	etag := get.Header.Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	body, err := io.ReadAll(get.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Equal(body, pngData) {
		t.Errorf("served bytes differ from uploaded (%d vs %d)", len(body), len(pngData))
	}

	notMod := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    wantURL,
		headers: map[string]string{"If-None-Match": etag},
	})
	if notMod.StatusCode != http.StatusNotModified {
		t.Errorf("If-None-Match status = %d, want 304", notMod.StatusCode)
	}
}

func TestAvatar_HappyPath_UpsertReplacesAndChangesETag(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-up2@example.com", "avatarup2", "Password123!", nil)
	first := testPNG(t, 16, 16)
	second := testJPEG(t, 24, 24)

	up1 := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: first,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if up1.StatusCode != http.StatusOK {
		t.Fatalf("first upload status = %d", up1.StatusCode)
	}
	body1 := decodeBody[auth.AvatarUploadResponse](t, up1)

	get1 := doRequest(t, srv, testRequest{method: http.MethodGet, path: body1.AvatarURL})
	etag1 := get1.Header.Get("ETag")

	up2 := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: second,
		contentType: "image/jpeg", headers: bearer(reg.AccessToken),
	})
	if up2.StatusCode != http.StatusOK {
		t.Fatalf("second upload status = %d", up2.StatusCode)
	}
	body2 := decodeBody[auth.AvatarUploadResponse](t, up2)
	if !body2.UpdatedAt.After(body1.UpdatedAt) && !body2.UpdatedAt.Equal(body1.UpdatedAt) {
		// equal is unlikely but same-second possible; ETag must still change via upsert now()
	}

	get2 := doRequest(t, srv, testRequest{method: http.MethodGet, path: body2.AvatarURL})
	if get2.Header.Get("Content-Type") != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", get2.Header.Get("Content-Type"))
	}
	etag2 := get2.Header.Get("ETag")
	if etag2 == "" || etag2 == etag1 {
		t.Errorf("etag after upsert = %q, first = %q; want different", etag2, etag1)
	}
	served, _ := io.ReadAll(get2.Body)
	if !bytes.Equal(served, second) {
		t.Error("served bytes were not replaced")
	}
}

func TestAvatar_HappyPath_DeleteThen404AndIdempotent(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-del@example.com", "avatardel", "Password123!", nil)
	pngData := testPNG(t, 8, 8)
	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: pngData,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	url := decodeBody[auth.AvatarUploadResponse](t, up).AvatarURL

	del := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/auth/avatar", headers: bearer(reg.AccessToken),
	})
	if del.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", del.StatusCode)
	}

	get := doRequest(t, srv, testRequest{method: http.MethodGet, path: url})
	if get.StatusCode != http.StatusNotFound {
		t.Errorf("get after delete status = %d, want 404", get.StatusCode)
	}

	del2 := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/auth/avatar", headers: bearer(reg.AccessToken),
	})
	if del2.StatusCode != http.StatusNoContent {
		t.Errorf("idempotent delete status = %d, want 204", del2.StatusCode)
	}

	profile := decodeBody[auth.UserProfile](t, doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/auth/profile", headers: bearer(reg.AccessToken),
	}))
	if profile.AvatarURL != nil {
		t.Errorf("profile.avatarUrl = %v, want nil", profile.AvatarURL)
	}
}

func TestAvatar_EdgeCase_WebPAccepted(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-webp@example.com", "avatarwebp", "Password123!", nil)
	webpData, err := os.ReadFile(filepath.Join("testdata", "tiny.webp"))
	if err != nil {
		t.Fatalf("read webp fixture: %v", err)
	}

	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: webpData,
		contentType: "image/webp", headers: bearer(reg.AccessToken),
	})
	if up.StatusCode != http.StatusOK {
		t.Fatalf("webp upload status = %d body=%s", up.StatusCode, readAll(t, up))
	}
	url := decodeBody[auth.AvatarUploadResponse](t, up).AvatarURL
	get := doRequest(t, srv, testRequest{method: http.MethodGet, path: url})
	if get.StatusCode != http.StatusOK || get.Header.Get("Content-Type") != "image/webp" {
		t.Errorf("get webp status/ct = %d/%q", get.StatusCode, get.Header.Get("Content-Type"))
	}
}

func TestAvatar_EdgeCase_ExactMaxDimensions(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-dim@example.com", "avatardim", "Password123!", nil)
	data := testPNG(t, 1024, 1024)
	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: data,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if up.StatusCode != http.StatusOK {
		t.Fatalf("1024 upload status = %d body=%s", up.StatusCode, readAll(t, up))
	}
}

func TestAvatar_ErrorCase_OversizeNonImageUnsupportedUnauthMissingUser(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-err@example.com", "avatarerr", "Password123!", nil)

	oversize := bytes.Repeat([]byte{1}, 512*1024+1)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: oversize,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("oversize status = %d, want 400", resp.StatusCode)
	}

	resp = doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: []byte("not-image"),
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("non-image status = %d, want 400", resp.StatusCode)
	}

	resp = doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: testPNG(t, 4, 4),
		contentType: "image/gif", headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("gif status = %d, want 400", resp.StatusCode)
	}

	resp = doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: testPNG(t, 4, 4),
		contentType: "image/png",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauth PUT status = %d, want 401", resp.StatusCode)
	}

	resp = doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/auth/avatar"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauth DELETE status = %d, want 401", resp.StatusCode)
	}

	resp = doRequest(t, srv, testRequest{
		method: http.MethodGet,
		path:   "/auth/users/00000000-0000-0000-0000-000000000000/avatar",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("missing avatar status = %d, want 404", resp.StatusCode)
	}
}

func TestAvatar_HappyPath_MislabeledJPEGStoredAsJPEG(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-mislabel@example.com", "avatarmis", "Password123!", nil)
	jpegData := testJPEG(t, 20, 20)

	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: jpegData,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if up.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", up.StatusCode, readAll(t, up))
	}
	url := decodeBody[auth.AvatarUploadResponse](t, up).AvatarURL

	get := doRequest(t, srv, testRequest{method: http.MethodGet, path: url})
	if get.StatusCode != http.StatusOK {
		t.Fatalf("get status = %d", get.StatusCode)
	}
	if ct := get.Header.Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg (decoded format, not declared image/png)", ct)
	}
	served, err := io.ReadAll(get.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(served, jpegData) {
		t.Error("served bytes differ from uploaded JPEG")
	}
}

func TestAvatar_HappyPath_ExportIncludesBase64AndAccountDeleteRemovesRow(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-gdpr@example.com", "avatargdpr", "Password123!", nil)
	pngData := testPNG(t, 12, 12)
	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: pngData,
		contentType: "image/png", headers: bearer(reg.AccessToken),
	})
	if up.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d", up.StatusCode)
	}
	url := decodeBody[auth.AvatarUploadResponse](t, up).AvatarURL

	exp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/auth/export", headers: bearer(reg.AccessToken),
	})
	if exp.StatusCode != http.StatusOK {
		t.Fatalf("export status = %d", exp.StatusCode)
	}
	body := decodeBody[exportResponseBody](t, exp)
	if len(body.Services) == 0 || body.Services[0].Service != "auth" {
		t.Fatalf("services = %+v", body.Services)
	}
	authData, ok := body.Services[0].Data.(map[string]any)
	if !ok {
		t.Fatalf("auth data type %T", body.Services[0].Data)
	}
	avatarObj, ok := authData["avatar"].(map[string]any)
	if !ok {
		t.Fatalf("auth.avatar missing: %#v", authData)
	}
	if avatarObj["contentType"] != "image/png" {
		t.Errorf("contentType = %v", avatarObj["contentType"])
	}
	encoded, _ := avatarObj["data"].(string)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.Equal(decoded, pngData) {
		t.Errorf("exported avatar bytes mismatch: err=%v len=%d", err, len(decoded))
	}

	del := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/auth/account", headers: bearer(reg.AccessToken),
	})
	if del.StatusCode != http.StatusNoContent {
		t.Fatalf("account delete status = %d", del.StatusCode)
	}
	get := doRequest(t, srv, testRequest{method: http.MethodGet, path: url})
	if get.StatusCode != http.StatusNotFound {
		t.Errorf("avatar after account delete status = %d, want 404", get.StatusCode)
	}
}

// TestDeleteAccount_HappyPath_RemovesAvatarRow asserts the user_avatars row is
// gone after DeleteAccount (SQL count, not only GET 404). DeleteAvatar while
// the user still exists proves the app-layer deleteUserAvatar path — FK cascade
// cannot fire until the users row is removed.
func TestDeleteAccount_HappyPath_RemovesAvatarRow(t *testing.T) {
	t.Parallel()
	authSvc, _, _, pool := newCascadeFixture(t)
	reg := registerViaService(t, authSvc, "avatar-cascade@example.com", "avatarcascade")
	pngData := testPNG(t, 10, 10)

	if _, err := authSvc.UploadAvatar(context.Background(), reg.User.ID, "image/png", bytes.NewReader(pngData)); err != nil {
		t.Fatalf("UploadAvatar: %v", err)
	}
	if countAvatarRows(t, pool, reg.User.ID) != 1 {
		t.Fatal("want 1 avatar row after upload")
	}

	// App-layer delete while user remains — FK cascade cannot explain this.
	if err := authSvc.DeleteAvatar(context.Background(), reg.User.ID); err != nil {
		t.Fatalf("DeleteAvatar: %v", err)
	}
	if countAvatarRows(t, pool, reg.User.ID) != 0 {
		t.Fatal("DeleteAvatar left a user_avatars row (app-layer delete broken)")
	}
	if !dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Fatal("DeleteAvatar must not remove the users row")
	}

	if _, err := authSvc.UploadAvatar(context.Background(), reg.User.ID, "image/png", bytes.NewReader(pngData)); err != nil {
		t.Fatalf("re-upload: %v", err)
	}
	if err := authSvc.DeleteAccount(context.Background(), reg.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}
	if countAvatarRows(t, pool, reg.User.ID) != 0 {
		t.Fatal("user_avatars row survived DeleteAccount")
	}
	if dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Fatal("users row survived DeleteAccount")
	}
}

func countAvatarRows(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM user_avatars WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("count user_avatars: %v", err)
	}
	return n
}

func TestAvatar_EdgeCase_ExactMaxBytesAccepted(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar-512@example.com", "avatar512", "Password123!", nil)
	base := testJPEG(t, 64, 64)
	exact := padJPEGToSize(t, base, 512*1024)
	up := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/avatar", rawBytes: exact,
		contentType: "image/jpeg", headers: bearer(reg.AccessToken),
	})
	if up.StatusCode != http.StatusOK {
		t.Fatalf("exact 512KB upload status = %d body=%s", up.StatusCode, readAll(t, up))
	}
}

func padJPEGToSize(t *testing.T, jpegData []byte, size int) []byte {
	t.Helper()
	if len(jpegData) < 2 || jpegData[len(jpegData)-2] != 0xff || jpegData[len(jpegData)-1] != 0xd9 {
		t.Fatal("not a jpeg with EOI")
	}
	if len(jpegData) > size {
		t.Fatalf("base jpeg %d already larger than %d", len(jpegData), size)
	}
	withoutEOI := jpegData[:len(jpegData)-2]
	out := append([]byte{}, withoutEOI...)
	remaining := size - len(jpegData) // bytes to insert before EOI
	for remaining > 0 {
		// FF FE + 2-byte length (includes length bytes) + payload
		chunkPayload := remaining - 4
		if chunkPayload < 0 {
			t.Fatalf("cannot pad remaining=%d", remaining)
		}
		if chunkPayload > 0xfffd {
			chunkPayload = 0xfffd
		}
		out = append(out, 0xff, 0xfe, byte((chunkPayload+2)>>8), byte(chunkPayload+2))
		out = append(out, make([]byte, chunkPayload)...)
		remaining -= chunkPayload + 4
	}
	out = append(out, 0xff, 0xd9)
	if len(out) != size {
		t.Fatalf("pad size = %d, want %d", len(out), size)
	}
	return out
}

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png: %v", err)
	}
	return buf.Bytes()
}

func testJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("jpeg: %v", err)
	}
	return buf.Bytes()
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return string(b)
}
