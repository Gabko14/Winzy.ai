// Package web serves the Expo web bundle (static files + SPA fallback) for
// same-origin production deploys. When WEB_DIST is unset the API runs alone;
// when set, SplitHandler routes API prefixes to the API mux and everything
// else here — matching the C# gateway's UseStaticFiles + MapFallbackToFile
// split (services/gateway/src/Program.cs).
package web

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// API path prefixes that must never fall through to index.html. Exact match
// or prefix+"/" so "/authenticate" does not steal "/auth".
var apiPrefixes = []string{
	"/auth",
	"/habits",
	"/social",
	"/challenges",
	"/notifications",
	"/activity",
	"/health",
}

// IsAPIPath reports whether path belongs to the Go API surface and must be
// handled by the API mux (including unknown subpaths that should 404).
func IsAPIPath(requestPath string) bool {
	if requestPath == "" {
		return false
	}
	if !strings.HasPrefix(requestPath, "/") {
		requestPath = "/" + requestPath
	}
	clean := path.Clean(requestPath)
	for _, prefix := range apiPrefixes {
		if clean == prefix || strings.HasPrefix(clean, prefix+"/") {
			return true
		}
	}
	return false
}

// SplitHandler sends API-prefix requests to api and every other request to
// static. api carries JWT + rate limiting; static does not — matching the
// C# gateway where UseStaticFiles ran before UseRateLimiter/JWT and YARP
// rate-limit policies applied only to reverse-proxy routes.
func SplitHandler(api, static http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if IsAPIPath(r.URL.Path) {
			api.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}

// cacheControl returns the Cache-Control value for a served static path.
// Only Expo's content-hashed bundles under /_expo/static/ may be cached
// forever; everything else (index.html, sw.js, /assets/**, the SPA
// fallback) must revalidate so clients pick up new deploys — ETag /
// Last-Modified from the file server keep revalidation a cheap 304.
func cacheControl(name string) string {
	if strings.HasPrefix(name, "/_expo/static/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

// SPAHandler serves files from root and falls back to index.html for
// missing paths (SPA deep links like /@username). Existing files win;
// directories without an implicit file fall through to index.html.
func SPAHandler(root string) http.Handler {
	dir := http.Dir(root)
	files := http.FileServer(dir)
	indexPath := filepath.Join(root, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean("/" + r.URL.Path)
		w.Header().Set("Cache-Control", cacheControl(name))
		if name != "/" {
			if f, err := dir.Open(name); err == nil {
				stat, statErr := f.Stat()
				_ = f.Close()
				if statErr == nil && !stat.IsDir() {
					files.ServeHTTP(w, r)
					return
				}
			}
		} else {
			// "/" — prefer index.html via FileServer's directory index behavior
			if _, err := os.Stat(indexPath); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}

		// SPA fallback is index.html — always revalidate, never immutable.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, indexPath)
	})
}
