const el = (id) => document.getElementById(id);

const state = {
  notify_profiles: [],
  runners: [],
};

const runtime = {
  status: {},
  outputs: {},
  spinnerStartTimes: {},
};

const UI_STORAGE_KEY = "command-runner.ui";
const MASKED_SECRET = "__SECRET_SET__";

function loadUIState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      notifySectionCollapsed: !!parsed.notifySectionCollapsed,
      runnerSectionCollapsed: !!parsed.runnerSectionCollapsed,
      notifySortMode: !!parsed.notifySortMode,
      runnerSortMode: !!parsed.runnerSortMode,
    };
  } catch (e) {
    return {};
  }
}

function saveUIState() {
  try {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        notifySectionCollapsed: !!ui.notifySectionCollapsed,
        runnerSectionCollapsed: !!ui.runnerSectionCollapsed,
        notifySortMode: !!ui.notifySortMode,
        runnerSortMode: !!ui.runnerSortMode,
      }),
    );
  } catch (e) {
    // Ignore storage errors (private mode, disabled storage, quota, ...)
  }
}

const loadedUIState = loadUIState();
const ui = {
  notifySectionCollapsed: loadedUIState.notifySectionCollapsed ?? false,
  runnerSectionCollapsed: loadedUIState.runnerSectionCollapsed ?? false,
  notifySortMode: loadedUIState.notifySortMode ?? false,
  runnerSortMode: loadedUIState.runnerSortMode ?? false,
  notifyJournalEntries: [],
  dirtyNotifyProfiles: new Set(),
  savedNotifySignatures: {},
  dirtyRunners: new Set(),
  savedRunnerSignatures: {},
};

function syncSortModeButtons() {
  const notifyBtn = el("sortNotifyBtn");
  const runnerBtn = el("sortRunnerBtn");
  if (notifyBtn) {
    notifyBtn.textContent = `Sortieren: ${ui.notifySortMode ? "An" : "Aus"}`;
    notifyBtn.classList.toggle("primary", !!ui.notifySortMode);
  }
  if (runnerBtn) {
    runnerBtn.textContent = `Sortieren: ${ui.runnerSortMode ? "An" : "Aus"}`;
    runnerBtn.classList.toggle("primary", !!ui.runnerSortMode);
  }
}

function moveItemInArray(list, fromIndex, toIndex) {
  if (!Array.isArray(list)) return false;
  if (fromIndex < 0 || fromIndex >= list.length) return false;
  if (toIndex < 0 || toIndex >= list.length) return false;
  if (fromIndex === toIndex) return false;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return true;
}

function uuidFallback() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 32);
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function clampInt(n, min, max) {
  n = Number.isFinite(Number(n)) ? Number(n) : min;
  return Math.max(min, Math.min(max, n));
}

function formatTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (e) {
    return isoString;
  }
}

function formatDurationHhMmSs(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatElapsedSince(isoString, nowMs = Date.now()) {
  if (!isoString) return "";
  const startMs = Date.parse(isoString);
  if (!Number.isFinite(startMs)) return "";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  return formatDurationHhMmSs(elapsedSeconds);
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    return isoString;
  }
}

function appendEvents(text) {
  const out = el("events");
  out.textContent += text;
  out.scrollTop = out.scrollHeight;
}

let runnerElapsedInterval = null;
function tickRunnerElapsed() {
  const nodes = document.querySelectorAll("[data-runner-elapsed]");
  if (!nodes.length) return;
  const nowMs = Date.now();
  nodes.forEach((node) => {
    const rid = String(node.dataset.runnerElapsed || "");
    const rt = runtime.status[rid] || {};
    if (rt.running && rt.started_ts) {
      const s = formatElapsedSince(rt.started_ts, nowMs);
      if (s) {
        node.classList.remove("hidden");
        node.textContent = `⏱ ${s}`;
        node.title = `Laufzeit: ${s}`;
        return;
      }
    }
    node.classList.add("hidden");
    node.textContent = "";
    node.title = "";
  });
}

function startRunnerElapsedTicker() {
  if (runnerElapsedInterval) return;
  runnerElapsedInterval = setInterval(tickRunnerElapsed, 1000);
  tickRunnerElapsed();
}

function formatNotifyJournalLine(item) {
  const ts = formatDateTime(item.ts || "");
  const runner = item.runner_id || "?";
  const service = item.profile_name || item.profile_id || "?";
  const delivery = (item.delivery || "info").toUpperCase();
  const msg = (item.message || "").replace(/\s+/g, " ").trim();
  const err = (item.error || "").replace(/\s+/g, " ").trim();
  if (err) {
    return `[${ts}] ${delivery} | ${runner} -> ${service} | ${msg} | FEHLER: ${err}`;
  }
  return `[${ts}] ${delivery} | ${runner} -> ${service} | ${msg}`;
}

function renderNotifyJournal() {
  const out = el("notifyJournal");
  if (!out) return;
  if (!ui.notifyJournalEntries.length) {
    out.textContent = "";
    return;
  }
  out.textContent = ui.notifyJournalEntries.map(formatNotifyJournalLine).join("\n");
  out.scrollTop = out.scrollHeight;
}

function appendNotifyJournalEntry(entry) {
  ui.notifyJournalEntries.push(entry);
  if (ui.notifyJournalEntries.length > 500) {
    ui.notifyJournalEntries = ui.notifyJournalEntries.slice(-500);
  }
  renderNotifyJournal();
}

function appendNotifyJournalFromStatusEvent(ev) {
  if (!ev || !ev.delivery || !ev.message) return;
  appendNotifyJournalEntry({
    ts: ev.ts || new Date().toISOString(),
    runner_id: ev.runner_id || "?",
    profile_id: ev.profile_id || "",
    profile_name: ev.profile_name || ev.profile_id || "",
    delivery: ev.delivery || "info",
    title: ev.title || "",
    message: ev.message || "",
    error: ev.delivery === "error" ? (ev.reason || "") : "",
  });
}

let flashTimer = null;
let flashClearTimer = null;
let lastSseErrorAt = 0;
function showFlash(message, kind = "info", ttlMs = 6500) {
  const box = el("uiFlash");
  if (!box) return;
  if (flashTimer) clearTimeout(flashTimer);
  if (flashClearTimer) clearTimeout(flashClearTimer);
  box.textContent = message;
  box.title = message;
  box.className = `flash ${kind} is-visible`;
  flashTimer = setTimeout(() => {
    box.classList.remove("is-visible");
    flashClearTimer = setTimeout(() => {
      if (!box.classList.contains("is-visible")) {
        box.textContent = "";
        box.title = "";
      }
    }, 240);
  }, ttlMs);
}

function hulkMessage(kind, text) {
  return text;
}

function hulkFlash(kind, text, ttlMs = 6500) {
  showFlash(hulkMessage(kind, text), kind, ttlMs);
}

function logHulk(kind, text, tsIso = null) {
  const ts = tsIso || new Date().toISOString();
  appendEvents(`[${ts}] ${hulkMessage(kind, text)}\n`);
}

function maskNotifySecretsInState() {
  state.notify_profiles.forEach((np, idx) => {
    const cfg = np?.config || {};
    const userKey = String(cfg.user_key || "");
    const apiToken = String(cfg.api_token || "");
    cfg.user_key = userKey ? MASKED_SECRET : "";
    cfg.api_token = apiToken ? MASKED_SECRET : "";
    np.config = cfg;
  });
}

async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall back to legacy copy below.
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}

function runnerOutputEl(rid) {
  return document.querySelector(`[data-output="${rid}"]`);
}

function isRunnerCommandMissing(r) {
  return ((r?.command || "").trim() === "");
}

function isRunnerSaveBlocked(r) {
  return !!r?._isNew && isRunnerCommandMissing(r);
}

function isNotifySaveBlocked(np) {
  return !!np?._isNew && notifyProfileValidationError(np) !== "";
}

function computeNotifyProfileSignature(np) {
  return JSON.stringify({
    name: String(np?.name ?? ""),
    type: np?.type ?? "pushover",
    active: !!np?.active,
    config: {
      user_key: np?.config?.user_key ?? "",
      api_token: np?.config?.api_token ?? "",
    },
  });
}

function syncSavedNotifySignatures() {
  const next = {};
  state.notify_profiles.forEach((np, idx) => {
    next[np.id] = computeNotifyProfileSignature(np);
  });
  ui.savedNotifySignatures = next;
}

