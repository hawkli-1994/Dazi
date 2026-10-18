# Watercolor UI implementation

## Scope

UI-first implementation approved on 2026-10-18. No Agent backend, model requests, real credentials, external actions, or Electron packaging are included. Demo data is clearly labelled; refresh resets all UI-only work. A typed in-memory adapter is replaceable by the planned Host projection later.

## Acceptance matrix

- [ ] First-use welcome: original watercolor art, readable central composer, new-work goal and directory form.
- [ ] Briefing: pending decisions, progress, next steps; work remains the primary object.
- [ ] Work detail: conversation, composer, running/queued/stopped/error feedback and collapsed execution detail.
- [ ] Work context: editable dossier, artifact preview, plan, schedule form.
- [ ] Decisions: actual preview, approve/decline UI feedback, explicitly simulated external action.
- [ ] Capabilities: model/MCP/skills information with honest disconnected state; no credential entry.
- [ ] Settings: language, light/dark/system, demo load/reset, clear refresh behavior.
- [ ] Keyboard, IME composition, long text, narrow layouts, reduced motion.
- [ ] Light/dark screenshots and visual comparison against approved concept.
- [ ] Typecheck, lint, format, unit and browser tests.

## Visual direction

Warm watercolor paper, deep ink text, original astronomer and lantern mailboat at the edges. No illustration over reading content; no artificial approval dashboard or card grid. Existing-work home keeps the product's briefing-first behavior. First-use welcome derives from the approved concept; Dazi branding replaces its temporary wordmark. Dark mode uses a separate calm night-paper palette, never an inverted image.
