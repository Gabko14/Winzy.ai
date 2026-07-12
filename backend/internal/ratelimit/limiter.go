// Package ratelimit implements the fixed-window request limiting that used
// to live in the YARP gateway (standard 300/min/IP, auth 10/min/IP — see
// epic winzy.ai-rdc7 ground truth). It is intentionally a single
// in-process map: correct for the single-instance deploy this rewrite
// targets, and would need a shared store (Redis, Postgres) the moment
// there is more than one instance. A fixed window admits the well-known
// boundary-burst edge case (up to 2x the limit across a window boundary);
// that tradeoff is accepted for simplicity, per the epic's "in-memory
// limiter is fine single-instance" guidance.
package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const scavengeInterval = 10 * time.Minute

type bucket struct {
	start time.Time
	count int
}

// Limiter allows at most Limit requests per Window for a given key.
type Limiter struct {
	mu           sync.Mutex
	limit        int
	window       time.Duration
	buckets      map[string]*bucket
	lastScavenge time.Time
}

// New returns a Limiter allowing at most limit requests per window, per
// key. limit must be at least 1 and window must be positive; New panics on
// a nonsensical value since a misconfigured limiter is a startup-time
// programming error, not a runtime condition to recover from.
func New(limit int, window time.Duration) *Limiter {
	if limit < 1 {
		panic("ratelimit: limit must be at least 1")
	}
	if window <= 0 {
		panic("ratelimit: window must be positive")
	}
	return &Limiter{
		limit:        limit,
		window:       window,
		buckets:      make(map[string]*bucket),
		lastScavenge: time.Now(),
	}
}

// Allow reports whether the request identified by key is within the limit
// for the current window, recording the attempt. It is safe for concurrent
// use.
func (l *Limiter) Allow(key string) bool {
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	l.scavengeLocked(now)

	b, ok := l.buckets[key]
	if !ok || now.Sub(b.start) >= l.window {
		l.buckets[key] = &bucket{start: now, count: 1}
		return true
	}
	if b.count < l.limit {
		b.count++
		return true
	}
	return false
}

// scavengeLocked drops expired buckets so the map does not grow without
// bound; it runs at most once per scavengeInterval, piggybacked on normal
// Allow calls. Callers must hold l.mu.
func (l *Limiter) scavengeLocked(now time.Time) {
	if now.Sub(l.lastScavenge) < scavengeInterval {
		return
	}
	l.lastScavenge = now
	for key, b := range l.buckets {
		if now.Sub(b.start) >= l.window {
			delete(l.buckets, key)
		}
	}
}

// ClientIP returns the request's client IP. Railway documents X-Real-IP as
// the original client address; it is trusted only when explicitly enabled,
// so a direct client cannot spoof a header into another limiter bucket. The
// LAST occurrence of the header wins: if the proxy appends its own
// X-Real-IP after a client-supplied one (rather than replacing it), taking
// the first value would let an attacker rotate that first value and escape
// their bucket — the exact bypass trustedProxy is meant to close. Taking
// the last is safe either way: if the proxy replaces the header outright,
// there is only one value to take.
func ClientIP(r *http.Request, trustedProxy bool) string {
	if trustedProxy {
		values := r.Header.Values("X-Real-IP")
		if len(values) > 0 {
			if realIP := strings.TrimSpace(values[len(values)-1]); net.ParseIP(realIP) != nil {
				return realIP
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeTooManyRequests(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"error":"too many requests"}`))
}

// PrefixMiddleware applies authLimiter (keyed by client IP) to every
// request whose path starts with authPrefix, and generalLimiter (also
// keyed by client IP) to everything else — replicating the gateway's
// per-route-group rate limiting policies as a single middleware, since the
// two policies never both apply to the same request.
func PrefixMiddleware(generalLimiter, authLimiter *Limiter, authPrefix string, trustedProxy bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			limiter := generalLimiter
			if strings.HasPrefix(r.URL.Path, authPrefix) {
				limiter = authLimiter
			}
			if !limiter.Allow(ClientIP(r, trustedProxy)) {
				writeTooManyRequests(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