function refreshNotifyDirtyState(npid) {
  if (!npid) return;
  const np = state.notify_profiles.find((x) => x.id === npid);
  if (!np) {
    ui.dirtyNotifyProfiles.delete(npid);
    const missingCard = document.querySelector(`.notifyProfile[data-notify-id="${npid}"]`);
    if (missingCard) {
      missingCard.classList.remove("is-dirty");
    }
    const missingNameInput = document.querySelector(`[data-npname="${npid}"]`);
    if (missingNameInput) {
      missingNameInput.classList.remove("is-dirty");
    }
    return;
  }
  const currentSig = computeNotifyProfileSignature(np);
  const savedSig = ui.savedNotifySignatures[npid];
  if (savedSig === undefined || currentSig !== savedSig) {
    ui.dirtyNotifyProfiles.add(npid);
  } else {
    ui.dirtyNotifyProfiles.delete(npid);
  }
  const card = document.querySelector(`.notifyProfile[data-notify-id="${npid}"]`);
  const nameInput = document.querySelector(`[data-npname="${npid}"]`);
  const isSaveableDirty = ui.dirtyNotifyProfiles.has(npid) && !isNotifySaveBlocked(np);
  if (card) {
    card.classList.toggle("is-dirty", isSaveableDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isSaveableDirty);
  }
}

function syncNotifyDirtyButton(npid) {
  const np = state.notify_profiles.find((x) => x.id === npid);
  const isSaveableDirty = !!np && ui.dirtyNotifyProfiles.has(npid) && !isNotifySaveBlocked(np);
  const card = document.querySelector(`.notifyProfile[data-notify-id="${npid}"]`);
  const nameInput = document.querySelector(`[data-npname="${npid}"]`);
  if (card) {
    card.classList.toggle("is-dirty", isSaveableDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isSaveableDirty);
  }
  const btn = document.querySelector(`[data-save-npname="${npid}"]`);
  if (!btn) return;
  btn.classList.toggle("invalid", isNotifySaveBlocked(np));
  btn.classList.toggle("dirty", ui.dirtyNotifyProfiles.has(npid));
}

function syncAllNotifyDirtyButtons() {
  document.querySelectorAll("[data-save-npname]").forEach((btn) => {
    const npid = btn.getAttribute("data-save-npname");
    syncNotifyDirtyButton(npid);
  });
}

function refreshAllNotifyDirtyStates() {
  const existing = new Set(state.notify_profiles.map((np) => np.id));
  Object.keys(ui.savedNotifySignatures).forEach((npid) => {
    if (!existing.has(npid)) {
      delete ui.savedNotifySignatures[npid];
      ui.dirtyNotifyProfiles.delete(npid);
    }
  });
  state.notify_profiles.forEach((np) => refreshNotifyDirtyState(np.id));
}

function clearAllDirtyNotifyProfiles() {
  ui.dirtyNotifyProfiles.clear();
}

