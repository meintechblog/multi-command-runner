const test = require("node:test");
const assert = require("node:assert/strict");

const helpers = require("../static/app_runtime_helpers.js");

test("scheduleDelayedStatusUpdate cancels stale timer before scheduling a new one", async () => {
  const cleared = [];
  const pending = [];
  const runtime = {
    spinnerStartTimes: { runner_1: Date.now() - 10 },
    delayedStatusTimers: {},
  };

  const setTimeoutFn = (fn, delay) => {
    const handle = { fn, delay, cancelled: false };
    pending.push(handle);
    return handle;
  };
  const clearTimeoutFn = (handle) => {
    if (handle) {
      handle.cancelled = true;
      cleared.push(handle);
    }
  };

  helpers.scheduleDelayedStatusUpdate(runtime, "runner_1", () => {}, {
    setTimeoutFn,
    clearTimeoutFn,
    minSpinnerMs: 500,
  });
  helpers.scheduleDelayedStatusUpdate(runtime, "runner_1", () => {}, {
    setTimeoutFn,
    clearTimeoutFn,
    minSpinnerMs: 500,
  });

  assert.equal(pending.length, 2);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], pending[0]);
  assert.equal(runtime.delayedStatusTimers.runner_1, pending[1]);
});

test("appendRunnerOutput keeps only the bounded tail", () => {
  const runtime = { outputs: {} };

  helpers.appendRunnerOutput(runtime, "runner_1", "abcdef", { maxChars: 10 });
  helpers.appendRunnerOutput(runtime, "runner_1", "ghijkl", { maxChars: 10 });

  assert.equal(runtime.outputs.runner_1, "cdefghijkl");
});

test("appendEventText keeps only the bounded tail", () => {
  let text = "";

  text = helpers.appendEventText(text, "12345", { maxChars: 8 });
  text = helpers.appendEventText(text, "67890", { maxChars: 8 });

  assert.equal(text, "34567890");
});
