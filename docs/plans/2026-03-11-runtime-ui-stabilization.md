# Runtime/UI Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the highest-risk runtime and UI regressions while keeping the current architecture intact.

**Architecture:** Add narrowly scoped backend cleanup/one-shot execution logic and extract testable frontend runtime helpers for timer/output retention. Keep structural rendering behavior, but stop the most expensive hot-path work from growing without bound.

**Tech Stack:** FastAPI, Python standard library `unittest`, browser JavaScript, Node.js built-in test runner

---

### Task 1: Backend Regression Tests

**Files:**
- Create: `tests/test_runtime_regressions.py`
- Test: `tests/test_runtime_regressions.py`

**Step 1: Write the failing tests**

- cover stale runner cleanup after deletion
- cover group-run one-shot config override for scheduled runners

**Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_runtime_regressions -v`

Expected: failures showing stale runtime state and wrong group-run config behavior

### Task 2: Backend Runtime Fixes

**Files:**
- Modify: `app/main.py`

**Step 1: Implement runtime cleanup for removed runners**

- add centralized purge of runtime maps/timers for runner ids no longer present

**Step 2: Implement one-shot group-run behavior**

- ensure group-launched runners ignore interval/max-runs scheduling

**Step 3: Reduce runtime-status write amplification**

- mark runtime status dirty on matches
- flush on bounded cadence / run-finish points instead of every match

**Step 4: Run tests**

Run: `python3 -m unittest tests.test_runtime_regressions -v`

Expected: pass

### Task 3: Frontend Regression Tests

**Files:**
- Create: `static/app_runtime_helpers.js`
- Create: `tests/app_runtime_helpers.test.js`
- Modify: `templates/index.html`

**Step 1: Write the failing tests**

- cover stale delayed-status timer cancellation
- cover bounded runner output retention
- cover bounded events log retention

**Step 2: Run tests to verify they fail**

Run: `node --test tests/app_runtime_helpers.test.js`

Expected: failures showing missing helper exports / incorrect retention behavior

### Task 4: Frontend Runtime Fixes

**Files:**
- Modify: `static/app.js`
- Modify: `static/app_runtime_helpers.js`
- Modify: `templates/index.html`

**Step 1: Integrate helper-driven timer cancellation**

- cancel pending delayed-status update when a runner restarts or receives a newer terminal event

**Step 2: Bound browser output and events growth**

- reset buffers on every real start
- cap retained output/events text

**Step 3: Reduce hot-path rerender cost**

- keep output event handling incremental
- avoid unnecessary full rerender calls where direct state/DOM updates suffice

**Step 4: Run frontend tests**

Run: `node --test tests/app_runtime_helpers.test.js`

Expected: pass

### Task 5: End-to-End Verification

**Files:**
- Modify: `app/main.py`
- Modify: `static/app.js`
- Modify: `static/app_runtime_helpers.js`
- Modify: `templates/index.html`
- Create: `tests/test_runtime_regressions.py`
- Create: `tests/app_runtime_helpers.test.js`

**Step 1: Run verification commands**

Run: `python3 -m unittest tests.test_runtime_regressions -v`

Run: `node --test tests/app_runtime_helpers.test.js`

Run: `python3 -m py_compile app/main.py`

**Step 2: Review diff and summarize residual risks**

- note any remaining broad rerender costs not addressed in this pass
