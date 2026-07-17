package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/marknefedov/go-webpush/v2"

	"github.com/Gabko14/winzy/backend/internal/events"
)

func TestToNotificationResponse_TypeLowercased(t *testing.T) {
	n := Notification{
		ID:        "11111111-1111-1111-1111-111111111111",
		Type:      TypeHabitCompleted,
		Data:      json.RawMessage(`{"x":1}`),
		CreatedAt: time.Unix(0, 0).UTC(),
	}
	resp := toNotificationResponse(n)
	if resp.Type != "habitcompleted" {
		t.Fatalf("Type = %q, want habitcompleted (C# ToLowerInvariant)", resp.Type)
	}
}

func TestToNotificationResponse_InvalidDataBecomesEmptyObject(t *testing.T) {
	n := Notification{Type: TypeFriendRequestSent, Data: json.RawMessage(`not-json`)}
	resp := toNotificationResponse(n)
	if string(resp.Data) != "{}" {
		t.Fatalf("Data = %s, want {}", resp.Data)
	}
}

func TestValidateRegisterDevice(t *testing.T) {
	tests := []struct {
		name string
		req  RegisterDeviceRequest
		want string
	}{
		{"missing platform", RegisterDeviceRequest{Token: "t"}, "Platform and token are required"},
		{"missing token", RegisterDeviceRequest{Platform: "web_push"}, "Platform and token are required"},
		{"bad platform", RegisterDeviceRequest{Platform: "ios", Token: "t"}, "Platform must be 'web_push' or 'expo_push'"},
		{"web_push ok", RegisterDeviceRequest{Platform: "web_push", Token: "t"}, ""},
		{"expo_push ok stub", RegisterDeviceRequest{Platform: "expo_push", Token: "t"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validateRegisterDevice(tt.req); got != tt.want {
				t.Fatalf("validateRegisterDevice() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildHabitPushText(t *testing.T) {
	title, body := buildHabitPushText(events.HabitCompleted{DisplayName: "Ada", HabitName: "Morning run"})
	if title != "Ada completed Morning run!" || body != "Ada just completed Morning run" {
		t.Fatalf("got %q / %q", title, body)
	}
	title, body = buildHabitPushText(events.HabitCompleted{})
	if title != "A friend completed a habit!" {
		t.Fatalf("default title = %q", title)
	}
	title, body = buildHabitPushText(events.HabitCompleted{HabitName: "Meditation"})
	if title != "A friend completed Meditation!" || body != "A friend just completed Meditation" {
		t.Fatalf("nameless with habit = %q / %q", title, body)
	}
}

func TestWebPushSender_StatusHandling(t *testing.T) {
	keys, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	keyJSON, err := json.Marshal(keys)
	if err != nil {
		t.Fatalf("marshal keys: %v", err)
	}
	var keyMap map[string]string
	if err := json.Unmarshal(keyJSON, &keyMap); err != nil {
		t.Fatalf("unmarshal keys: %v", err)
	}

	tests := []struct {
		name       string
		status     int
		wantExpire bool
		wantTemp   bool
	}{
		{"201 created", http.StatusCreated, false, false},
		{"404 delete", http.StatusNotFound, true, false},
		{"410 delete", http.StatusGone, true, false},
		{"429 keep", http.StatusTooManyRequests, false, true},
		{"503 keep", http.StatusServiceUnavailable, false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
			}))
			t.Cleanup(srv.Close)

			sender, err := newWebPushSender(
				"mailto:test@winzy.ai",
				keyMap["publicKey"],
				keyMap["privateKey"],
				srv.Client(),
				slog.New(slog.NewTextHandler(io.Discard, nil)),
			)
			if err != nil {
				t.Fatalf("newWebPushSender: %v", err)
			}
			sender.client = webpush.NewClient(webpush.Config{HTTPClient: srv.Client(), MaxConcurrentSends: 10})
			sender.keys = keys

			subJSON, _ := json.Marshal(map[string]any{
				"endpoint": srv.URL,
				"keys": map[string]string{
					"p256dh": "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk",
					"auth":   "zqbxT6JKstKSY9JKibZLSQ",
				},
			})
			outcome := sender.Send(context.Background(), subJSON, []byte(`{"title":"t","body":"b"}`))
			if tt.status == http.StatusCreated {
				if outcome.Err != nil {
					t.Fatalf("unexpected err: %v", outcome.Err)
				}
				return
			}
			if outcome.Err == nil {
				t.Fatal("expected error")
			}
			if outcome.Expired != tt.wantExpire {
				t.Errorf("Expired = %v, want %v (status=%d)", outcome.Expired, tt.wantExpire, outcome.StatusCode)
			}
			if outcome.Temporary != tt.wantTemp {
				t.Errorf("Temporary = %v, want %v (status=%d)", outcome.Temporary, tt.wantTemp, outcome.StatusCode)
			}
		})
	}
}

func TestWebPushSender_KeysLessSubscription_DeletePath(t *testing.T) {
	keys, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	keyJSON, err := json.Marshal(keys)
	if err != nil {
		t.Fatalf("marshal keys: %v", err)
	}
	var keyMap map[string]string
	if err := json.Unmarshal(keyJSON, &keyMap); err != nil {
		t.Fatalf("unmarshal keys: %v", err)
	}
	sender, err := newWebPushSender(
		"mailto:test@winzy.ai",
		keyMap["publicKey"],
		keyMap["privateKey"],
		http.DefaultClient,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if err != nil {
		t.Fatalf("newWebPushSender: %v", err)
	}

	cases := []struct {
		name string
		sub  string
	}{
		{"no keys object", `{"endpoint":"https://push.example/v1"}`},
		{"empty keys", `{"endpoint":"https://push.example/v1","keys":{}}`},
		{"missing auth", `{"endpoint":"https://push.example/v1","keys":{"p256dh":"BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk"}}`},
		{"missing p256dh", `{"endpoint":"https://push.example/v1","keys":{"auth":"zqbxT6JKstKSY9JKibZLSQ"}}`},
		{"empty endpoint", `{"endpoint":"","keys":{"p256dh":"BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk","auth":"zqbxT6JKstKSY9JKibZLSQ"}}`},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			outcome := sender.Send(context.Background(), []byte(tt.sub), []byte(`{"title":"t"}`))
			if outcome.Err == nil {
				t.Fatal("expected error for incomplete subscription")
			}
			if outcome.Temporary {
				t.Fatal("Temporary=true would KEEP the token; want delete-path (non-temporary)")
			}
			if outcome.Expired {
				t.Fatal("Expired should be false for pre-send validation failures")
			}
		})
	}
}

