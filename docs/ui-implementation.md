# Watercolor UI implementation

## Scope

UI-first implementation approved on 2026-10-18. No Agent backend, model requests, real credentials, external actions, or Electron packaging are included. Demo data is clearly labelled; refresh resets all UI-only work. A typed in-memory adapter is replaceable by the planned Host projection later.

## Acceptance matrix

- [x] First-use welcome: original watercolor art, readable central composer, new-work goal and directory form.
- [x] Briefing: pending decisions, progress, next steps; work remains the primary object.
- [x] Work detail: conversation, composer, running/queued/stopped/error feedback and collapsed execution detail.
- [x] Work context: editable dossier, artifact preview, plan, schedule form.
- [x] Decisions: actual preview, approve/decline UI feedback, explicitly simulated external action.
- [x] Capabilities: model/MCP/skills information with honest disconnected state; no credential entry.
- [x] Settings: language, light/dark/system, demo load/reset, clear refresh behavior.
- [x] Keyboard, IME composition, long text, narrow layouts, reduced motion.
- [x] Light/dark screenshots and visual comparison against approved concept.
- [x] Typecheck, lint, format, unit and browser tests.

## Visual direction

Warm watercolor paper, deep ink text, original astronomer and lantern mailboat at the edges. No illustration over reading content; no artificial approval dashboard or card grid. Existing-work home keeps the product's briefing-first behavior. First-use welcome derives from the approved concept; Dazi branding replaces its temporary wordmark. Dark mode uses a separate calm night-paper palette, never an inverted image.

## Verification evidence

- Local: strict TypeScript, oxlint, oxfmt, production build and 29 unit tests pass.
- GitHub Chromium: initial 72-case matrix passed; expanded 105-case matrix with installed Chinese serif fonts and native 1536×1024 screenshots passed on 7334e3d6.
- Final read-only-state and disabled-schedule regression cases are part of the required current PR run. The PR records the final exact head and run result.
- Loading and streaming are not applicable to this synchronous UI-only adapter. Composition-event guards are tested; an actual operating-system IME and packaged Electron shell remain future integration checks.

## Fidelity review

Compared the approved welcome and conversation concepts with actual Chromium screenshots, including the native reference dimensions. Preserved warm paper, original watercolor assets, deep ink, central whitespace and quiet conversation hierarchy. Fixed missing Chinese serif fonts, a hard-edged central paper rectangle, mobile orphaned heading characters, mobile asset cropping, and dark paper wash. Work pages keep artwork in the corners; welcome keeps the complete illustration composition.

Intentional product adaptations: Dazi branding and briefing/capabilities/settings navigation; a first-use goal leads to the required work-directory form; work-oriented fixtures replace the concept's stargazing sample; context tabs expose dossier/artifacts/plan/schedule rather than a fabricated trace. UI controls remain live HTML, not a screenshot. Dark and narrow views extend the same single theme.