function applyNotifyRuntimeStatus(update) {
  const npid = update?.profile_id;
  if (!npid) return;
  const np = state.notify_profiles.find((x) => x.id === npid);
  if (!np) return;

  const wasDirty = ui.dirtyNotifyProfiles.has(npid);

  if (update.active !== undefined) np.active = !!update.active;
  if (update.failure_count !== undefined) {
    const n = Number(update.failure_count);
    np.failure_count = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (update.sent_count !== undefined) {
    const n = Number(update.sent_count);
    np.sent_count = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  np._isNew = false;

  if (!wasDirty) {
    ui.savedNotifySignatures[npid] = computeNotifyProfileSignature(np);
  }

  refreshNotifyDirtyState(npid);
  renderNotifyProfiles();
}

function computeRunnerSignature(r) {
  const schedule = r?.schedule || {};
  const cases = Array.isArray(r?.cases) ? r.cases : [];
  const notifyIds = Array.isArray(r?.notify_profile_ids) ? [...r.notify_profile_ids].sort() : [];
  const updatesOnlyIds = Array.isArray(r?.notify_profile_updates_only) ? [...r.notify_profile_updates_only].sort() : [];
  return JSON.stringify({
    name: String(r?.name ?? ""),
    command: r?.command ?? "",
    logging_enabled: !!r?.logging_enabled,
    schedule: {
      hours: Number(schedule.hours ?? 0),
      minutes: Number(schedule.minutes ?? 0),
      seconds: Number(schedule.seconds ?? 0),
    },
    max_runs: Number(r?.max_runs ?? 1),
    alert_cooldown_s: Number(r?.alert_cooldown_s ?? 300),
    alert_escalation_s: Number(r?.alert_escalation_s ?? 1800),
    failure_pause_threshold: Number(r?.failure_pause_threshold ?? 5),
    notify_profile_ids: notifyIds,
    notify_profile_updates_only: updatesOnlyIds,
    cases: cases.map((c) => ({
      id: c?.id ?? "",
      pattern: c?.pattern ?? "",
      message_template: c?.message_template ?? "",
      state: c?.state ?? "",
    })),
  });
}

function syncSavedRunnerSignatures() {
  const next = {};
  state.runners.forEach((r, idx) => {
    next[r.id] = computeRunnerSignature(r);
  });
  ui.savedRunnerSignatures = next;
}

function refreshRunnerDirtyState(rid) {
  if (!rid) return;
  const r = state.runners.find((x) => x.id === rid);
  if (!r) {
    ui.dirtyRunners.delete(rid);
    const missingCard = document.querySelector(`.runner[data-runner-id="${rid}"]`);
    if (missingCard) {
      missingCard.classList.remove("is-dirty");
    }
    const missingNameInput = document.querySelector(`[data-name="${rid}"]`);
    if (missingNameInput) {
      missingNameInput.classList.remove("is-dirty");
    }
    return;
  }
  const currentSig = computeRunnerSignature(r);
  const savedSig = ui.savedRunnerSignatures[rid];
  if (savedSig === undefined || currentSig !== savedSig) {
    ui.dirtyRunners.add(rid);
  } else {
    ui.dirtyRunners.delete(rid);
  }
  const card = document.querySelector(`.runner[data-runner-id="${rid}"]`);
  const nameInput = document.querySelector(`[data-name="${rid}"]`);
  const isSaveableDirty = ui.dirtyRunners.has(rid) && !isRunnerSaveBlocked(r);
  if (card) {
    card.classList.toggle("is-dirty", isSaveableDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isSaveableDirty);
  }
}

function syncRunnerDirtyButton(rid) {
  const r = state.runners.find((x) => x.id === rid);
  const isSaveableDirty = !!r && ui.dirtyRunners.has(rid) && !isRunnerSaveBlocked(r);
  const card = document.querySelector(`.runner[data-runner-id="${rid}"]`);
  const nameInput = document.querySelector(`[data-name="${rid}"]`);
  if (card) {
    card.classList.toggle("is-dirty", isSaveableDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isSaveableDirty);
  }
  const btn = document.querySelector(`[data-save-name="${rid}"]`);
  if (!btn) return;
  btn.classList.toggle("invalid", isRunnerSaveBlocked(r));
  btn.classList.toggle("dirty", ui.dirtyRunners.has(rid));
}

function syncRunnerRunButton(rid) {
  const btn = document.querySelector(`[data-runstop="${rid}"]`);
  if (!btn) return;
  const r = state.runners.find((x) => x.id === rid);
  const rt = runtime.status[rid] || {};
  const isActive = !!rt.running || !!rt.scheduled;
  const shouldDisable = !isActive && isRunnerCommandMissing(r);
  btn.disabled = shouldDisable;
  if (shouldDisable) {
    btn.title = "Command fehlt: Bitte zuerst Command eintragen.";
  } else {
    btn.removeAttribute("title");
  }
}

function syncAllDirtyButtons() {
  document.querySelectorAll("[data-save-name]").forEach((btn) => {
    const rid = btn.getAttribute("data-save-name");
    syncRunnerDirtyButton(rid);
  });
}

function refreshAllRunnerDirtyStates() {
  const existing = new Set(state.runners.map((r) => r.id));
  Object.keys(ui.savedRunnerSignatures).forEach((rid) => {
    if (!existing.has(rid)) {
      delete ui.savedRunnerSignatures[rid];
      ui.dirtyRunners.delete(rid);
    }
  });
  state.runners.forEach((r) => refreshRunnerDirtyState(r.id));
}

function clearAllDirtyRunners() {
  ui.dirtyRunners.clear();
}

function notifyProfileValidationError(np) {
  if (!np) return "Unbekannter Notification-Dienst.";
  if ((np.name || "").trim() === "") return "Dienst-Name fehlt.";
  if ((np.type || "pushover") === "pushover") {
    if ((np.config?.user_key || "").trim() === "") return "User Key fehlt.";
    if ((np.config?.api_token || "").trim() === "") return "API Token fehlt.";
  }
  return "";
}

function hasUnsavedLocalChanges() {
  if (ui.dirtyNotifyProfiles.size > 0 || ui.dirtyRunners.size > 0) return true;
  if (state.notify_profiles.some((np) => !!np?._isNew)) return true;
  if (state.runners.some((r) => !!r?._isNew)) return true;
  return false;
}

function validateStateBeforePersist() {
  const blocking = [];
  for (const np of state.notify_profiles) {
    if (!np?._isNew) continue;
    const err = notifyProfileValidationError(np);
    if (err) blocking.push(`${np.name || np.id || "Neuer Dienst"}: ${err}`);
  }
  for (const r of state.runners) {
    if (!r?._isNew) continue;
    if (isRunnerCommandMissing(r)) {
      blocking.push(`Runner "${r.name || r.id || "Neu"}": Command fehlt.`);
    }
  }
  if (blocking.length === 0) return true;
  const msg = `SPEICHERN BLOCKIERT: ${blocking.join(" | ")}`;
  hulkFlash("error", msg);
  logHulk("error", `SAVE BLOCKIERT: ${blocking.join(" | ")}`);
  return false;
}

function renderNotifySection() {
  const count = state.notify_profiles.length;
  const title = el("notifySectionTitle");
  const toggle = el("notifySectionToggle");
  const body = el("notifySectionBody");
  const sortBtn = el("sortNotifyBtn");

  if (title) {
    title.textContent = count > 0 ? `Notification services (${count})` : "Notification services";
  }
  if (toggle) {
    toggle.textContent = ui.notifySectionCollapsed ? "+" : "-";
  }
  if (body) {
    body.classList.toggle("hidden", ui.notifySectionCollapsed);
  }
  if (count <= 1 && ui.notifySortMode) {
    ui.notifySortMode = false;
    saveUIState();
  }
  if (sortBtn) {
    sortBtn.classList.toggle("hidden", count <= 1);
  }
  syncSortModeButtons();
}

function renderRunnerSection() {
  const count = state.runners.length;
  const title = el("runnerSectionTitle");
  const toggle = el("runnerSectionToggle");
  const body = el("runnerSectionBody");
  const sortBtn = el("sortRunnerBtn");

  if (title) {
    title.textContent = count > 0 ? `Runners (${count})` : "Runners";
  }
  if (toggle) {
    toggle.textContent = ui.runnerSectionCollapsed ? "+" : "-";
  }
  if (body) {
    body.classList.toggle("hidden", ui.runnerSectionCollapsed);
  }
  if (count <= 1 && ui.runnerSortMode) {
    ui.runnerSortMode = false;
    saveUIState();
  }
  if (sortBtn) {
    sortBtn.classList.toggle("hidden", count <= 1);
  }
  syncSortModeButtons();
}

function scheduleOptions(max) {
  let opts = "";
  for (let i = 0; i <= max; i++) opts += `<option value="${i}">${i}</option>`;
  return opts;
}

function runsOptions() {
  let opts = `<option value="1">1</option>`;
  for (let i = 2; i <= 100; i++) opts += `<option value="${i}">${i}</option>`;
  opts += `<option value="-1">unendlich</option>`;
  return opts;
}

function formatSecondsLabel(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return "aus";
  if (s < 60) return `${s}s`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

function optionsFromValues(values, labelFn) {
  return values.map((v) => `<option value="${v}">${labelFn(v)}</option>`).join("");
}

function cooldownOptions() {
  return optionsFromValues([0, 30, 60, 120, 300, 600, 900, 1800, 3600], (v) => formatSecondsLabel(v));
}

function escalationOptions() {
  return optionsFromValues([0, 300, 600, 900, 1800, 3600, 7200, 14400], (v) => formatSecondsLabel(v));
}

function failurePauseOptions() {
  return optionsFromValues([0, 3, 5, 10, 15], (v) => (v === 0 ? "aus" : `${v} Fehler`));
}

function ensureSelectValue(sel, value, label) {
  if (!sel) return;
  const wanted = String(value);
  const exists = Array.from(sel.options).some((o) => o.value === wanted);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = wanted;
    opt.textContent = label || wanted;
    sel.appendChild(opt);
  }
  sel.value = wanted;
}

function caseStateOptions(selected) {
  const curr = (selected || "").toUpperCase();
  const vals = [
    ["", "(kein Status)"],
    ["UP", "UP"],
    ["DOWN", "DOWN"],
    ["WARN", "WARN"],
    ["INFO", "INFO"],
  ];
  return vals
    .map(([v, label]) => `<option value="${v}" ${curr === v ? "selected" : ""}>${label}</option>`)
    .join("");
}

function collectState() {
  return {
    notify_profiles: state.notify_profiles.map((np) => ({
      id: np.id,
      name: np.name,
      type: np.type,
      active: np.active !== false,
      failure_count: Number(np.failure_count || 0),
      sent_count: Number(np.sent_count || 0),
      config: {
        user_key: np.config.user_key,
        api_token: np.config.api_token,
      },
    })),
    runners: state.runners.map((r) => ({
      id: r.id,
      name: r.name,
      command: r.command,
      logging_enabled: !!r.logging_enabled,
      schedule: { hours: r.schedule.hours, minutes: r.schedule.minutes, seconds: r.schedule.seconds },
      max_runs: r.max_runs,
      alert_cooldown_s: Number(r.alert_cooldown_s || 300),
      alert_escalation_s: Number(r.alert_escalation_s || 1800),
      failure_pause_threshold: Number(r.failure_pause_threshold || 5),
      notify_profile_ids: r.notify_profile_ids || [],
      notify_profile_updates_only: r.notify_profile_updates_only || [],
      cases: r.cases.map((c) => ({ id: c.id, pattern: c.pattern, message_template: c.message_template, state: c.state || "" })),
    })),
  };
}

function setFromState(st) {
  clearAllDirtyNotifyProfiles();
  clearAllDirtyRunners();
  state.notify_profiles = (st.notify_profiles ?? []).map((np) => ({
    id: np.id ?? `notify_${uuidFallback()}`,
    name: np.name ?? "Pushover",
    type: np.type ?? "pushover",
    active: np.active !== false,
    failure_count: Number(np.failure_count || 0),
    sent_count: Number(np.sent_count || 0),
    config: {
      user_key: np.config?.user_key ?? "",
      api_token: np.config?.api_token ?? "",
    },
    _collapsed: true,
    _isNew: false,
  }));
  syncSavedNotifySignatures();

  state.runners = (st.runners ?? []).map((r) => ({
    id: r.id ?? `runner_${uuidFallback()}`,
    name: r.name ?? "Runner",
    command: r.command ?? "",
    logging_enabled: r.logging_enabled ?? true,
    schedule: {
      hours: r.schedule?.hours ?? 0,
      minutes: r.schedule?.minutes ?? 0,
      seconds: r.schedule?.seconds ?? 0,
    },
    max_runs: r.max_runs ?? 1,
    alert_cooldown_s: Number(r.alert_cooldown_s ?? 300),
    alert_escalation_s: Number(r.alert_escalation_s ?? 1800),
    failure_pause_threshold: Number(r.failure_pause_threshold ?? 5),
    notify_profile_ids: r.notify_profile_ids ?? [],
    notify_profile_updates_only: r.notify_profile_updates_only ?? [],
    cases: (r.cases ?? []).map((c) => ({
      id: c.id ?? `case_${uuidFallback()}`,
      pattern: c.pattern ?? "",
      message_template: c.message_template ?? "",
      state: c.state ?? "",
    })),
    _collapsed: true,
    _isNew: false,
  }));
  syncSavedRunnerSignatures();

  syncSortModeButtons();
  renderNotifySection();
  renderNotifyProfiles();
  renderRunners();
}

function renderNotifyProfiles() {
  renderNotifySection();
  const wrap = el("notifyProfiles");
  wrap.innerHTML = "";
  refreshAllNotifyDirtyStates();

  if (state.notify_profiles.length === 0) {
    wrap.innerHTML = '<p class="hint">Keine Notification services konfiguriert. Klicke auf "+ Dienst" um einen hinzuzufügen.</p>';
    return;
  }

  state.notify_profiles.forEach((np, idx) => {
    const isDirty = ui.dirtyNotifyProfiles.has(np.id);
    const saveBlocked = isNotifySaveBlocked(np);
    const isSaveableDirty = isDirty && !saveBlocked;
    const isActive = np.active !== false;
    const failCount = Math.max(0, Number(np.failure_count || 0));
    const sentCount = Math.max(0, Number(np.sent_count || 0));
    const notifyStatusText = !isActive
      ? (failCount >= 3
        ? `Inaktiv: ${failCount}/3 Fehlversuche. Gesendet: ${sentCount}.`
        : `Inaktiv: manuell. Gesendet: ${sentCount}.`)
      : (failCount > 0
        ? `Aktiv: ${failCount}/3 Fehlversuche. Gesendet: ${sentCount}.`
        : `Aktiv: OK. Gesendet: ${sentCount}.`);
    const notifyStatusKind = !isActive ? "error" : (failCount >= 2 ? "warn" : (failCount > 0 ? "info" : "ok"));
    const div = document.createElement("div");
    div.className = `notifyProfile${isSaveableDirty ? " is-dirty" : ""}`;
    div.dataset.notifyId = np.id;
    div.innerHTML = `
      <div class="notifyHead">
        <div class="notifyTitle">
          <div class="notifyTitleRow">
            <span class="toggle" data-toggle-notify="${np.id}">${np._collapsed ? "+" : "-"}</span>
            <input data-npname="${np.id}" value="${escapeHtml(np.name)}" placeholder="Dienst-Name" />
            <span class="small">${np.type}</span>
          </div>
          <span class="small notifyStateText ${notifyStatusKind}" title="${escapeHtml(notifyStatusText)}">${escapeHtml(notifyStatusText)}</span>
        </div>
        <div class="row gap center wrapline notifyActions">
          <div class="row gap center reorderControls ${ui.notifySortMode ? "" : "hidden"}">
            <button class="btn" data-move-np-up="${np.id}" ${idx === 0 ? "disabled" : ""} title="Nach oben">↑</button>
            <button class="btn" data-move-np-down="${np.id}" ${idx === state.notify_profiles.length - 1 ? "disabled" : ""} title="Nach unten">↓</button>
          </div>
          <button class="btn ${isActive ? "primary" : "danger"}" data-toggle-npactive="${np.id}" title="${isActive ? "Service aktiv (klicken zum Deaktivieren)" : "Service inaktiv (klicken zum Aktivieren)"}">${isActive ? "Aktiv" : "Inaktiv"}</button>
          <button class="btn" data-test-notify="${np.id}" ${isActive ? "" : "disabled title=\"Service ist inaktiv\""}>Test</button>
          <button class="btn primary notifySaveBtn ${isDirty ? "dirty" : ""} ${saveBlocked ? "invalid" : ""}" data-save-npname="${np.id}">💾 Speichern</button>
          <button class="btn danger" data-del-notify="${np.id}">Remove</button>
        </div>
      </div>
      <div class="notifyBody ${np._collapsed ? "hidden" : ""}" data-nbody="${np.id}">
        <div class="grid2">
          <label>
            <span>User Key</span>
            <input type="password" data-npuser="${np.id}" placeholder="${np.config.user_key ? '***gesetzt***' : 'User Key eingeben'}" />
          </label>
          <label>
            <span>API Token</span>
            <input type="password" data-nptoken="${np.id}" placeholder="${np.config.api_token ? '***gesetzt***' : 'API Token eingeben'}" />
          </label>
        </div>
        <p class="hint" style="margin-top:8px;">Zugangsdaten werden verschleiert angezeigt. Neueingabe überschreibt bestehende Werte.</p>
      </div>
    `;

    wrap.appendChild(div);
  });

  // Event handlers
  wrap.querySelectorAll("[data-toggle-notify]").forEach((t) => {
    t.addEventListener("click", () => {
      const npid = t.getAttribute("data-toggle-notify");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (!np) return;
      np._collapsed = !np._collapsed;
      document.querySelector(`[data-nbody="${npid}"]`)?.classList.toggle("hidden", np._collapsed);
      t.textContent = np._collapsed ? "+" : "-";
    });
  });

  wrap.querySelectorAll("[data-move-np-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-move-np-up");
      const idx = state.notify_profiles.findIndex((x) => x.id === npid);
      if (!moveItemInArray(state.notify_profiles, idx, idx - 1)) return;
      renderNotifyProfiles();
      await autoSave();
    });
  });

  wrap.querySelectorAll("[data-move-np-down]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-move-np-down");
      const idx = state.notify_profiles.findIndex((x) => x.id === npid);
      if (!moveItemInArray(state.notify_profiles, idx, idx + 1)) return;
      renderNotifyProfiles();
      await autoSave();
    });
  });

  wrap.querySelectorAll("[data-npname]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const npid = inp.getAttribute("data-npname");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (np) np.name = inp.value;
      refreshNotifyDirtyState(npid);
      syncNotifyDirtyButton(npid);
    });
  });

  wrap.querySelectorAll("[data-npuser]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const npid = inp.getAttribute("data-npuser");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (np) np.config.user_key = inp.value;
      refreshNotifyDirtyState(npid);
      syncNotifyDirtyButton(npid);
    });
  });

  wrap.querySelectorAll("[data-nptoken]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const npid = inp.getAttribute("data-nptoken");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (np) np.config.api_token = inp.value;
      refreshNotifyDirtyState(npid);
      syncNotifyDirtyButton(npid);
    });
  });

  // Save button for notify profiles
  wrap.querySelectorAll("[data-save-npname]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await autoSave();
    });
  });

  wrap.querySelectorAll("[data-toggle-npactive]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-toggle-npactive");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (!np) return;
      const nextActive = !(np.active !== false);
      np.active = nextActive;
      if (nextActive) {
        np.failure_count = 0;
      }
      refreshNotifyDirtyState(npid);
      renderNotifyProfiles();
      const saved = await autoSave();
      if (saved) {
        const label = np.name || npid;
        if (nextActive) {
          hulkFlash("success", `SERVICE "${label}" AKTIVIERT.`, 3200);
          logHulk("success", `SERVICE "${label}" AKTIVIERT.`);
        } else {
          hulkFlash("info", `SERVICE "${label}" DEAKTIVIERT.`, 3200);
          logHulk("info", `SERVICE "${label}" DEAKTIVIERT.`);
        }
      }
    });
  });

  wrap.querySelectorAll("[data-test-notify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-test-notify");
      const np = state.notify_profiles.find((x) => x.id === npid);
      if (!np) return;

      // Save first to ensure backend has latest config
      const saved = await autoSave();
      if (!saved) return;

      logHulk("info", `TESTE NOTIFICATION-DIENST "${np.name}"...`);
      hulkFlash("info", `TESTE NOTIFICATION-DIENST "${np.name}"...`, 3500);
      try {
        const res = await apiPost("/api/pushover_test", { profile_id: npid, message: "" });
        logHulk("success", `TEST OK FUER "${np.name}". RESPONSE: ${JSON.stringify(res.result)}`);
        hulkFlash("success", `TEST ERFOLGREICH FUER "${np.name}".`, 4200);
      } catch (e) {
        logHulk("error", `TEST FEHLGESCHLAGEN FUER "${np.name}": ${e.message}`);
        hulkFlash("error", `TEST FEHLGESCHLAGEN FUER "${np.name}": ${e.message}`);
      }
    });
  });

  wrap.querySelectorAll("[data-del-notify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-del-notify");
      const np = state.notify_profiles.find((x) => x.id === npid);
      const name = np ? np.name : "Dienst";

      if (!confirm(`Notification service "${name}" wirklich löschen?`)) {
        return;
      }

      state.notify_profiles = state.notify_profiles.filter((x) => x.id !== npid);
      // Remove from all runners
      state.runners.forEach((r) => {
        r.notify_profile_ids = (r.notify_profile_ids || []).filter((id) => id !== npid);
        r.notify_profile_updates_only = (r.notify_profile_updates_only || []).filter((id) => id !== npid);
      });
      renderNotifyProfiles();
      renderRunners();
      const saved = await autoSave();
      if (saved) {
        hulkFlash("success", `NOTIFICATION-SERVICE "${name}" ENTFERNT.`, 3200);
        logHulk("success", `NOTIFICATION-SERVICE "${name}" ENTFERNT.`);
      }
    });
  });
}