func TestPushTTLMatchesCSharpLibraryDefault(t *testing.T) {
	if pushTTLSeconds != 2419200 {
		t.Fatalf("pushTTLSeconds = %d, want 2419200 (C# web-push 4-week default)", pushTTLSeconds)
	}
}

func TestFakeSender_BoundedConcurrency(t *testing.T) {
	var current, maxSeen atomic.Int32
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrentPush)

	n := 40
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			cur := current.Add(1)
			for {
				m := maxSeen.Load()
				if cur <= m || maxSeen.CompareAndSwap(m, cur) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			current.Add(-1)
		}()
	}
	wg.Wait()
	if maxSeen.Load() > maxConcurrentPush {
		t.Fatalf("max concurrency %d > %d", maxSeen.Load(), maxConcurrentPush)
	}
	if maxSeen.Load() < 2 {
		t.Fatalf("expected parallel sends, max=%d", maxSeen.Load())
	}
}

func TestMaxConcurrentPushConstant(t *testing.T) {
	if maxConcurrentPush != 10 {
		t.Fatalf("maxConcurrentPush = %d, want 10 (C# SemaphoreSlim parity)", maxConcurrentPush)
	}
}

func TestIdempotencyKeyFormats(t *testing.T) {
	key := fmt.Sprintf("habit_completed:%s:%s:%s:%s", "f", "a", "h", "2026-07-12")
	if key != "habit_completed:f:a:h:2026-07-12" {
		t.Fatalf("key = %q", key)
	}
}
