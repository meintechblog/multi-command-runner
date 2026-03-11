# Runtime/UI Stabilization Design

## Scope

Stabilize the highest-risk runtime and UI paths identified in review:

- purge deleted runners from live backend scheduler/runtime state
- make group runs execute each member as a one-shot run
- prevent stale delayed-status timers from corrupting a fresh UI run state
- bound browser-side output/event growth
- reduce avoidable hot-path rerenders and synchronous persistence work

## Recommended Approach

Use targeted fixes instead of a large refactor.

Backend:

- add explicit runtime cleanup for runners removed from persisted state
- introduce one-shot group execution behavior by overriding schedule semantics for group-launched runners
- convert runtime-status persistence from per-match full writes to dirty-marking plus throttled flush points

Frontend:

- move timer/output retention logic into a small helper module with direct tests
- cancel stale delayed-status timers before scheduling a replacement or starting a new run
- cap per-runner output and the global events buffer
- keep the full runner rerender path for structural changes, but avoid calling it on raw output events

## Tradeoffs

- This does not fully eliminate all O(n) UI rerender patterns, but it removes the worst hot-path behavior without destabilizing the whole app.
- Small helper extraction adds one extra browser script, but gives us a clean test seam for the regressions that matter most.

## Validation

- backend regression tests for stale runner cleanup and group-run one-shot semantics
- frontend helper tests for stale timer cancellation and bounded output/event retention
- targeted syntax/test verification after implementation
