// Package migrations embeds the SQL migration files in this directory so
// they ship inside the compiled binary instead of needing a mounted volume
// at runtime (Railway, and the distroless Docker image, have no filesystem
// access to source files).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
