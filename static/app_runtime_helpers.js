(function (globalScope) {
  const DEFAULT_RUNNER_OUTPUT_MAX_CHARS = 200000;
  const DEFAULT_EVENTS_MAX_CHARS = 120000;

  function clampMaxChars(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.max(1, Math.floor(n));
  }

  function trimTail(text, maxChars) {
    const s = String(text || "");
    const limit = clampMaxChars(maxChars, DEFAULT_RUNNER_OUTPUT_MAX_CHARS);
    if (s.length <= limit) return s;
    return s.slice(s.length - limit);
  }

  function clearDelayedStatusTimer(runtime, runnerId, options = {}) {
    if (!runtime || !runnerId) return;
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout;
    const timers = runtime.delayedStatusTimers || (runtime.delayedStatusTimers = {});
    const handle = timers[runnerId];
    if (!handle) return;
    clearTimeoutFn(handle);
    delete timers[runnerId];
  }

  function scheduleDelayedStatusUpdate(runtime, runnerId, updateFn, options = {}) {
    const minSpinnerMs = clampMaxChars(options.minSpinnerMs ?? 500, 500);
    const setTimeoutFn = options.setTimeoutFn || globalScope.setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn || globalScope.clearTimeout;
    const nowFn = options.nowFn || Date.now;
    const spinnerStartTimes = runtime.spinnerStartTimes || {};
    const timers = runtime.delayedStatusTimers || (runtime.delayedStatusTimers = {});

    clearDelayedStatusTimer(runtime, runnerId, { clearTimeoutFn });

    const startTime = spinnerStartTimes[runnerId];
    if (!startTime) {
      delete spinnerStartTimes[runnerId];
      updateFn();
      return null;
    }

    const elapsed = nowFn() - startTime;
    const remaining = minSpinnerMs - elapsed;
    if (remaining <= 0) {
      delete spinnerStartTimes[runnerId];
      updateFn();
      return null;
    }

    const handle = setTimeoutFn(() => {
      delete spinnerStartTimes[runnerId];
      delete timers[runnerId];
      updateFn();
    }, remaining);
    timers[runnerId] = handle;
    return handle;
  }

  function resetRunnerOutput(runtime, runnerId) {
    if (!runtime || !runnerId) return "";
    runtime.outputs = runtime.outputs || {};
    runtime.outputs[runnerId] = "";
    return runtime.outputs[runnerId];
  }

  function appendRunnerOutput(runtime, runnerId, line, options = {}) {
    if (!runtime || !runnerId) return "";
    const maxChars = clampMaxChars(options.maxChars, DEFAULT_RUNNER_OUTPUT_MAX_CHARS);
    runtime.outputs = runtime.outputs || {};
    const next = trimTail(`${runtime.outputs[runnerId] || ""}${line || ""}`, maxChars);
    runtime.outputs[runnerId] = next;
    return next;
  }

  function appendEventText(currentText, text, options = {}) {
    const maxChars = clampMaxChars(options.maxChars, DEFAULT_EVENTS_MAX_CHARS);
    return trimTail(`${currentText || ""}${text || ""}`, maxChars);
  }

  const helpers = {
    DEFAULT_EVENTS_MAX_CHARS,
    DEFAULT_RUNNER_OUTPUT_MAX_CHARS,
    appendEventText,
    appendRunnerOutput,
    clearDelayedStatusTimer,
    resetRunnerOutput,
    scheduleDelayedStatusUpdate,
  };

  globalScope.AppRuntimeHelpers = helpers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