function renderCasesForRunner(rid) {
  const r = state.runners.find((x) => x.id === rid);
  const wrap = document.querySelector(`[data-cases="${rid}"]`);
  if (!r || !wrap) return;
  wrap.innerHTML = "";

  r.cases.forEach((c, idx) => {
    const div = document.createElement("div");
    div.className = "case";
    div.innerHTML = `
      <div class="small">Case ${idx + 1}</div>
      <div class="grid3" style="margin-top:8px;">
        <label>
          <span>pattern (Regex)</span>
          <input data-cpat="${c.id}" value="${escapeHtml(c.pattern)}" placeholder="z.B. passwort:\\s*(?P<pw>\\S+)" />
        </label>
        <label>
          <span>message template</span>
          <input data-cmsg="${c.id}" value="${escapeHtml(c.message_template)}" placeholder="z.B. Passwort: {pw}" />
        </label>
        <label>
          <span>Status</span>
          <select data-cstate="${c.id}">
            ${caseStateOptions(c.state || "")}
          </select>
        </label>
      </div>
      <div class="row between center" style="margin-top:10px;">
        <span class="small">Template: {match}, {g1}, {name} | Status fuer UP/DOWN/Recovery Logik</span>
        <button class="btn danger" data-crem="${c.id}">Remove</button>
      </div>
    `;
    wrap.appendChild(div);

    div.querySelector(`[data-cpat="${c.id}"]`).addEventListener("input", (e) => {
      const c2 = r.cases.find((x) => x.id === c.id);
      if (c2) {
        c2.pattern = e.target.value;
      }
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
    div.querySelector(`[data-cmsg="${c.id}"]`).addEventListener("input", (e) => {
      const c2 = r.cases.find((x) => x.id === c.id);
      if (c2) {
        c2.message_template = e.target.value;
      }
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
    div.querySelector(`[data-cstate="${c.id}"]`).addEventListener("change", (e) => {
      const c2 = r.cases.find((x) => x.id === c.id);
      if (c2) {
        c2.state = String(e.target.value || "");
      }
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
    div.querySelector(`[data-crem="${c.id}"]`).addEventListener("click", async () => {
      if (!confirm(`Case ${idx + 1} wirklich löschen?`)) {
        return;
      }
      r.cases = r.cases.filter((x) => x.id !== c.id);
      refreshRunnerDirtyState(rid);
      renderCasesForRunner(rid);
      syncRunnerDirtyButton(rid);
      await autoSave();
    });
  });
}

function renderRunners() {
  const wrap = el("runners");
  wrap.innerHTML = "";
  renderRunnerSection();
  refreshAllRunnerDirtyStates();
  const cloneBlockedByUnsaved = hasUnsavedLocalChanges();

  state.runners.forEach((r, idx) => {
    const rt = runtime.status[r.id] || {};
    const running = !!rt.running;
    const scheduled = !!rt.scheduled;
    const paused = !!rt.paused;
    const consecutiveFailures = Math.max(0, Number(rt.consecutive_failures || 0));
    const isActive = running || scheduled;
    const elapsedText = running ? formatElapsedSince(rt.started_ts) : "";
    const showElapsed = running && !!elapsedText;
    const maxRuns = Number(r.max_runs);
    const intervalSeconds =
      ((Number(r.schedule?.hours) || 0) * 3600) +
      ((Number(r.schedule?.minutes) || 0) * 60) +
      (Number(r.schedule?.seconds) || 0);
    const hasSchedule = intervalSeconds > 0;

    let statusPrefix = "";
    if (paused) {
      statusPrefix = `⏸ (${consecutiveFailures}) `;
    } else if (isActive && hasSchedule) {
      if (maxRuns === -1) {
        statusPrefix = `∞ (${rt.run_count || 0}) `;
      } else if (maxRuns > 1) {
        statusPrefix = `⏰ (${rt.run_count || 0}/${maxRuns}) `;
      }
    }
    const runnerStateParts = [];
    if (paused) {
      runnerStateParts.push(`Auto-Pause nach ${consecutiveFailures} Fehlern`);
    }
    if (rt.last_case) {
      runnerStateParts.push(`${formatTime(rt.last_case_ts)}: ${rt.last_case}`);
    }
    const runnerStateText = `${statusPrefix}${runnerStateParts.join(" | ")}`.trim();
    const isDirty = ui.dirtyRunners.has(r.id);
    const saveBlocked = isRunnerSaveBlocked(r);
    const isSaveableDirty = isDirty && !saveBlocked;
    const canClone = !cloneBlockedByUnsaved && !r._isNew && !isDirty && !saveBlocked;
    const cloneDisabledAttr = canClone ? "" : "disabled title=\"Nur im gespeicherten Zustand clonbar. Erst speichern.\"";
    const runDisabled = !isActive && isRunnerCommandMissing(r);

    const div = document.createElement("div");
    div.className = `runner${isSaveableDirty ? " is-dirty" : ""}`;
    div.dataset.runnerId = r.id;
    div.innerHTML = `
      <div class="runnerHead">
        <div class="runnerIdentity">
          <div class="runnerTitleRow">
            <span class="toggle" data-toggle="${r.id}">${r._collapsed ? "+" : "-"}</span>
            <input data-name="${r.id}" value="${escapeHtml(r.name)}" placeholder="Runner Name" />
          </div>
          <div class="runnerState">
            <div class="spinner ${isActive ? "" : "hidden"}" data-spinner="${r.id}"></div>
            <span class="pill runnerElapsed ${showElapsed ? "" : "hidden"}" data-runner-elapsed="${r.id}">${showElapsed ? `⏱ ${escapeHtml(elapsedText)}` : ""}</span>
            <span class="small runnerStateText">${escapeHtml(runnerStateText)}</span>
          </div>
        </div>
        <div class="runnerActions row gap wrapline center">
          <div class="row gap center reorderControls ${ui.runnerSortMode ? "" : "hidden"}">
            <button class="btn" data-move-runner-up="${r.id}" ${idx === 0 ? "disabled" : ""} title="Nach oben">↑</button>
            <button class="btn" data-move-runner-down="${r.id}" ${idx === state.runners.length - 1 ? "disabled" : ""} title="Nach unten">↓</button>
          </div>
          <button class="btn ${isActive ? "danger" : "primary"}" data-runstop="${r.id}" ${runDisabled ? "disabled title=\"Command fehlt: Bitte zuerst Command eintragen.\"" : ""}>
            ${isActive ? "■ Stop" : "▶ Run"}
          </button>
          <button class="btn primary runnerSaveBtn ${isDirty ? "dirty" : ""} ${saveBlocked ? "invalid" : ""}" data-save-name="${r.id}">💾 Speichern</button>
          <button class="btn" data-clone-runner="${r.id}" ${cloneDisabledAttr}>Clone</button>
          <button class="btn danger" data-delrunner="${r.id}">Remove</button>
        </div>
      </div>

      <div class="runnerBody ${r._collapsed ? "hidden" : ""}" data-body="${r.id}">
        <div class="runnerConfigGrid">
          <label class="runnerCommandBlock">
            <span>Command (bash -lc)</span>
            <textarea rows="7" data-command="${r.id}">${escapeHtml(r.command)}</textarea>
          </label>
          <div class="runnerSettingsPanel">
            <div class="runnerSettingsSection">
              <span class="small runnerSectionTitle">Benachrichtigungen</span>
              <div data-notify-checks="${r.id}" class="runnerNotifyChecks">
                ${state.notify_profiles.length === 0
                  ? '<span class="small" style="opacity:0.6;">Keine Dienste verfügbar</span>'
                  : state.notify_profiles.map((np) => {
                    const assigned = (r.notify_profile_ids || []).includes(np.id);
                    const onlyUpdates = assigned && (r.notify_profile_updates_only || []).includes(np.id);
                    return `
                      <div class="runnerNotifyRow">
                        <span class="runnerNotifyName">${escapeHtml(np.name)}</span>
                        <div class="row gap center runnerNotifyActions">
                          <button
                            class="btn ${assigned ? "primary" : ""}"
                            data-notify-toggle="${r.id}"
                            data-notify-profile="${np.id}"
                            title="${assigned ? "Benachrichtigung aktiv" : "Benachrichtigung aus"}"
                          >
                            ${assigned ? "Aktiv" : "Aus"}
                          </button>
                          <button
                            class="btn ${onlyUpdates ? "primary" : ""}"
                            data-notify-updates="${r.id}"
                            data-notify-profile="${np.id}"
                            ${assigned ? "" : "disabled title=\"Erst Aktiv einschalten\""}
                            title="${onlyUpdates ? "Nur Statuswechsel senden" : "Jeden Match senden"}"
                          >
                            Only updates
                          </button>
                        </div>
                      </div>
                    `;
                  }).join("")}
              </div>
            </div>

            <div class="runnerSettingsSection runnerLogButtons">
              <button class="btn ${r.logging_enabled ? "primary" : ""}" data-logging="${r.id}" title="Wenn aus: kein Schreiben in data/run_<runner_id>.log">📄 Logging ${r.logging_enabled ? "EIN" : "AUS"}</button>
              <button class="btn" data-openlog="${r.id}">📄 Log öffnen</button>
              <button class="btn danger" data-clearlog="${r.id}">🗑️ Log leeren</button>
            </div>

            <div class="runnerSettingsSection">
              <span class="small runnerSectionTitle">Scheduler (nach Run-Ende)</span>
              <div class="grid3 runnerScheduleGrid">
                <label><span>Stunden</span><select data-h="${r.id}">${scheduleOptions(23)}</select></label>
                <label><span>Minuten</span><select data-m="${r.id}">${scheduleOptions(59)}</select></label>
                <label><span>Sekunden</span><select data-s="${r.id}">${scheduleOptions(59)}</select></label>
              </div>
              <div class="runnerRunsWrap">
                <label><span>Anzahl Runs</span><select data-runs="${r.id}">${runsOptions()}</select></label>
              </div>
              <div class="grid3 runnerScheduleGrid" style="margin-top:10px;">
                <label>
                  <span>Alert-Cooldown</span>
                  <select data-cooldown="${r.id}">${cooldownOptions()}</select>
                </label>
                <label>
                  <span>Eskalation</span>
                  <select data-escalate="${r.id}">${escalationOptions()}</select>
                </label>
                <label>
                  <span>Auto-Pause</span>
                  <select data-failpause="${r.id}">${failurePauseOptions()}</select>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="runnerSection">
          <div class="runnerSectionHead">
            <h3>Cases</h3>
          </div>
          <p class="hint">
            Regex pro Output-Zeile. Jeder Match → Pushover (nur wenn Token+UserKey gesetzt).
            Leerer Case (pattern+message leer) → am Ende letzte Output-Zeile senden.
          </p>
          <div data-cases="${r.id}"></div>
          <div class="row" style="margin-top:10px; justify-content:flex-end;">
            <button class="btn" data-addcase="${r.id}">+ Case</button>
          </div>
        </div>

        <div class="runnerSection">
          <div class="runnerSectionHead">
            <h3>Output</h3>
            <button class="btn" data-copy-output="${r.id}" title="In Zwischenablage kopieren">📋 Copy</button>
          </div>
          <pre class="output runnerOutput" data-output="${r.id}"></pre>
        </div>
      </div>
    `;
    wrap.appendChild(div);

    div.querySelector(`[data-h="${r.id}"]`).value = String(r.schedule.hours);
    div.querySelector(`[data-m="${r.id}"]`).value = String(r.schedule.minutes);
    div.querySelector(`[data-s="${r.id}"]`).value = String(r.schedule.seconds);
    div.querySelector(`[data-runs="${r.id}"]`).value = String(r.max_runs);
    ensureSelectValue(
      div.querySelector(`[data-cooldown="${r.id}"]`),
      Number(r.alert_cooldown_s ?? 300),
      formatSecondsLabel(Number(r.alert_cooldown_s ?? 300)),
    );
    ensureSelectValue(
      div.querySelector(`[data-escalate="${r.id}"]`),
      Number(r.alert_escalation_s ?? 1800),
      formatSecondsLabel(Number(r.alert_escalation_s ?? 1800)),
    );
    ensureSelectValue(
      div.querySelector(`[data-failpause="${r.id}"]`),
      Number(r.failure_pause_threshold ?? 5),
      Number(r.failure_pause_threshold ?? 5) === 0 ? "aus" : `${Number(r.failure_pause_threshold ?? 5)} Fehler`,
    );

    renderCasesForRunner(r.id);

    const out = runnerOutputEl(r.id);
    if (out) out.textContent = runtime.outputs[r.id] || (rt.tail || "");

  });

  wrap.querySelectorAll(`[data-toggle]`).forEach((t) => {
    t.addEventListener("click", () => {
      const rid = t.getAttribute("data-toggle");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r._collapsed = !r._collapsed;
      document.querySelector(`[data-body="${rid}"]`)?.classList.toggle("hidden", r._collapsed);
      t.textContent = r._collapsed ? "+" : "-";
    });
  });

  wrap.querySelectorAll("[data-move-runner-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-move-runner-up");
      const idx = state.runners.findIndex((x) => x.id === rid);
      if (!moveItemInArray(state.runners, idx, idx - 1)) return;
      renderRunners();
      await autoSave();
    });
  });

  wrap.querySelectorAll("[data-move-runner-down]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-move-runner-down");
      const idx = state.runners.findIndex((x) => x.id === rid);
      if (!moveItemInArray(state.runners, idx, idx + 1)) return;
      renderRunners();
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-name]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const rid = inp.getAttribute("data-name");
      const r = state.runners.find((x) => x.id === rid);
      if (r) {
        r.name = inp.value;
      }
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-command]`).forEach((ta) => {
    ta.addEventListener("input", () => {
      const rid = ta.getAttribute("data-command");
      const r = state.runners.find((x) => x.id === rid);
      if (r) {
        r.command = ta.value;
      }
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
      syncRunnerRunButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-save-name]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-logging]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-logging");
      const r = state.runners.find((x) => x.id === rid);
      if (r) {
        r.logging_enabled = !r.logging_enabled;
        renderRunners();
        await autoSave();
      }
    });
  });

  wrap.querySelectorAll(`[data-openlog]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const rid = btn.getAttribute("data-openlog");
      window.open(apiUrl(`/api/log/${encodeURIComponent(rid)}`), "_blank");
    });
  });

  wrap.querySelectorAll(`[data-clearlog]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-clearlog");
      if (!confirm("Log-Datei wirklich leeren?")) return;

      try {
        await apiFetch(`/api/log/${encodeURIComponent(rid)}`, { method: "DELETE" });
        logHulk("success", `LOG FUER ${rid} GELEERT.`);
        hulkFlash("success", `LOG GELEERT FUER ${rid}.`, 3200);
      } catch (e) {
        logHulk("error", `LOG LEEREN FEHLGESCHLAGEN FUER ${rid}: ${e.message}`);
        hulkFlash("error", `LOG LEEREN FEHLGESCHLAGEN FUER ${rid}: ${e.message}`);
      }
    });
  });

  wrap.querySelectorAll(`[data-h],[data-m],[data-s]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-h") || sel.getAttribute("data-m") || sel.getAttribute("data-s");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      const h = Number(document.querySelector(`[data-h="${rid}"]`).value);
      const m = Number(document.querySelector(`[data-m="${rid}"]`).value);
      const s = Number(document.querySelector(`[data-s="${rid}"]`).value);
      r.schedule.hours = clampInt(h, 0, 23);
      r.schedule.minutes = clampInt(m, 0, 59);
      r.schedule.seconds = clampInt(s, 0, 59);
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-runs]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-runs");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r.max_runs = Number(sel.value);
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-cooldown]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-cooldown");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r.alert_cooldown_s = Math.max(0, Number(sel.value || 0));
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-escalate]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-escalate");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r.alert_escalation_s = Math.max(0, Number(sel.value || 0));
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-failpause]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-failpause");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r.failure_pause_threshold = Math.max(0, Number(sel.value || 0));
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-notify-toggle]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-notify-toggle");
      const npid = btn.getAttribute("data-notify-profile");
      const r = state.runners.find((x) => x.id === rid);
      if (!r || !npid) return;

      const selected = new Set(r.notify_profile_ids || []);
      const updatesOnly = new Set(r.notify_profile_updates_only || []);
      if (selected.has(npid)) {
        selected.delete(npid);
        updatesOnly.delete(npid);
      } else {
        selected.add(npid);
      }
      r.notify_profile_ids = Array.from(selected);
      r.notify_profile_updates_only = Array.from(updatesOnly);

      refreshRunnerDirtyState(rid);
      renderRunners();
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-notify-updates]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-notify-updates");
      const npid = btn.getAttribute("data-notify-profile");
      const r = state.runners.find((x) => x.id === rid);
      if (!r || !npid) return;
      if (!(r.notify_profile_ids || []).includes(npid)) return;

      const updatesOnly = new Set(r.notify_profile_updates_only || []);
      if (updatesOnly.has(npid)) {
        updatesOnly.delete(npid);
      } else {
        updatesOnly.add(npid);
      }
      r.notify_profile_updates_only = Array.from(updatesOnly);

      refreshRunnerDirtyState(rid);
      renderRunners();
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-addcase]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-addcase");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;
      r.cases.push({ id: `case_${uuidFallback()}`, pattern: "", message_template: "" });
      refreshRunnerDirtyState(rid);
      renderCasesForRunner(rid);
      syncRunnerDirtyButton(rid);
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-delrunner]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-delrunner");
      const r = state.runners.find((x) => x.id === rid);
      const name = r ? r.name : "Runner";

      if (!confirm(`Runner "${name}" wirklich löschen?`)) {
        return;
      }

      state.runners = state.runners.filter((x) => x.id !== rid);
      delete runtime.status[rid];
      delete runtime.outputs[rid];
      renderRunners();
      const saved = await autoSave();
      if (saved) {
        hulkFlash("success", `RUNNER "${name}" ENTFERNT.`, 3200);
        logHulk("success", `RUNNER "${name}" ENTFERNT.`);
      }
    });
  });

  wrap.querySelectorAll(`[data-runstop]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-runstop");
      const rt = runtime.status[rid] || {};
      const isActive = rt.running || rt.scheduled;

      try {
        if (isActive) {
          // Stop action
          await apiPost("/api/stop", { runner_id: rid });
          hulkFlash("info", `STOPP-SIGNAL AN ${rid} GESENDET.`, 3000);
          logHulk("info", `STOPP-SIGNAL AN ${rid} GESENDET.`);
        } else {
          // Run action
          if (!validateStateBeforePersist()) return;
          const r = state.runners.find((x) => x.id === rid);
          if (isRunnerCommandMissing(r)) {
            hulkFlash("error", `RUN NICHT MOEGLICH: BEI ${rid} FEHLT DER COMMAND.`);
            logHulk("error", `RUN BLOCKIERT: COMMAND FEHLT BEI ${rid}.`);
            syncRunnerRunButton(rid);
            syncRunnerDirtyButton(rid);
            return;
          }
          runtime.outputs[rid] = "";
          const out = runnerOutputEl(rid);
          if (out) out.textContent = "";
          await apiPost("/api/run", { state: collectState(), runner_id: rid });
          hulkFlash("success", `${rid} STARTET JETZT.`, 3200);
          logHulk("success", `${rid} STARTET JETZT.`);
        }
      } catch (e) {
        const msg = e?.message || String(e);
        hulkFlash("error", `RUN/STOP FEHLGESCHLAGEN FUER ${rid}: ${msg}`);
        logHulk("error", `RUN/STOP FEHLGESCHLAGEN FUER ${rid}: ${msg}`);
      }
    });
  });

  wrap.querySelectorAll(`[data-copy-output]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-copy-output");
      const out = runnerOutputEl(rid);
      if (!out) return;

      const text = out.textContent || "";
      try {
        const copied = await copyText(text);
        if (!copied) {
          throw new Error("Browser blockiert Zwischenablage.");
        }
        const originalText = btn.textContent;
        btn.textContent = "✓ Copied";
        hulkFlash("success", `OUTPUT VON ${rid} IN ZWISCHENABLAGE KOPIERT.`, 2600);
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (e) {
        logHulk("error", `COPY FEHLGESCHLAGEN: ${e.message}`);
        hulkFlash("error", `COPY FEHLGESCHLAGEN: ${e.message}`);
      }
    });
  });

  wrap.querySelectorAll(`[data-clone-runner]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-clone-runner");
      const r = state.runners.find((x) => x.id === rid);
      if (!r) return;

      if (hasUnsavedLocalChanges() || !!r._isNew || ui.dirtyRunners.has(rid) || isRunnerSaveBlocked(r)) {
        const msg = "CLONE BLOCKIERT: BITTE ZUERST ALLE AENDERUNGEN SPEICHERN.";
        hulkFlash("info", msg, 4200);
        logHulk("info", msg);
        renderRunners();
        renderNotifyProfiles();
        return;
      }

      try {
        const res = await apiPost("/api/clone_runner", { runner_id: rid });
        const st = await apiGet("/api/state");
        setFromState(st);
        const sourceName = r.name || rid;
        const targetName = res?.cloned_name ? ` -> "${res.cloned_name}"` : "";
        hulkFlash("success", `RUNNER "${sourceName}" GEKLONT${targetName}.`, 3600);
        logHulk("success", `RUNNER "${sourceName}" GEKLONT${targetName}.`);
      } catch (e) {
        hulkFlash("error", `CLONE FEHLGESCHLAGEN: ${e.message}`);
        logHulk("error", `RUNNER-CLONE FEHLGESCHLAGEN: ${e.message}`);
      }
    });
  });

}

function setInfoModalOpen(open) {
  const modal = el("infoModal");
  if (!modal) return;
  const isOpen = !!open;
  modal.classList.toggle("hidden", !isOpen);
  modal.setAttribute("aria-hidden", isOpen ? "false" : "true");
  document.body.classList.toggle("modalOpen", isOpen);
}

function apiUrl(url) {
  return new URL(url, window.location.origin).toString();
}

async function apiFetch(url, options) {
  return fetch(apiUrl(url), options);
}

async function apiGet(url) {
  const r = await apiFetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function apiPost(url, body) {
  const r = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(payload?.error || text);
  return payload ?? {};
}

async function loadNotifyJournal() {
  try {
    const res = await apiGet("/api/notifications?limit=250");
    const items = Array.isArray(res?.items) ? res.items : [];
    ui.notifyJournalEntries = items.slice().reverse();
    renderNotifyJournal();
  } catch (e) {
    ui.notifyJournalEntries = [];
    renderNotifyJournal();
    logHulk("error", `JOURNAL-LADEN FEHLGESCHLAGEN: ${e.message}`);
  }
}

function updateGlobalRunningStatus() {
  const runningCount = Object.values(runtime.status).filter((s) => s.running).length;
  const scheduledCount = Object.values(runtime.status).filter((s) => s.scheduled && !s.running).length;
  const spinner = el("globalSpinner");
  const count = el("runningCount");

  const hasActivity = runningCount > 0 || scheduledCount > 0;

  if (hasActivity) {
    spinner?.classList.remove("hidden");
    const parts = [];
    if (runningCount > 0) parts.push(`${runningCount} running`);
    if (scheduledCount > 0) parts.push(`${scheduledCount} scheduled`);
    if (count) count.textContent = parts.join(", ");
  } else {
    spinner?.classList.add("hidden");
    if (count) count.textContent = "";
  }
}

function delayedStatusUpdate(rid, updateFn, minSpinnerMs = 500) {
  const startTime = runtime.spinnerStartTimes[rid];
  if (!startTime) {
    // No start time recorded, update immediately
    updateFn();
    return;
  }

  const elapsed = Date.now() - startTime;
  const remaining = minSpinnerMs - elapsed;

  if (remaining > 0) {
    // Delay the update to ensure minimum spinner duration
    setTimeout(() => {
      delete runtime.spinnerStartTimes[rid];
      updateFn();
    }, remaining);
  } else {
    // Enough time has passed, update immediately
    delete runtime.spinnerStartTimes[rid];
    updateFn();
  }
}

function startEvents() {
  const es = new EventSource(apiUrl("/api/events"));
  es.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data);

      if (ev.type === "snapshot") {
        runtime.status = ev.snapshot || {};
        renderRunners();
        tickRunnerElapsed();
        updateGlobalRunningStatus();
        return;
      }

      if (ev.type === "status") {
        const rid = ev.runner_id;
        runtime.status[rid] = runtime.status[rid] || {};
        if (ev.consecutive_failures !== undefined) {
          runtime.status[rid].consecutive_failures = Number(ev.consecutive_failures || 0);
        }
        if (ev.status === "started") {
          runtime.spinnerStartTimes[rid] = Date.now();
          runtime.status[rid].running = true;
          runtime.status[rid].scheduled = false;
          runtime.status[rid].paused = false;
          runtime.status[rid].started_ts = ev.ts || new Date().toISOString();
          if (ev.run_count !== undefined) {
            runtime.status[rid].run_count = ev.run_count;
          }
          if (ev.remaining !== undefined) {
            runtime.status[rid].remaining = ev.remaining;
          }
          logHulk("info", `${rid}: RUN GESTARTET.`, ev.ts);
          renderRunners();
          updateGlobalRunningStatus();
        } else if (ev.status === "stopping") {
          logHulk("info", `${rid}: STOPPE RUN...`, ev.ts);
        } else if (ev.status === "stopped") {
          logHulk("info", `${rid}: RUN GESTOPPT.`, ev.ts);
          delayedStatusUpdate(rid, () => {
            runtime.status[rid].running = false;
            runtime.status[rid].scheduled = false;
            delete runtime.status[rid].started_ts;
            renderRunners();
            tickRunnerElapsed();
            updateGlobalRunningStatus();
          });
        } else if (ev.status === "scheduled") {
          runtime.status[rid].scheduled = true;
          logHulk("info", `${rid}: NAECHSTER RUN IN ${ev.in_s} SEKUNDEN GEPLANT.`, ev.ts);
          renderRunners();
          tickRunnerElapsed();
          updateGlobalRunningStatus();
        } else if (ev.status === "paused") {
          runtime.status[rid].running = false;
          runtime.status[rid].scheduled = false;
          runtime.status[rid].paused = true;
          delete runtime.status[rid].started_ts;
          runtime.status[rid].consecutive_failures = Number(ev.consecutive_failures || runtime.status[rid].consecutive_failures || 0);
          const msg = `${rid}: AUTO-PAUSE NACH ${runtime.status[rid].consecutive_failures} FEHLERN. MANUELLER RUN NEEDED.`;
          logHulk("error", msg, ev.ts);
          hulkFlash("error", msg, 5200);
          renderRunners();
          tickRunnerElapsed();
          updateGlobalRunningStatus();
        } else if (ev.status === "finished") {
          const kind = ev.stopped ? "info" : (Number(ev.exit_code) === 0 ? "success" : "error");
          logHulk(kind, `${rid}: RUN BEENDET (EXIT=${ev.exit_code}, STOPPED=${ev.stopped}).`, ev.ts);
          if (!ev.stopped && Number(ev.exit_code) !== 0) {
            hulkFlash("error", `${rid} BEENDET MIT FEHLER (EXIT=${ev.exit_code}).`);
          }
          delayedStatusUpdate(rid, () => {
            runtime.status[rid].running = false;
            delete runtime.status[rid].started_ts;
            renderRunners();
            tickRunnerElapsed();
            updateGlobalRunningStatus();
          });
        }
        return;
      }

      if (ev.type === "output") {
        const rid = ev.runner_id;
        runtime.outputs[rid] = (runtime.outputs[rid] || "") + ev.line;
        const out = runnerOutputEl(rid);
        if (out) {
          out.textContent += ev.line;
          out.scrollTop = out.scrollHeight;
        }
        return;
      }

      if (ev.type === "case_match") {
        const rid = ev.runner_id;

        runtime.status[rid] = runtime.status[rid] || {};
        runtime.status[rid].last_case = ev.message;
        runtime.status[rid].last_case_ts = ev.ts;
        logHulk("success", `${rid}: CASE MATCH -> ${ev.message}`, ev.ts);
        renderRunners();
        return;
      }

      if (ev.type === "case_error") {
        logHulk("error", `${ev.runner_id}: CASE ERROR (${ev.pattern}): ${ev.error}`);
        hulkFlash("error", `${ev.runner_id}: CASE ERROR (${ev.pattern})`);
        return;
      }

      if (ev.type === "notify_profile_status") {
        appendNotifyJournalFromStatusEvent(ev);
        applyNotifyRuntimeStatus(ev);
        return;
      }

      if (ev.type === "notify_profile_auto_disabled") {
        const npid = ev.profile_id;
        const np = state.notify_profiles.find((x) => x.id === npid);
        const label = ev.profile_name || np?.name || npid || "Service";
        const failCount = Math.max(3, Number(ev.failure_count || 3));
        const reason = (ev.reason || "").trim();
        const baseMsg = `${label} wurde nach ${failCount} Fehlern deaktiviert.`;
        const msg = reason ? `${baseMsg} Grund: ${reason}` : baseMsg;
        logHulk("error", msg, ev.ts);
        hulkFlash("error", msg, 6500);
        applyNotifyRuntimeStatus({
          profile_id: npid,
          active: false,
          failure_count: failCount,
          sent_count: ev.sent_count,
        });
        return;
      }
    } catch (e) {
      console.error(e);
    }
  };
  es.onerror = () => {
    const now = Date.now();
    if (now - lastSseErrorAt < 20000) return;
    lastSseErrorAt = now;
    hulkFlash("error", "Event-Stream instabil. Verbindung wird neu aufgebaut.", 4500);
    logHulk("error", "EVENT-STREAM VERBINDUNG INSTABIL.");
  };
}

async function autoSave() {
  if (!validateStateBeforePersist()) return false;
  try {
    await apiPost("/api/state", collectState());
    state.notify_profiles.forEach((np) => {
      np._isNew = false;
    });
    state.runners.forEach((r) => {
      r._isNew = false;
    });
    // Keep credentials masked in client state after successful save.
    maskNotifySecretsInState();
    syncSavedNotifySignatures();
    syncSavedRunnerSignatures();
    clearAllDirtyNotifyProfiles();
    clearAllDirtyRunners();
    syncAllNotifyDirtyButtons();
    syncAllDirtyButtons();
    logHulk("success", "AUTO-SAVE ERFOLGREICH.");
    return true;
  } catch (e) {
    logHulk("error", `SAVE FEHLGESCHLAGEN: ${e.message}`);
    hulkFlash("error", `SPEICHERN FEHLGESCHLAGEN: ${e.message}`);
    return false;
  }
}

async function wireUI() {
  const openInfoTitle = el("openInfoTitle");
  const closeInfoBtn = el("closeInfoBtn");
  const infoModal = el("infoModal");

  openInfoTitle?.addEventListener("click", () => setInfoModalOpen(true));
  openInfoTitle?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setInfoModalOpen(true);
    }
  });
  closeInfoBtn?.addEventListener("click", () => setInfoModalOpen(false));
  infoModal?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-info]")) {
      setInfoModalOpen(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setInfoModalOpen(false);
    }
  });

  el("notifySectionToggle").addEventListener("click", () => {
    ui.notifySectionCollapsed = !ui.notifySectionCollapsed;
    saveUIState();
    renderNotifySection();
  });

  el("runnerSectionToggle")?.addEventListener("click", () => {
    ui.runnerSectionCollapsed = !ui.runnerSectionCollapsed;
    saveUIState();
    renderRunnerSection();
  });

  el("sortNotifyBtn")?.addEventListener("click", () => {
    ui.notifySortMode = !ui.notifySortMode;
    saveUIState();
    syncSortModeButtons();
    renderNotifyProfiles();
    hulkFlash("info", `NOTIFICATION-SORTIERMODUS ${ui.notifySortMode ? "AKTIV" : "AUS"}.`, 2200);
  });

  el("sortRunnerBtn")?.addEventListener("click", () => {
    ui.runnerSortMode = !ui.runnerSortMode;
    saveUIState();
    syncSortModeButtons();
    renderRunners();
    hulkFlash("info", `RUNNER-SORTIERMODUS ${ui.runnerSortMode ? "AKTIV" : "AUS"}.`, 2200);
  });

  el("clearNotifyJournalBtn")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/notifications", { method: "DELETE" });
      ui.notifyJournalEntries = [];
      renderNotifyJournal();
      hulkFlash("success", "NOTIFICATION-JOURNAL GELEERT.", 2600);
      logHulk("success", "NOTIFICATION-JOURNAL GELEERT.");
    } catch (e) {
      hulkFlash("error", `JOURNAL LEEREN FEHLGESCHLAGEN: ${e.message}`);
      logHulk("error", `JOURNAL LEEREN FEHLGESCHLAGEN: ${e.message}`);
    }
  });

  el("clearEventsBtn")?.addEventListener("click", () => {
    const out = el("events");
    if (out) out.textContent = "";
    hulkFlash("success", "EVENTS GELEERT.", 2200);
  });

  el("addNotifyBtn").addEventListener("click", () => {
    ui.notifySectionCollapsed = false;
    saveUIState();
    state.notify_profiles.push({
      id: `notify_${uuidFallback()}`,
      name: "Neuer Pushover-Dienst",
      type: "pushover",
      active: true,
      failure_count: 0,
      sent_count: 0,
      config: { user_key: "", api_token: "" },
      _collapsed: false,
      _isNew: true,
    });
    renderNotifyProfiles();
    hulkFlash("info", "NEUER NOTIFICATION-DIENST ERSTELLT. PFLICHTFELDER AUSFUELLEN UND SPEICHERN.", 4500);
  });

  el("addRunnerBtn").addEventListener("click", async () => {
    ui.runnerSectionCollapsed = false;
    saveUIState();
    const rid = `runner_${uuidFallback()}`;
    state.runners.push({
      id: rid,
      name: "New Runner",
      command: "",
      logging_enabled: true,
      schedule: { hours: 0, minutes: 0, seconds: 0 },
      max_runs: 1,
      alert_cooldown_s: 300,
      alert_escalation_s: 1800,
      failure_pause_threshold: 5,
      notify_profile_ids: [],
      notify_profile_updates_only: [],
      cases: [],
      _collapsed: false,
      // Runner can be persisted without a command; it just cannot be started until a command is set.
      _isNew: false,
    });
    renderRunners();
    const saved = await autoSave();
    if (saved) {
      hulkFlash("success", "NEUER RUNNER ERSTELLT UND GESPEICHERT.", 3200);
      logHulk("success", `RUNNER ${rid} ERSTELLT UND GESPEICHERT.`);
    }
  });

  el("exportBtn").addEventListener("click", async () => {
    logHulk("info", "EXPORT WIRD GESTARTET...");
    hulkFlash("info", "EXPORT WIRD GESTARTET...", 2800);
    try {
      const a = document.createElement("a");
      a.href = apiUrl("/api/export");
      a.download = `command-runner-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logHulk("success", "EXPORT GESTARTET. DOWNLOAD SOLLTE JETZT LAUFEN.");
      hulkFlash("success", "EXPORT GESTARTET. DOWNLOAD SOLLTE JETZT LAUFEN.", 3800);
    } catch (e) {
      logHulk("error", `EXPORT FEHLGESCHLAGEN: ${e.message}`);
      hulkFlash("error", `EXPORT FEHLGESCHLAGEN: ${e.message}`);
    }
  });

  el("importBtn").addEventListener("click", () => {
    el("importFile").click();
  });

  el("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logHulk("info", `IMPORT LAEUFT: ${file.name}`);
    hulkFlash("info", `IMPORT LAEUFT: ${file.name}`, 2800);
    try {
      const text = await file.text();
      const res = await apiFetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result?.error || result?.detail || "Import failed");
      }
      logHulk("success", `IMPORT ERFOLGREICH: ${result.imported_count} RUNNER UEBERNOMMEN.`);
      hulkFlash("success", `IMPORT ERFOLGREICH: ${result.imported_count} RUNNER UEBERNOMMEN.`, 4200);

      // Reload state from server
      const st = await apiGet("/api/state");
      setFromState(st);
    } catch (e) {
      logHulk("error", `IMPORT FEHLGESCHLAGEN: ${e.message}`);
      hulkFlash("error", `IMPORT FEHLGESCHLAGEN: ${e.message}`);
    } finally {
      e.target.value = "";
    }
  });
}

(async function main() {
  try {
    const st = await apiGet("/api/state");
    setFromState(st);
    await loadNotifyJournal();
    startEvents();
    startRunnerElapsedTicker();
    await wireUI();
    hulkFlash("success", "System bereit.", 2800);
    logHulk("success", "SYSTEM BEREIT.");
  } catch (e) {
    const msg = e?.message || String(e);
    hulkFlash("error", `START FEHLGESCHLAGEN: ${msg}`);
    logHulk("error", `START FEHLGESCHLAGEN: ${msg}`);
    console.error(e);
  }
})();
