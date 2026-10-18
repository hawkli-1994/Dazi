# Durable Agent integration

## Scope and branch

Connect the accepted watercolor UI to the native Pi Durable runtime. This draft is stacked on UI PR #1 (`feat/watercolor-ui`, `7e64ee4c`). It neither merges that PR nor deploys the application.

## Evidence before implementation

The published npm packages, not upstream unreleased main, are the API source of truth:

- `@earendil-works/pi-durable`, `pi-ai`, `chord`: **1.3.0**, exact versions. [Published runtime documentation](https://www.npmjs.com/package/@earendil-works/pi-durable/v/1.3.0). The whole runtime is experimental; pinning plus recovery tests are required.
- `Conversation.watch()` starts with `watch.value`, then serialized native Chord operations. A slow observer is bounded to 100 pending frames and receives a root replacement when overloaded. Reconnect starts a new snapshot, not a historical event replay. Use `applyImmutable`, not a custom delta parser. Experimental `watchEvents()` is not used.
- `ConversationView` includes entries and built-in `pi.*` documents only. Custom `dazi.*` state uses native `watchDoc`/`documentState` subscriptions.
- Partial assistant content is ordered text/thinking/toolCall blocks; arguments are already parsed by Pi. Tool output is transient; final results live in immutable entries. A tool slot marked `done` is not sufficient evidence of success.
- `streamdown` **2.7.0** renders streaming Markdown only. It does not own submissions, tool execution or persistence. Remote model-authored images are disabled. [Official documentation](https://streamdown.ai/docs).
- Electron **44.9.0** uses Node **24.22.0** and utilityProcess. [Official release matrix](https://releases.electronjs.org/release?channel=stable). SQLite availability and MessagePort transfer are verified in the desktop smoke test, not assumed from Node alone.

### Native-runtime spike, 2026-10-18

Node 24.19 with published Pi 1.3.0 and its controlled faux provider, without a credential or provider-network call:

- MemoryStorage: thinking/text partial, tool output/details, terminal entries, native Chord replay for every frame, late snapshot attachment.
- Abort: preserves committed partial; active and queued submissions settle aborted.
- SQLite close/reopen: safe tool reruns while an explicit idempotency record prevents repeated side effect; unsafe tool is not rerun and yields interrupted/error result.
- A subsequent reopen and identical requestId creates no duplicate input, result or model call.

This is real runtime execution with controlled model responses. It is not a live provider/API smoke test and does not prove all provider-specific behaviors.

## Implementation order

1. Preserve the spike as executable regression coverage and fix the native schema contract.
2. Electron sandboxed Renderer, minimal preload, single utilityProcess storage owner and direct MessagePort. Main supervises restart with backoff; no high-frequency relay.
3. Native Documents and tools; preserve unsafe replay policy through approval wrappers. Work directory is a location, not a security sandbox. Privileged effects require explicit product approval.
4. Renderer subscribes to native snapshots/ops with connection epochs, FIFO sequences and ACK backpressure. Never merge a new connection snapshot into an old partial.
5. Integrate work creation, input/steer, cancellation, durable documents and real configuration status while retaining approved UI.
6. Independent security/code review, native subprocess crash tests, real Electron/Chromium screenshots and final exact-head CI.

## Acceptance checklist

- [ ] Real utilityProcess/SQLite boot, restart and shutdown
- [ ] No credential values enter Renderer, logs, fixtures or artifacts
- [ ] Native snapshot/ops and root replacement; stale-epoch frames discarded
- [ ] Bounded slow-consumer transport and repeated navigation cleanup
- [ ] Text/reasoning/tool partials; stable identity, ordered blocks, no duplicate finals
- [ ] Parallel tools, partial arguments, output truncation and persisted terminal errors
- [ ] Abort during generation/tool, queued input withdrawal, distinct wait cancellation
- [ ] Hard process kill and reopen, requestId dedupe, no unsafe side-effect replay
- [ ] Native Document persistence, user corrections and approval recovery
- [ ] Long Markdown/code/CJK streams, reduced motion and keyboard/IME guards
- [ ] Host-backed browser and Electron interaction evidence, light/dark/narrow screenshots
- [ ] Typecheck/lint/format/unit/integration/build pass on final head
- [ ] Live provider smoke performed or explicitly blocked by unavailable safe credentials

Provider-supplied reasoning content may be shown, collapsed by default. Hidden chain-of-thought is never fabricated or inferred. A disconnected transport, idle runtime and successful run are three different states.
