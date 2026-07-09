package scenarios

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

const seedPassword = "ParityPass123!"

// waitUntil polls path with a raw (unrecorded — NOT ctx.Call) request until
// predicate(body) is true or timeout elapses. NATS-driven side effects
// (challenge progress, friend-activity notifications) are processed by
// async consumers, not synchronously within the triggering HTTP request, so
// scenarios that check their effect must wait for them to settle first. This
// deliberately bypasses golden capture/diffing — if it went through
// ctx.Call, the number of golden files captured would vary run-to-run with
// real propagation latency, breaking the determinism check. The caller
// always follows up with its own ctx.Call to record and assert the settled
// state.
func waitUntil(client *httpclient.Client, path, bearer string, timeout time.Duration, predicate func(map[string]any) bool) {
	deadline := time.Now().Add(timeout)
	for {
		res, err := client.Do(httpclient.Request{Method: "GET", Path: path, Bearer: bearer})
		if err == nil && res.StatusCode == 200 && predicate(asMap(res.JSON)) {
			return
		}
		if time.Now().After(deadline) {
			return
		}
		time.Sleep(150 * time.Millisecond)
	}
}

// settle is a fixed pause used when checking for the ABSENCE of a further
// async side effect (e.g. "this update must not spawn a second
// notification") — there's no positive condition to poll for, so we just
// give any (buggy) duplicate processing enough time to land before reading
// the authoritative state once.
func settle(d time.Duration) {
	time.Sleep(d)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// user is what registerUser hands back: enough to act as this identity for
// the rest of the scenario.
type user struct {
	Symbolic     string
	ID           string
	Email        string
	Username     string
	Password     string
	AccessToken  string
	RefreshToken string
}

// asMap decodes a *httpclient.Result's JSON body as a map, tolerating a nil
// body (returns an empty map so callers can index it without nil-checks
// everywhere).
func asMap(v any) map[string]any {
	if v == nil {
		return map[string]any{}
	}
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func str(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func flt(m map[string]any, key string) float64 {
	v, _ := m[key].(float64)
	return v
}

// registerUser creates a brand-new throwaway user via the public register
// endpoint, using a random suffix so re-running the harness never collides
// with a previous run's leftover data, and registers every generated
// identifier in the id-mapping table under the given symbolic name so the
// normalizer can canonicalize this run's random values consistently
// against any other run's differently-random values.
func registerUser(ctx *runner.Context, client *httpclient.Client, step, symbolic string) (*user, error) {
	suffix := randHex(6)
	// auth-service lowercases email/username before storing (ground truth:
	// "username/email lowercased before storage/lookup"), so a mixed-case
	// symbolic name here would make the server's echoed response diverge
	// byte-for-byte from what we registered in the id-map, breaking
	// canonicalization. Generate them already-lowercase so client-sent and
	// server-returned values match exactly regardless of the symbolic name's
	// own casing.
	email := strings.ToLower(fmt.Sprintf("parity-%s-%s@winzy.test", symbolic, suffix))
	username := strings.ToLower(fmt.Sprintf("parity_%s_%s", symbolic, suffix))
	displayName := "Parity " + symbolic

	// Register the values we're choosing ourselves BEFORE making the call:
	// the register response itself echoes them back, so the id-mapping
	// table must already know about them by the time that very first
	// response gets canonicalized.
	ctx.IDs.Register("user:"+symbolic+":email", email)
	ctx.IDs.Register("user:"+symbolic+":username", username)
	ctx.IDs.Register("user:"+symbolic+":displayName", displayName)

	res, err := ctx.Call(client, step, httpclient.Request{
		Method: "POST",
		Path:   "/auth/register",
		Body: map[string]any{
			"email":       email,
			"username":    username,
			"password":    seedPassword,
			"displayName": displayName,
		},
	}, 201)
	if err != nil {
		return nil, err
	}

	body := asMap(res.JSON)
	u := asMap(body["user"])
	id := str(u, "id")

	ctx.IDs.Register("user:"+symbolic+":id", id)

	return &user{
		Symbolic:     symbolic,
		ID:           id,
		Email:        email,
		Username:     username,
		Password:     seedPassword,
		AccessToken:  str(body, "accessToken"),
		RefreshToken: str(body, "refreshToken"),
	}, nil
}

// habit is what createHabit hands back.
type habit struct {
	Symbolic string
	ID       string
}

func createHabit(ctx *runner.Context, client *httpclient.Client, step, ownerSymbolic, habitSymbolic string, bearer string, body map[string]any) (*habit, error) {
	res, err := ctx.Call(client, step, httpclient.Request{
		Method: "POST",
		Path:   "/habits",
		Bearer: bearer,
		Body:   body,
	}, 201)
	if err != nil {
		return nil, err
	}
	m := asMap(res.JSON)
	id := str(m, "id")
	ctx.IDs.Register("habit:"+ownerSymbolic+":"+habitSymbolic, id)
	return &habit{Symbolic: habitSymbolic, ID: id}, nil
}

// todayIn returns "today" (yyyy-MM-dd) as observed in the given IANA
// timezone, mirroring how the C# services compute LocalDate from a client
// timezone.
func todayIn(tz string) string {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	return time.Now().In(loc).Format("2006-01-02")
}

func dateOffset(base string, days int) string {
	t, err := time.Parse("2006-01-02", base)
	if err != nil {
		t = time.Now().UTC()
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

// becomeFriends drives the request+accept handshake between two freshly
// registered users so scenarios that need an established friendship (not
// testing the friendship flow itself) don't have to repeat the plumbing.
func becomeFriends(ctx *runner.Context, a, b *user, stepPrefix string) error {
	_, err := ctx.Call(ctx.Native, stepPrefix+"-request", httpclient.Request{
		Method: "POST",
		Path:   "/social/friends/request",
		Bearer: a.AccessToken,
		Body:   map[string]any{"friendId": b.ID},
	}, 200, 201)
	if err != nil {
		return err
	}

	incomingRes, err := ctx.Call(ctx.Native, stepPrefix+"-list-incoming", httpclient.Request{
		Method: "GET",
		Path:   "/social/friends/requests",
		Bearer: b.AccessToken,
	}, 200)
	if err != nil {
		return err
	}
	incoming, _ := asMap(incomingRes.JSON)["incoming"].([]any)
	if len(incoming) == 0 {
		return fmt.Errorf("becomeFriends: no incoming request found for %s", b.Username)
	}
	requestID := str(asMap(incoming[len(incoming)-1]), "id")

	_, err = ctx.Call(ctx.Native, stepPrefix+"-accept", httpclient.Request{
		Method: "PUT",
		Path:   fmt.Sprintf("/social/friends/request/%s/accept", requestID),
		Bearer: b.AccessToken,
	}, 200)
	return err
}

func q(pairs ...string) url.Values {
	v := url.Values{}
	for i := 0; i+1 < len(pairs); i += 2 {
		v.Set(pairs[i], pairs[i+1])
	}
	return v
}
