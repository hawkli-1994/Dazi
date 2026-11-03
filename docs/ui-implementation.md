# Looseleaf UI implementation

## Scope

UI-first renderer with [Looseleaf](https://kevintngo.github.io/looseleaf/) as the component library. Components are copied into the repo via the shadcn registry (`components.json` → `@looseleaf/*`). No runtime npm dependency on the Looseleaf site. Agent backend behavior is unchanged; browser mode still uses `DemoStore`.

## Registry wiring

```json
{
  "registries": {
    "@looseleaf": "https://kevintngo.github.io/looseleaf/r/{name}.json"
  }
}
```

Install or refresh components:

```sh
npx shadcn@latest add @looseleaf/looseleaf-theme @looseleaf/ink @looseleaf/button …
```

Global styles: `src/renderer/theme/looseleaf.css`. Root wrap: `InkProvider` in `src/renderer/main.tsx`. Kevin Sans ships under `public/fonts/` and `src/renderer/theme/fonts/` so Playwright can block external origins.

## Golden-path coverage

- Briefing / welcome: Looseleaf buttons, textarea composer, desk background.
- Work: transcript + Looseleaf dialog for narrow dossier drawer.
- New work: `Input` / `Textarea`.
- Settings / capabilities: `NativeSelect`, buttons; demo load/reset unchanged.
- Legacy variant names (`primary`, `attention`, …) map in `src/shared/components/ui/button.tsx`.

## Acceptance matrix

- [x] Looseleaf theme + InkProvider end-to-end in browser demo.
- [x] Briefing, work, decisions, settings, capabilities paths with DemoStore.
- [x] Light / dark / system via `data-theme` (Looseleaf tokens + `dazi-app.css` dark desk).
- [x] Typecheck, lint, unit tests, Playwright e2e (Chromium matrix).

## Verification

```sh
bun install --frozen-lockfile
bun run typecheck && bun run lint && bun run test
bun run build && bun run test:e2e
bun run dev   # browser UI demo
```

Visual baselines are Playwright attachments on each run (not pixel-diff locked); re-capture after intentional Looseleaf visual changes.
