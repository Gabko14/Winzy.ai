# Playwright MCP for AI Agents

Project-scoped Playwright MCP configuration for AI agents working on Winzy.ai.

## Configuration

Playwright MCP is configured in two places for agent tool compatibility:

| File | Agent Tool |
|------|-----------|
| `.mcp.json` | Claude Code |
| `.cursor/mcp.json` | Cursor |

Both use the same config:

```json
{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest", "--headless"]
  }
}
```

The `--headless` flag is required for CI and remote environments. For local development with visible browser, remove it temporarily (do not commit the change).

## Supported Tools

The Playwright MCP server exposes these tool categories:

### Navigation
- `browser_navigate` — Go to a URL
- `browser_navigate_back` — Go back
- `browser_tabs` — List open tabs

### Interaction
- `browser_click` — Click an element (uses accessibility snapshots)
- `browser_fill_form` — Fill form fields
- `browser_select_option` — Select dropdown options
- `browser_press_key` — Press keyboard keys
- `browser_type` — Type text into focused element
- `browser_hover` — Hover over an element
- `browser_drag` — Drag and drop
- `browser_file_upload` — Upload files
- `browser_handle_dialog` — Accept/dismiss dialogs

### Observation
- `browser_snapshot` — Accessibility tree snapshot (preferred over screenshots for structured data)
- `browser_take_screenshot` — Visual screenshot
- `browser_console_messages` — Read browser console output
- `browser_network_requests` — Inspect network activity

### Utilities
- `browser_evaluate` — Run JavaScript in browser context
- `browser_run_code` — Run Playwright script
- `browser_wait_for` — Wait for text/element/URL/timeout
- `browser_resize` — Resize viewport
- `browser_close` — Close the browser
- `browser_install` — Install browsers

## Limitations

- **Headless only in CI.** The `--headless` flag means no visual browser window. Screenshots still work.
- **Single browser context.** MCP manages one browser instance at a time. No parallel tabs/contexts.
- **No persistent state.** Each MCP session starts fresh — no cookies, localStorage, or auth state carry over.
- **Chromium only by default.** The MCP server uses Chromium. For cross-browser testing, use the Playwright test runner (`e2e/`) instead.
- **Not a test runner.** This is for interactive exploration, debugging, and ad-hoc verification. Structured E2E tests belong in `e2e/` using the Playwright test framework.

## When to Use What

| Task | Tool |
|------|------|
| Write/run E2E test suites | `e2e/` directory with `npx playwright test` |
| Verify a UI change visually | Playwright MCP `browser_navigate` + `browser_snapshot` |
| Debug a failing E2E test | Playwright MCP to reproduce interactively |
| Check accessibility tree | Playwright MCP `browser_snapshot` |
| Automated CI browser tests | `ci-e2e.yml` workflow (not MCP) |

## Enabling Locally

Playwright MCP works automatically when using Claude Code or Cursor in this project — the config files are already committed. No additional setup needed.

If the MCP server fails to start, ensure you have `npx` available (comes with Node.js) and that you can run `npx @playwright/mcp@latest --headless` manually.
