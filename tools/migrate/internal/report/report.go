package report

import (
	"fmt"
	"os"
	"strings"
	"time"

	"winzy.ai/migrate/internal/authcheck"
	"winzy.ai/migrate/internal/enums"
	"winzy.ai/migrate/internal/verify"
)

// Write emits the single verification report markdown file.
func Write(path string, v *verify.Report, a *authcheck.Result) error {
	var b strings.Builder
	b.WriteString("# Migration verification report (winzy.ai-rdc7.9)\n\n")
	b.WriteString(fmt.Sprintf("Generated: %s\n\n", time.Now().UTC().Format(time.RFC3339)))

	overall := v != nil && v.OK && a != nil && a.OK
	if overall {
		b.WriteString("**Overall: PASS**\n\n")
	} else {
		b.WriteString("**Overall: FAIL**\n\n")
	}

	b.WriteString("## Enum mapping table\n\n")
	b.WriteString(enums.MarkdownTable())
	b.WriteString("\n")

	b.WriteString("## Per-table source vs target row counts\n\n")
	b.WriteString("| Table | Archive expected | Source | Target | Delta (tgt-src) |\n")
	b.WriteString("|---|---:|---:|---:|---:|\n")
	if v != nil {
		for _, c := range v.Counts {
			b.WriteString(fmt.Sprintf("| `%s` | %d | %d | %d | %+d |\n", c.Table, c.Expected, c.Source, c.Target, c.Delta))
		}
		b.WriteString(fmt.Sprintf("| `refresh_tokens` (NOT migrated) | %d | %d | %d | — |\n",
			v.RefreshTokensExp, v.RefreshTokensSrc, v.RefreshTokensTgt))
	}

	b.WriteString("\n## Referential integrity (orphans)\n\n")
	if v == nil || len(v.Orphans) == 0 {
		b.WriteString("None.\n\n")
	} else {
		b.WriteString("| Table | Column | Value | References | Row |\n")
		b.WriteString("|---|---|---|---|---|\n")
		for _, o := range v.Orphans {
			b.WriteString(fmt.Sprintf("| `%s` | `%s` | `%s` | `%s` | `%s` |\n",
				o.Table, o.Column, o.Value, o.Referenced, o.RowID))
		}
		b.WriteString("\n")
	}

	b.WriteString("## Distinct-user counts vs auth users\n\n")
	if v != nil {
		b.WriteString(fmt.Sprintf("Auth users: **%d**\n\n", v.AuthUsers))
		b.WriteString("| Module | Column(s) | Distinct |\n")
		b.WriteString("|---|---|---:|\n")
		for _, d := range v.UserDistincts {
			b.WriteString(fmt.Sprintf("| `%s` | `%s` | %d |\n", d.Module, d.Column, d.Count))
		}
		b.WriteString("\n")
	}

	b.WriteString("## Auth chain / password hash audit\n\n")
	if a != nil {
		b.WriteString("Every migrated user: format parse + argon2id param shape + `VerifyPassword(\"PLACEHOLDER\")` must reject.\n")
		b.WriteString("No owner-username guessing — real login is the owner spot-check later.\n\n")
		b.WriteString("| Username | OK | Parts | Salt bytes | Hash bytes | PLACEHOLDER rejected | Notes |\n")
		b.WriteString("|---|---|---:|---:|---:|---|---|\n")
		for _, u := range a.Users {
			b.WriteString(fmt.Sprintf("| `%s` | %v | %d | %d | %d | %v | %s |\n",
				u.Username, u.OK, u.Parts, u.SaltBytes, u.HashBytes, u.PlaceholderRej, strings.Join(u.Notes, "; ")))
		}
		b.WriteString("\n")
	}

	b.WriteString("## Failures\n\n")
	var fails []string
	if v != nil {
		fails = append(fails, v.Failures...)
	}
	if a != nil {
		fails = append(fails, a.Failures...)
	}
	if len(fails) == 0 {
		b.WriteString("None.\n")
	} else {
		for _, f := range fails {
			b.WriteString("- " + f + "\n")
		}
	}

	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return fmt.Errorf("report: write %s: %w", path, err)
	}
	return nil
}
