# Rendered UI review

The Playwright suite runs the built Vite preview. It exercises only the local,
in-memory UI demo. It never connects an account, runs an agent, reads a working
directory, publishes work, or deploys the app. Outside HTTP requests and uncaught
browser errors fail the tests.

## Run

```sh
bun install --frozen-lockfile
bunx --no-install playwright install chromium
npm run build
npm run test:e2e
```

List the checks without starting a browser:

```sh
npm run test:e2e -- --list
```

The five projects cover desktop light and dark at 1280 × 800, the approved
concept's native 1536 × 1024 dimensions, the supported narrow desktop window at
960 × 640, and a 390 × 844 responsive preview. The small preview is a layout
regression check, not a commitment to a mobile product. CI installs Noto CJK system
fonts so Chinese serif and sans-serif rendering is representative.

## Review artifacts

The `UI checks` GitHub Actions workflow has read-only repository permissions. It
uploads `dazi-ui-review-<commit>` containing:

- `playwright-report/`: HTML report with attached named screen captures.
- `test-results/`: PNG captures, JUnit results, and traces/video for failed tests.

Each capture is associated with its test, viewport, and theme. Capture names mark
the state being reviewed. Screenshots are taken after web fonts settle and with
animations disabled for capture only; the reduced-motion check independently
examines the live page. Tests use a fixed clock for consistent greetings without
freezing timers.

These are **review captures**, not approved visual baselines. The suite does not
automatically create or update pixel snapshots. Review light/dark images against
`DESIGN.md`, including hierarchy, color meaning, spacing, text truncation, focus,
and loading/error states. Obtain product-owner approval before adopting or
changing screenshot baselines.

## Scope of evidence

A passing build, passing interaction tests, and reviewed screenshots prove
different things. Report them separately. Test discovery alone does not prove
rendered behavior. Chromium must actually run and its captures must be inspected
before claiming visual acceptance.

All edits and submitted messages are demonstration state. Refresh deliberately
resets them. No test treats a simulated approval as an actual external action or a
queued message as an agent response.

There is no asynchronous data loader or streaming model response in this build,
so network-loading and streaming-layout acceptance are not applicable yet. The
suite captures the authored running and interrupted samples instead of adding
fake loading timers. IME tests exercise composition and key-code event guards;
they do not replace a manual check using an operating-system input method.
