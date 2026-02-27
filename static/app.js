const el = (id) => document.getElementById(id);

const state = {
  notify_profiles: [],
  runners: [],
  runner_groups: [],
  runner_layout: [],
};

const runtime = {
  status: {},
  groupStatus: {},
  outputs: {},
  spinnerStartTimes: {},
};

const UI_STORAGE_KEY = "multi-command-runner.ui";
const MASKED_SECRET = "__SECRET_SET__";
const LANG_ORDER = ["de", "en", "fr", "zh"];
const LANG_FALLBACK = "de";
const LANG_LABELS = { de: "DE", en: "EN", fr: "FR", zh: "中文" };
const LANG_LOCALES = { de: "de-DE", en: "en-US", fr: "fr-FR", zh: "zh-CN" };

function normalizeLang(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s.startsWith("de")) return "de";
  if (s.startsWith("en")) return "en";
  if (s.startsWith("fr")) return "fr";
  if (s.startsWith("zh") || s.startsWith("cn")) return "zh";
  return "";
}

function detectDefaultLang() {
  const nav = normalizeLang(navigator.language || "");
  return nav || LANG_FALLBACK;
}

function loadUIState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      notifySectionCollapsed: !!parsed.notifySectionCollapsed,
      runnerSectionCollapsed: !!parsed.runnerSectionCollapsed,
      notifyJournalSectionCollapsed: !!parsed.notifyJournalSectionCollapsed,
      eventsSectionCollapsed: !!parsed.eventsSectionCollapsed,
      notifySortMode: !!parsed.notifySortMode,
      runnerSortMode: !!parsed.runnerSortMode,
      lang: normalizeLang(parsed.lang) || "",
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
        notifyJournalSectionCollapsed: !!ui.notifyJournalSectionCollapsed,
        eventsSectionCollapsed: !!ui.eventsSectionCollapsed,
        notifySortMode: !!ui.notifySortMode,
        runnerSortMode: !!ui.runnerSortMode,
        lang: ui.lang,
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
  notifyJournalSectionCollapsed: loadedUIState.notifyJournalSectionCollapsed ?? false,
  eventsSectionCollapsed: loadedUIState.eventsSectionCollapsed ?? false,
  notifySortMode: loadedUIState.notifySortMode ?? false,
  runnerSortMode: loadedUIState.runnerSortMode ?? false,
  lang: loadedUIState.lang || detectDefaultLang(),
  notifyJournalEntries: [],
  dirtyNotifyProfiles: new Set(),
  savedNotifySignatures: {},
  dirtyRunners: new Set(),
  savedRunnerSignatures: {},
  dirtyRunnerGroups: new Set(),
  savedRunnerGroupSignatures: {},
};

const I18N = {
  de: {
    sort_label: "Sortieren: {state}",
    sort_on: "An",
    sort_off: "Aus",
    no_changes: "Keine Änderungen",
    open_info_title: "Öffnet die Programm-Info",
    lang_switch_aria: "Sprache",
    lang_toggle_title_to_en: "Zu Englisch wechseln",
    lang_toggle_title_to_de: "Zu Deutsch wechseln",
    lang_toggle_title_to_fr: "Zu Franzosisch wechseln",
    lang_toggle_title_to_zh: "Zu Chinesisch wechseln",
    notify_services_title: "Notification services",
    runners_title: "Runners",
    add_service: "+ Dienst",
    add_group: "+ Multi-Runner",
    add_runner: "+ Runner",
    export: "⬇ Export",
    import: "⬆ Import",
    notification_journal: "Notification journal",
    clear_journal: "Journal leeren",
    events: "Events",
    clear_events: "Events leeren",
    close: "Schließen",
    active_since: "Aktiv seit: {elapsed}",
    journal_error: "FEHLER",
    cmd_missing_reason: "Command fehlt: Bitte zuerst Command eintragen.",
    cmd_missing_short: "Command fehlt.",
    save_first_reason: "Bitte zuerst speichern (Bearbeitungsmodus).",
    unknown_notify_service: "Unbekannter Notification-Dienst.",
    service_name_missing: "Dienst-Name fehlt.",
    user_key_missing: "User Key fehlt.",
    api_token_missing: "API Token fehlt.",
    service_fallback: "Dienst",
    new_service_fallback: "Neuer Dienst",
    new_runner_fallback: "Neu",
    save_blocked: "SPEICHERN BLOCKIERT: {reasons}",
    save_blocked_log: "SAVE BLOCKIERT: {reasons}",
    infinite: "unendlich",
    off: "aus",
    failures: "{n} Fehler",
    no_status: "(kein Status)",
    notify_none_configured: "Keine Notification services konfiguriert. Klicke auf \"+ Dienst\" um einen hinzuzufügen.",
    service_name_placeholder: "Dienst-Name",
    move_up: "Nach oben",
    move_down: "Nach unten",
    service_active_title: "Service aktiv (klicken zum Deaktivieren)",
    service_inactive_title: "Service inaktiv (klicken zum Aktivieren)",
    active: "Aktiv",
    inactive: "Inaktiv",
    service_inactive: "Service ist inaktiv",
    save: "💾 Speichern",
    remove: "Remove",
    secret_set: "***gesetzt***",
    user_key_enter: "User Key eingeben",
    api_token_enter: "API Token eingeben",
    creds_hint: "Zugangsdaten werden verschleiert angezeigt. Neueingabe überschreibt bestehende Werte.",
    service_enabled: "SERVICE \"{label}\" AKTIVIERT.",
    service_disabled: "SERVICE \"{label}\" DEAKTIVIERT.",
    test_notify_start: "TESTE NOTIFICATION-DIENST \"{name}\"...",
    test_ok_log: "TEST OK FUER \"{name}\". RESPONSE: {response}",
    test_ok_flash: "TEST ERFOLGREICH FUER \"{name}\".",
    test_fail: "TEST FEHLGESCHLAGEN FUER \"{name}\": {err}",
    confirm_delete_notify: "Notification service \"{name}\" wirklich löschen?",
    notify_removed: "NOTIFICATION-SERVICE \"{name}\" ENTFERNT.",
    notify_status_inactive_auto: "Inaktiv: {fail}/3 Fehlversuche. Gesendet: {sent}.",
    notify_status_inactive_manual: "Inaktiv: manuell. Gesendet: {sent}.",
    notify_status_active_fail: "Aktiv: {fail}/3 Fehlversuche. Gesendet: {sent}.",
    notify_status_active_ok: "Aktiv: OK. Gesendet: {sent}.",
    notify_auto_disabled_base: "{label} wurde nach {fail} Fehlern deaktiviert.",
    notify_auto_disabled_reason_suffix: " Grund: {reason}",
    confirm_delete_case: "Case {idx} wirklich löschen?",
    case_pattern_placeholder: "z.B. passwort:\\s*(?P<pw>\\S+)",
    case_message_placeholder: "z.B. Passwort: {pw}",
    case_help: "Template: {match}, {g1}, {name} | Status fuer UP/DOWN/Recovery/STOP Logik",
    runner_placeholder: "Runner Name",
    group_placeholder: "Multi-Runner-Name",
    lock_active_title: "Während Run aktiv gesperrt.",
    clone_needs_saved_title: "Nur im gespeicherten Zustand clonbar. Erst speichern.",
    notifications: "Benachrichtigungen",
    no_services_available: "Keine Dienste verfügbar",
    notify_on_title: "Benachrichtigung EIN",
    notify_off_title: "Benachrichtigung AUS",
    on: "Ein",
    off_short: "Aus",
    enable_first: "Erst Ein schalten",
    updates_only: "Updates only",
    updates_only_title_on: "Nur Statuswechsel senden",
    updates_only_title_off: "Jeden Match senden",
    logging_title: "Wenn aus: kein Schreiben in data/run_<runner_id>.log",
    logging_on: "EIN",
    logging_off: "AUS",
    open_log: "📄 Log öffnen",
    clear_log: "🗑️ Log leeren",
    confirm_clear_log: "Log-Datei wirklich leeren?",
    log_cleared_log: "LOG FUER {rid} GELEERT.",
    log_cleared_flash: "LOG GELEERT FUER {rid}.",
    log_clear_failed: "LOG LEEREN FEHLGESCHLAGEN FUER {rid}: {err}",
    scheduler: "Scheduler (nach Run-Ende)",
    hours: "Stunden",
    minutes: "Minuten",
    seconds: "Sekunden",
    total_runs: "Anzahl Runs",
    alert_cooldown: "Alert-Cooldown",
    escalation: "Eskalation",
    auto_pause: "Auto-Pause",
    cases: "Cases",
    cases_hint: "Regex pro Output-Zeile. Jeder Match → Pushover (nur wenn Token+UserKey gesetzt). Leerer Case (pattern+message leer) → am Ende letzte Output-Zeile senden.",
    add_case: "+ Case",
    add_case_title: "Neuen Case hinzufügen",
    copy: "📋 Copy",
    copy_title: "In Zwischenablage kopieren",
    output: "Output",
    clipboard_blocked: "Browser blockiert Zwischenablage.",
    copied: "✓ Copied",
    output_copied: "OUTPUT VON {rid} IN ZWISCHENABLAGE KOPIERT.",
    copy_failed: "COPY FEHLGESCHLAGEN: {err}",
    stop_signal_sent: "STOPP-SIGNAL AN {rid} GESENDET.",
    run_blocked_edit: "RUN BLOCKIERT: {rid} IST IM BEARBEITUNGSMODUS. BITTE ZUERST SPEICHERN.",
    run_not_possible_missing_cmd: "RUN NICHT MOEGLICH: BEI {rid} FEHLT DER COMMAND.",
    runner_starting: "{rid} STARTET JETZT.",
    runstop_failed: "RUN/STOP FEHLGESCHLAGEN FUER {rid}: {err}",
    group_run: "▶ Group Run",
    group_stop: "■ Group Stop",
    group_empty: "Keine Runner in diesem Multi-Runner.",
    group_no_active_runners: "Kein aktiver Runner für Group-Run in dieser Gruppe.",
    group_runner_enabled: "GroupRun: Ein",
    group_runner_disabled: "GroupRun: Aus",
    group_runner_enable_title: "Für Group-Run aktivieren",
    group_runner_disable_title: "Für Group-Run deaktivieren",
    group_run_starting: "GRUPPENLAUF FUER \"{name}\" STARTET...",
    group_run_failed: "GRUPPENLAUF FEHLGESCHLAGEN FUER \"{name}\": {err}",
    group_stop_sent: "STOPP-SIGNAL FUER GRUPPE \"{name}\" GESENDET.",
    group_stop_failed: "GRUPPEN-STOP FEHLGESCHLAGEN FUER \"{name}\": {err}",
    group_state_running: "Aktiv: {done}/{total} | aktuell: {runner}",
    group_state_stopping: "Stoppt...",
    group_state_finished: "Beendet ({done}/{total})",
    group_state_error: "Fehler: {err}",
    group_state_stopped: "Gestoppt",
    group_event_started: "GRUPPE \"{name}\": SEQUENZ GESTARTET.",
    group_event_stopped: "GRUPPE \"{name}\": SEQUENZ GESTOPPT.",
    group_event_finished: "GRUPPE \"{name}\": SEQUENZ BEENDET.",
    group_event_error: "GRUPPE \"{name}\": SEQUENZ FEHLER - {err}",
    confirm_delete_group: "Multi-Runner \"{name}\" wirklich löschen?",
    group_removed: "MULTI-RUNNER \"{name}\" ENTFERNT.",
    confirm_delete_runner: "Runner \"{name}\" wirklich löschen?",
    runner_removed: "RUNNER \"{name}\" ENTFERNT.",
    clone_blocked: "CLONE BLOCKIERT: BITTE ZUERST ALLE AENDERUNGEN SPEICHERN.",
    runner_cloned: "RUNNER \"{source}\" GEKLONT{target}.",
    clone_failed: "CLONE FEHLGESCHLAGEN: {err}",
    journal_load_failed: "JOURNAL-LADEN FEHLGESCHLAGEN: {err}",
    running_label: "running",
    scheduled_label: "scheduled",
    confirm_leave_active_runner: "Mindestens ein Runner läuft noch. Seite wirklich verlassen?",
    run_started: "{rid}: RUN GESTARTET.",
    run_stopping: "{rid}: STOPPE RUN...",
    run_stopped: "{rid}: RUN GESTOPPT.",
    run_scheduled: "{rid}: NAECHSTER RUN IN {sec} SEKUNDEN GEPLANT.",
    auto_pause_msg: "{rid}: AUTO-PAUSE NACH {n} FEHLERN. MANUELLER RUN NEEDED.",
    runner_auto_pause_state: "Auto-Pause nach {n} Fehlern",
    run_finished: "{rid}: RUN BEENDET (EXIT={code}, STOPPED={stopped}).",
    run_finished_error: "{rid} BEENDET MIT FEHLER (EXIT={code}).",
    event_stream_unstable: "Event-Stream instabil. Verbindung wird neu aufgebaut.",
    event_stream_unstable_log: "EVENT-STREAM VERBINDUNG INSTABIL.",
    autosave_ok: "AUTO-SAVE ERFOLGREICH.",
    save_failed_log: "SAVE FEHLGESCHLAGEN: {err}",
    save_failed_flash: "SPEICHERN FEHLGESCHLAGEN: {err}",
    notify_sort_mode: "NOTIFICATION-SORTIERMODUS {state}.",
    runner_sort_mode: "RUNNER-SORTIERMODUS {state}.",
    sort_mode_on_upper: "AKTIV",
    sort_mode_off_upper: "AUS",
    journal_cleared: "NOTIFICATION-JOURNAL GELEERT.",
    journal_clear_failed: "JOURNAL LEEREN FEHLGESCHLAGEN: {err}",
    events_cleared: "EVENTS GELEERT.",
    new_notify_default_name: "Neuer Pushover-Dienst",
    new_group_default_name: "Neuer Multi-Runner",
    new_runner_default_name: "New Runner",
    new_notify_created: "NEUER NOTIFICATION-DIENST ERSTELLT. PFLICHTFELDER AUSFUELLEN UND SPEICHERN.",
    new_group_created: "NEUER MULTI-RUNNER ERSTELLT UND GESPEICHERT.",
    new_runner_created: "NEUER RUNNER ERSTELLT UND GESPEICHERT.",
    new_runner_created_log: "RUNNER {rid} ERSTELLT UND GESPEICHERT.",
    export_starting: "EXPORT WIRD GESTARTET...",
    export_started_log: "EXPORT GESTARTET. DOWNLOAD SOLLTE JETZT LAUFEN.",
    export_started_flash: "EXPORT GESTARTET. DOWNLOAD SOLLTE JETZT LAUFEN.",
    export_failed: "EXPORT FEHLGESCHLAGEN: {err}",
    import_running: "IMPORT LAEUFT: {name}",
    import_ok: "IMPORT ERFOLGREICH: {count} RUNNER UEBERNOMMEN.",
    import_failed: "IMPORT FEHLGESCHLAGEN: {err}",
    system_ready: "System bereit.",
    system_ready_log: "SYSTEM BEREIT.",
    start_failed: "START FEHLGESCHLAGEN: {err}",
  },
  en: {
    sort_label: "Sort: {state}",
    sort_on: "On",
    sort_off: "Off",
    no_changes: "No changes",
    open_info_title: "Open program info",
    lang_switch_aria: "Language",
    lang_toggle_title_to_en: "Switch to English",
    lang_toggle_title_to_de: "Switch to German",
    lang_toggle_title_to_fr: "Switch to French",
    lang_toggle_title_to_zh: "Switch to Chinese",
    notify_services_title: "Notification services",
    runners_title: "Runners",
    add_service: "+ Service",
    add_group: "+ Group",
    add_runner: "+ Runner",
    export: "⬇ Export",
    import: "⬆ Import",
    notification_journal: "Notification journal",
    clear_journal: "Clear journal",
    events: "Events",
    clear_events: "Clear events",
    close: "Close",
    active_since: "Active for: {elapsed}",
    journal_error: "ERROR",
    cmd_missing_reason: "Command missing: please enter a command first.",
    cmd_missing_short: "Command missing.",
    save_first_reason: "Please save first (edit mode).",
    unknown_notify_service: "Unknown notification service.",
    service_name_missing: "Service name is missing.",
    user_key_missing: "User key is missing.",
    api_token_missing: "API token is missing.",
    service_fallback: "Service",
    new_service_fallback: "New service",
    new_runner_fallback: "New",
    save_blocked: "SAVE BLOCKED: {reasons}",
    save_blocked_log: "SAVE BLOCKED: {reasons}",
    infinite: "infinite",
    off: "off",
    failures: "{n} failures",
    no_status: "(no status)",
    notify_none_configured: "No notification services configured. Click \"+ Service\" to add one.",
    service_name_placeholder: "Service name",
    move_up: "Move up",
    move_down: "Move down",
    service_active_title: "Service active (click to disable)",
    service_inactive_title: "Service inactive (click to enable)",
    active: "Active",
    inactive: "Inactive",
    service_inactive: "Service is inactive",
    save: "💾 Save",
    remove: "Remove",
    secret_set: "***set***",
    user_key_enter: "Enter user key",
    api_token_enter: "Enter API token",
    creds_hint: "Credentials are masked. Entering new values overwrites existing ones.",
    service_enabled: "SERVICE \"{label}\" ENABLED.",
    service_disabled: "SERVICE \"{label}\" DISABLED.",
    test_notify_start: "TESTING NOTIFICATION SERVICE \"{name}\"...",
    test_ok_log: "TEST OK FOR \"{name}\". RESPONSE: {response}",
    test_ok_flash: "TEST SUCCESSFUL FOR \"{name}\".",
    test_fail: "TEST FAILED FOR \"{name}\": {err}",
    confirm_delete_notify: "Really delete notification service \"{name}\"?",
    notify_removed: "NOTIFICATION SERVICE \"{name}\" REMOVED.",
    notify_status_inactive_auto: "Inactive: {fail}/3 failures. Sent: {sent}.",
    notify_status_inactive_manual: "Inactive: manual. Sent: {sent}.",
    notify_status_active_fail: "Active: {fail}/3 failures. Sent: {sent}.",
    notify_status_active_ok: "Active: OK. Sent: {sent}.",
    notify_auto_disabled_base: "{label} was disabled after {fail} failures.",
    notify_auto_disabled_reason_suffix: " Reason: {reason}",
    confirm_delete_case: "Really delete case {idx}?",
    case_pattern_placeholder: "e.g. password:\\s*(?P<pw>\\S+)",
    case_message_placeholder: "e.g. Password: {pw}",
    case_help: "Template: {match}, {g1}, {name} | Status for UP/DOWN/Recovery/STOP logic",
    runner_placeholder: "Runner name",
    group_placeholder: "Group name",
    lock_active_title: "Locked while active.",
    clone_needs_saved_title: "Can only be cloned when saved. Save first.",
    notifications: "Notifications",
    no_services_available: "No services available",
    notify_on_title: "Notifications ON",
    notify_off_title: "Notifications OFF",
    on: "On",
    off_short: "Off",
    enable_first: "Enable first",
    updates_only: "Updates only",
    updates_only_title_on: "Send status changes only",
    updates_only_title_off: "Send every match",
    logging_title: "If off: no writing to data/run_<runner_id>.log",
    logging_on: "ON",
    logging_off: "OFF",
    open_log: "📄 Open log",
    clear_log: "🗑️ Clear log",
    confirm_clear_log: "Really clear the log file?",
    log_cleared_log: "LOG FOR {rid} CLEARED.",
    log_cleared_flash: "LOG CLEARED FOR {rid}.",
    log_clear_failed: "CLEAR LOG FAILED FOR {rid}: {err}",
    scheduler: "Scheduler (after run end)",
    hours: "Hours",
    minutes: "Minutes",
    seconds: "Seconds",
    total_runs: "Total runs",
    alert_cooldown: "Alert cooldown",
    escalation: "Escalation",
    auto_pause: "Auto pause",
    cases: "Cases",
    cases_hint: "Regex per output line. Each match → Pushover (only if token+user key are set). Empty case (empty pattern+message) → send last output line at the end.",
    add_case: "+ Case",
    add_case_title: "Add new case",
    copy: "📋 Copy",
    copy_title: "Copy to clipboard",
    output: "Output",
    clipboard_blocked: "Clipboard blocked by the browser.",
    copied: "✓ Copied",
    output_copied: "OUTPUT FROM {rid} COPIED TO CLIPBOARD.",
    copy_failed: "COPY FAILED: {err}",
    stop_signal_sent: "STOP SIGNAL SENT TO {rid}.",
    run_blocked_edit: "RUN BLOCKED: {rid} IS IN EDIT MODE. PLEASE SAVE FIRST.",
    run_not_possible_missing_cmd: "RUN NOT POSSIBLE: {rid} HAS NO COMMAND.",
    runner_starting: "{rid} IS STARTING NOW.",
    runstop_failed: "RUN/STOP FAILED FOR {rid}: {err}",
    group_run: "▶ Group Run",
    group_stop: "■ Group Stop",
    group_empty: "No runners in this group.",
    group_no_active_runners: "No active runners available for group run in this group.",
    group_runner_enabled: "GroupRun: On",
    group_runner_disabled: "GroupRun: Off",
    group_runner_enable_title: "Enable for group run",
    group_runner_disable_title: "Disable for group run",
    group_run_starting: "STARTING GROUP RUN FOR \"{name}\"...",
    group_run_failed: "GROUP RUN FAILED FOR \"{name}\": {err}",
    group_stop_sent: "STOP SIGNAL SENT TO GROUP \"{name}\".",
    group_stop_failed: "GROUP STOP FAILED FOR \"{name}\": {err}",
    group_state_running: "Active: {done}/{total} | current: {runner}",
    group_state_stopping: "Stopping...",
    group_state_finished: "Finished ({done}/{total})",
    group_state_error: "Error: {err}",
    group_state_stopped: "Stopped",
    group_event_started: "GROUP \"{name}\": SEQUENCE STARTED.",
    group_event_stopped: "GROUP \"{name}\": SEQUENCE STOPPED.",
    group_event_finished: "GROUP \"{name}\": SEQUENCE FINISHED.",
    group_event_error: "GROUP \"{name}\": SEQUENCE ERROR - {err}",
    confirm_delete_group: "Really delete group \"{name}\"?",
    group_removed: "GROUP \"{name}\" REMOVED.",
    confirm_delete_runner: "Really delete runner \"{name}\"?",
    runner_removed: "RUNNER \"{name}\" REMOVED.",
    clone_blocked: "CLONE BLOCKED: PLEASE SAVE ALL CHANGES FIRST.",
    runner_cloned: "RUNNER \"{source}\" CLONED{target}.",
    clone_failed: "CLONE FAILED: {err}",
    journal_load_failed: "FAILED TO LOAD JOURNAL: {err}",
    running_label: "running",
    scheduled_label: "scheduled",
    confirm_leave_active_runner: "At least one runner is still running. Leave this page anyway?",
    run_started: "{rid}: RUN STARTED.",
    run_stopping: "{rid}: STOPPING RUN...",
    run_stopped: "{rid}: RUN STOPPED.",
    run_scheduled: "{rid}: NEXT RUN SCHEDULED IN {sec} SECONDS.",
    auto_pause_msg: "{rid}: AUTO PAUSED AFTER {n} FAILURES. MANUAL RUN NEEDED.",
    runner_auto_pause_state: "Auto-pause after {n} failures",
    run_finished: "{rid}: RUN FINISHED (EXIT={code}, STOPPED={stopped}).",
    run_finished_error: "{rid} FINISHED WITH ERROR (EXIT={code}).",
    event_stream_unstable: "Event stream unstable. Reconnecting.",
    event_stream_unstable_log: "EVENT STREAM CONNECTION UNSTABLE.",
    autosave_ok: "AUTO-SAVE SUCCESSFUL.",
    save_failed_log: "SAVE FAILED: {err}",
    save_failed_flash: "SAVE FAILED: {err}",
    notify_sort_mode: "NOTIFICATION SORT MODE {state}.",
    runner_sort_mode: "RUNNER SORT MODE {state}.",
    sort_mode_on_upper: "ON",
    sort_mode_off_upper: "OFF",
    journal_cleared: "NOTIFICATION JOURNAL CLEARED.",
    journal_clear_failed: "CLEAR JOURNAL FAILED: {err}",
    events_cleared: "EVENTS CLEARED.",
    new_notify_default_name: "New Pushover service",
    new_group_default_name: "New Group",
    new_runner_default_name: "New Runner",
    new_notify_created: "NEW NOTIFICATION SERVICE CREATED. FILL REQUIRED FIELDS AND SAVE.",
    new_group_created: "NEW GROUP CREATED AND SAVED.",
    new_runner_created: "NEW RUNNER CREATED AND SAVED.",
    new_runner_created_log: "RUNNER {rid} CREATED AND SAVED.",
    export_starting: "STARTING EXPORT...",
    export_started_log: "EXPORT STARTED. DOWNLOAD SHOULD START NOW.",
    export_started_flash: "EXPORT STARTED. DOWNLOAD SHOULD START NOW.",
    export_failed: "EXPORT FAILED: {err}",
    import_running: "IMPORT RUNNING: {name}",
    import_ok: "IMPORT SUCCESSFUL: {count} RUNNERS IMPORTED.",
    import_failed: "IMPORT FAILED: {err}",
    system_ready: "System ready.",
    system_ready_log: "SYSTEM READY.",
    start_failed: "START FAILED: {err}",
  },
};

I18N.fr = {
  ...I18N.en,
  sort_label: "Tri: {state}",
  sort_on: "On",
  sort_off: "Off",
  no_changes: "Aucun changement",
  open_info_title: "Ouvrir les informations du programme",
  lang_switch_aria: "Langue",
  lang_toggle_title_to_en: "Passer en anglais",
  lang_toggle_title_to_de: "Passer en allemand",
  lang_toggle_title_to_fr: "Passer en francais",
  lang_toggle_title_to_zh: "Passer en chinois",
  notify_services_title: "Services de notification",
  runners_title: "Runners",
  add_service: "+ Service",
  add_group: "+ Groupe",
  add_runner: "+ Runner",
  export: "⬇ Export",
  import: "⬆ Import",
  notification_journal: "Journal des notifications",
  clear_journal: "Vider le journal",
  events: "Evenements",
  clear_events: "Vider les evenements",
  close: "Fermer",
  active_since: "Actif depuis: {elapsed}",
  journal_error: "ERREUR",
  cmd_missing_reason: "Commande manquante: ajoutez d'abord une commande.",
  cmd_missing_short: "Commande manquante.",
  save_first_reason: "Veuillez d'abord enregistrer (mode edition).",
  unknown_notify_service: "Service de notification inconnu.",
  service_name_missing: "Le nom du service est manquant.",
  user_key_missing: "La cle utilisateur est manquante.",
  api_token_missing: "Le token API est manquant.",
  service_fallback: "Service",
  new_service_fallback: "Nouveau service",
  new_runner_fallback: "Nouveau",
  save_blocked: "ENREGISTREMENT BLOQUE: {reasons}",
  save_blocked_log: "ENREGISTREMENT BLOQUE: {reasons}",
  infinite: "infini",
  off: "off",
  failures: "{n} echecs",
  no_status: "(pas de statut)",
  notify_none_configured: "Aucun service de notification configure. Cliquez sur \"+ Service\" pour en ajouter un.",
  service_name_placeholder: "Nom du service",
  move_up: "Monter",
  move_down: "Descendre",
  service_active_title: "Service actif (cliquer pour desactiver)",
  service_inactive_title: "Service inactif (cliquer pour activer)",
  active: "Actif",
  inactive: "Inactif",
  service_inactive: "Le service est inactif",
  save: "💾 Enregistrer",
  remove: "Supprimer",
  secret_set: "***defini***",
  user_key_enter: "Entrer la cle utilisateur",
  api_token_enter: "Entrer le token API",
  creds_hint: "Les identifiants sont masques. Une nouvelle saisie remplace les valeurs existantes.",
  service_enabled: "SERVICE \"{label}\" ACTIVE.",
  service_disabled: "SERVICE \"{label}\" DESACTIVE.",
  test_notify_start: "TEST DU SERVICE DE NOTIFICATION \"{name}\"...",
  test_ok_log: "TEST OK POUR \"{name}\". REPONSE: {response}",
  test_ok_flash: "TEST REUSSI POUR \"{name}\".",
  test_fail: "ECHEC DU TEST POUR \"{name}\": {err}",
  confirm_delete_notify: "Supprimer vraiment le service de notification \"{name}\"?",
  notify_removed: "SERVICE DE NOTIFICATION \"{name}\" SUPPRIME.",
  notify_status_inactive_auto: "Inactif: {fail}/3 echecs. Envoye: {sent}.",
  notify_status_inactive_manual: "Inactif: manuel. Envoye: {sent}.",
  notify_status_active_fail: "Actif: {fail}/3 echecs. Envoye: {sent}.",
  notify_status_active_ok: "Actif: OK. Envoye: {sent}.",
  notify_auto_disabled_base: "{label} a ete desactive apres {fail} echecs.",
  notify_auto_disabled_reason_suffix: " Raison: {reason}",
  confirm_delete_case: "Supprimer vraiment le case {idx}?",
  case_pattern_placeholder: "ex. password:\\s*(?P<pw>\\S+)",
  case_message_placeholder: "ex. Mot de passe: {pw}",
  case_help: "Template: {match}, {g1}, {name} | Statut pour la logique UP/DOWN/Recovery/STOP",
  runner_placeholder: "Nom du runner",
  group_placeholder: "Nom du groupe",
  lock_active_title: "Verrouille pendant l'activite.",
  clone_needs_saved_title: "Clonable uniquement apres enregistrement.",
  notifications: "Notifications",
  no_services_available: "Aucun service disponible",
  notify_on_title: "Notifications ON",
  notify_off_title: "Notifications OFF",
  on: "On",
  off_short: "Off",
  enable_first: "Activer d'abord",
  updates_only: "Mises a jour seulement",
  updates_only_title_on: "Envoyer uniquement les changements d'etat",
  updates_only_title_off: "Envoyer chaque correspondance",
  logging_title: "Si desactive: aucune ecriture dans data/run_<runner_id>.log",
  logging_on: "ON",
  logging_off: "OFF",
  open_log: "📄 Ouvrir le log",
  clear_log: "🗑️ Vider le log",
  confirm_clear_log: "Vider vraiment le fichier log?",
  log_cleared_log: "LOG POUR {rid} VIDE.",
  log_cleared_flash: "LOG VIDE POUR {rid}.",
  log_clear_failed: "ECHEC VIDAGE LOG POUR {rid}: {err}",
  scheduler: "Scheduler (apres la fin du run)",
  hours: "Heures",
  minutes: "Minutes",
  seconds: "Secondes",
  total_runs: "Nombre total de runs",
  alert_cooldown: "Cooldown d'alerte",
  escalation: "Escalade",
  auto_pause: "Pause auto",
  cases: "Cases",
  cases_hint: "Regex par ligne de sortie. Chaque match -> Pushover. Case vide (pattern+message vides) -> envoyer la derniere ligne.",
  add_case: "+ Case",
  add_case_title: "Ajouter un case",
  copy: "📋 Copier",
  copy_title: "Copier dans le presse-papiers",
  output: "Sortie",
  clipboard_blocked: "Presse-papiers bloque par le navigateur.",
  copied: "✓ Copie",
  output_copied: "SORTIE DE {rid} COPIEE DANS LE PRESSE-PAPIERS.",
  copy_failed: "ECHEC DE COPIE: {err}",
  stop_signal_sent: "SIGNAL STOP ENVOYE A {rid}.",
  run_blocked_edit: "RUN BLOQUE: {rid} EST EN MODE EDITION. ENREGISTRE D'ABORD.",
  run_not_possible_missing_cmd: "RUN IMPOSSIBLE: {rid} N'A PAS DE COMMANDE.",
  runner_starting: "{rid} DEMARRE MAINTENANT.",
  runstop_failed: "ECHEC RUN/STOP POUR {rid}: {err}",
  group_run: "▶ Group Run",
  group_stop: "■ Group Stop",
  group_empty: "Aucun runner dans ce groupe.",
  group_no_active_runners: "Aucun runner actif pour le group run dans ce groupe.",
  group_runner_enabled: "GroupRun: On",
  group_runner_disabled: "GroupRun: Off",
  group_runner_enable_title: "Activer pour le group run",
  group_runner_disable_title: "Desactiver pour le group run",
  group_run_starting: "DEMARRAGE DU GROUP RUN POUR \"{name}\"...",
  group_run_failed: "ECHEC GROUP RUN POUR \"{name}\": {err}",
  group_stop_sent: "SIGNAL STOP ENVOYE AU GROUPE \"{name}\".",
  group_stop_failed: "ECHEC DU STOP GROUPE \"{name}\": {err}",
  group_state_running: "Actif: {done}/{total} | courant: {runner}",
  group_state_stopping: "Arret en cours...",
  group_state_finished: "Termine ({done}/{total})",
  group_state_error: "Erreur: {err}",
  group_state_stopped: "Arrete",
  group_event_started: "GROUPE \"{name}\": SEQUENCE DEMARREE.",
  group_event_stopped: "GROUPE \"{name}\": SEQUENCE ARRETEE.",
  group_event_finished: "GROUPE \"{name}\": SEQUENCE TERMINEE.",
  group_event_error: "GROUPE \"{name}\": ERREUR DE SEQUENCE - {err}",
  confirm_delete_group: "Supprimer vraiment le groupe \"{name}\"?",
  group_removed: "GROUPE \"{name}\" SUPPRIME.",
  confirm_delete_runner: "Supprimer vraiment le runner \"{name}\"?",
  runner_removed: "RUNNER \"{name}\" SUPPRIME.",
  clone_blocked: "CLONE BLOQUE: ENREGISTRER D'ABORD TOUTES LES MODIFICATIONS.",
  runner_cloned: "RUNNER \"{source}\" CLONE{target}.",
  clone_failed: "ECHEC DU CLONE: {err}",
  journal_load_failed: "ECHEC DE CHARGEMENT DU JOURNAL: {err}",
  running_label: "running",
  scheduled_label: "scheduled",
  confirm_leave_active_runner: "Au moins un runner est encore actif. Quitter quand meme?",
  run_started: "{rid}: RUN DEMARRE.",
  run_stopping: "{rid}: ARRET DU RUN...",
  run_stopped: "{rid}: RUN ARRETE.",
  run_scheduled: "{rid}: PROCHAIN RUN PLANIFIE DANS {sec} SECONDES.",
  auto_pause_msg: "{rid}: PAUSE AUTO APRES {n} ECHECS. RUN MANUEL NECESSAIRE.",
  runner_auto_pause_state: "Pause auto apres {n} echecs",
  run_finished: "{rid}: RUN TERMINE (EXIT={code}, STOPPED={stopped}).",
  run_finished_error: "{rid} TERMINE AVEC ERREUR (EXIT={code}).",
  event_stream_unstable: "Flux d'evenements instable. Reconnexion.",
  event_stream_unstable_log: "CONNEXION DU FLUX D'EVENEMENTS INSTABLE.",
  autosave_ok: "AUTO-SAVE REUSSI.",
  save_failed_log: "ECHEC ENREGISTREMENT: {err}",
  save_failed_flash: "ECHEC ENREGISTREMENT: {err}",
  notify_sort_mode: "MODE TRI NOTIFICATIONS {state}.",
  runner_sort_mode: "MODE TRI RUNNERS {state}.",
  sort_mode_on_upper: "ON",
  sort_mode_off_upper: "OFF",
  journal_cleared: "JOURNAL DES NOTIFICATIONS VIDE.",
  journal_clear_failed: "ECHEC VIDAGE DU JOURNAL: {err}",
  events_cleared: "EVENEMENTS VIDES.",
  new_notify_default_name: "Nouveau service Pushover",
  new_group_default_name: "Nouveau groupe",
  new_runner_default_name: "Nouveau Runner",
  new_notify_created: "NOUVEAU SERVICE DE NOTIFICATION CREE. REMPLIR LES CHAMPS OBLIGATOIRES ET ENREGISTRER.",
  new_group_created: "NOUVEAU GROUPE CREE ET ENREGISTRE.",
  new_runner_created: "NOUVEAU RUNNER CREE ET ENREGISTRE.",
  new_runner_created_log: "RUNNER {rid} CREE ET ENREGISTRE.",
  export_starting: "DEMARRAGE DE L'EXPORT...",
  export_started_log: "EXPORT DEMARRE. LE TELECHARGEMENT DEVRAIT COMMENCER.",
  export_started_flash: "EXPORT DEMARRE. LE TELECHARGEMENT DEVRAIT COMMENCER.",
  export_failed: "ECHEC DE L'EXPORT: {err}",
  import_running: "IMPORT EN COURS: {name}",
  import_ok: "IMPORT REUSSI: {count} RUNNERS IMPORTES.",
  import_failed: "ECHEC DE L'IMPORT: {err}",
  system_ready: "Systeme pret.",
  system_ready_log: "SYSTEME PRET.",
  start_failed: "ECHEC DU DEMARRAGE: {err}",
};

I18N.zh = {
  sort_label: "排序：{state}",
  sort_on: "开",
  sort_off: "关",
  no_changes: "无更改",
  open_info_title: "打开程序信息",
  lang_switch_aria: "语言",
  lang_toggle_title_to_en: "切换到英语",
  lang_toggle_title_to_de: "切换到德语",
  lang_toggle_title_to_fr: "切换到法语",
  lang_toggle_title_to_zh: "切换到中文",
  notify_services_title: "通知服务",
  runners_title: "运行器",
  add_service: "+ 服务",
  add_group: "+ 组",
  add_runner: "+ 运行器",
  export: "⬇ 导出",
  import: "⬆ 导入",
  notification_journal: "通知日志",
  clear_journal: "清空日志",
  events: "事件",
  clear_events: "清空事件",
  close: "关闭",
  active_since: "已运行：{elapsed}",
  journal_error: "错误",
  cmd_missing_reason: "缺少命令：请先填写命令。",
  cmd_missing_short: "缺少命令。",
  save_first_reason: "请先保存（编辑模式）。",
  unknown_notify_service: "未知通知服务。",
  service_name_missing: "缺少服务名称。",
  user_key_missing: "缺少用户密钥。",
  api_token_missing: "缺少 API 令牌。",
  service_fallback: "服务",
  new_service_fallback: "新服务",
  new_runner_fallback: "新建",
  save_blocked: "保存被阻止：{reasons}",
  save_blocked_log: "保存被阻止：{reasons}",
  infinite: "无限",
  off: "关闭",
  failures: "{n} 次失败",
  no_status: "(无状态)",
  notify_none_configured: "尚未配置通知服务。点击“+ 服务”添加。",
  service_name_placeholder: "服务名称",
  move_up: "上移",
  move_down: "下移",
  service_active_title: "服务已启用（点击可禁用）",
  service_inactive_title: "服务已禁用（点击可启用）",
  active: "启用",
  inactive: "禁用",
  service_inactive: "服务已禁用",
  save: "💾 保存",
  remove: "删除",
  secret_set: "***已设置***",
  user_key_enter: "输入用户密钥",
  api_token_enter: "输入 API 令牌",
  creds_hint: "凭据会以掩码显示。输入新值会覆盖旧值。",
  service_enabled: "服务“{label}”已启用。",
  service_disabled: "服务“{label}”已禁用。",
  test_notify_start: "正在测试通知服务“{name}”...",
  test_ok_log: "“{name}”测试成功。响应：{response}",
  test_ok_flash: "“{name}”测试成功。",
  test_fail: "“{name}”测试失败：{err}",
  confirm_delete_notify: "确定删除通知服务“{name}”？",
  notify_removed: "通知服务“{name}”已删除。",
  notify_status_inactive_auto: "已禁用：{fail}/3 次失败。已发送：{sent}。",
  notify_status_inactive_manual: "已禁用：手动。已发送：{sent}。",
  notify_status_active_fail: "已启用：{fail}/3 次失败。已发送：{sent}。",
  notify_status_active_ok: "已启用：正常。已发送：{sent}。",
  notify_auto_disabled_base: "{label} 在 {fail} 次失败后已被自动禁用。",
  notify_auto_disabled_reason_suffix: " 原因：{reason}",
  confirm_delete_case: "确定删除规则 {idx}？",
  case_pattern_placeholder: "例如 password:\\s*(?P<pw>\\S+)",
  case_message_placeholder: "例如 密码：{pw}",
  case_help: "模板：{match}、{g1}、{name} | 状态用于 UP/DOWN/Recovery/STOP 逻辑",
  runner_placeholder: "运行器名称",
  group_placeholder: "组名称",
  lock_active_title: "运行时已锁定。",
  clone_needs_saved_title: "仅在已保存状态可克隆。请先保存。",
  notifications: "通知",
  no_services_available: "没有可用服务",
  notify_on_title: "通知已开启",
  notify_off_title: "通知已关闭",
  on: "开",
  off_short: "关",
  enable_first: "请先启用",
  updates_only: "仅状态更新",
  updates_only_title_on: "仅发送状态变化",
  updates_only_title_off: "每次匹配都发送",
  logging_title: "关闭后：不再写入 data/run_<runner_id>.log",
  logging_on: "开启",
  logging_off: "关闭",
  open_log: "📄 打开日志",
  clear_log: "🗑️ 清空日志",
  confirm_clear_log: "确定清空日志文件？",
  log_cleared_log: "{rid} 的日志已清空。",
  log_cleared_flash: "{rid} 的日志已清空。",
  log_clear_failed: "清空 {rid} 日志失败：{err}",
  scheduler: "调度器（运行结束后）",
  hours: "小时",
  minutes: "分钟",
  seconds: "秒",
  total_runs: "总运行次数",
  alert_cooldown: "告警冷却",
  escalation: "升级通知",
  auto_pause: "自动暂停",
  cases: "规则",
  cases_hint: "每行输出按正则匹配。每次匹配 -> Pushover（仅当 token+user key 已设置）。空规则（pattern+message 为空）-> 结束时发送最后一行输出。",
  add_case: "+ 规则",
  add_case_title: "添加新规则",
  copy: "📋 复制",
  copy_title: "复制到剪贴板",
  output: "输出",
  clipboard_blocked: "浏览器阻止了剪贴板访问。",
  copied: "✓ 已复制",
  output_copied: "已将 {rid} 的输出复制到剪贴板。",
  copy_failed: "复制失败：{err}",
  stop_signal_sent: "已向 {rid} 发送停止信号。",
  run_blocked_edit: "运行被阻止：{rid} 处于编辑模式。请先保存。",
  run_not_possible_missing_cmd: "无法运行：{rid} 缺少命令。",
  runner_starting: "{rid} 正在启动。",
  runstop_failed: "{rid} 运行/停止失败：{err}",
  group_run: "▶ 组运行",
  group_stop: "■ 组停止",
  group_empty: "该组中没有运行器。",
  group_no_active_runners: "该组没有可用于组运行的已启用运行器。",
  group_runner_enabled: "组运行：开",
  group_runner_disabled: "组运行：关",
  group_runner_enable_title: "在组运行中启用",
  group_runner_disable_title: "在组运行中禁用",
  group_run_starting: "正在启动组“{name}”运行...",
  group_run_failed: "组“{name}”运行失败：{err}",
  group_stop_sent: "已向组“{name}”发送停止信号。",
  group_stop_failed: "组“{name}”停止失败：{err}",
  group_state_running: "运行中：{done}/{total} | 当前：{runner}",
  group_state_stopping: "正在停止...",
  group_state_finished: "已完成（{done}/{total}）",
  group_state_error: "错误：{err}",
  group_state_stopped: "已停止",
  group_event_started: "组“{name}”：序列已开始。",
  group_event_stopped: "组“{name}”：序列已停止。",
  group_event_finished: "组“{name}”：序列已完成。",
  group_event_error: "组“{name}”：序列错误 - {err}",
  confirm_delete_group: "确定删除组“{name}”？",
  group_removed: "组“{name}”已删除。",
  confirm_delete_runner: "确定删除运行器“{name}”？",
  runner_removed: "运行器“{name}”已删除。",
  clone_blocked: "克隆被阻止：请先保存所有更改。",
  runner_cloned: "运行器“{source}”已克隆{target}。",
  clone_failed: "克隆失败：{err}",
  journal_load_failed: "加载日志失败：{err}",
  running_label: "运行中",
  scheduled_label: "已计划",
  confirm_leave_active_runner: "至少有一个运行器仍在运行。仍要离开此页面吗？",
  run_started: "{rid}：运行已开始。",
  run_stopping: "{rid}：正在停止运行...",
  run_stopped: "{rid}：运行已停止。",
  run_scheduled: "{rid}：下次运行将在 {sec} 秒后执行。",
  auto_pause_msg: "{rid}：连续失败 {n} 次后已自动暂停。需要手动运行。",
  runner_auto_pause_state: "连续失败 {n} 次后自动暂停",
  run_finished: "{rid}：运行结束（EXIT={code}, STOPPED={stopped}）。",
  run_finished_error: "{rid} 运行出错结束（EXIT={code}）。",
  event_stream_unstable: "事件流不稳定，正在重连。",
  event_stream_unstable_log: "事件流连接不稳定。",
  autosave_ok: "自动保存成功。",
  save_failed_log: "保存失败：{err}",
  save_failed_flash: "保存失败：{err}",
  notify_sort_mode: "通知排序模式 {state}。",
  runner_sort_mode: "运行器排序模式 {state}。",
  sort_mode_on_upper: "开启",
  sort_mode_off_upper: "关闭",
  journal_cleared: "通知日志已清空。",
  journal_clear_failed: "清空日志失败：{err}",
  events_cleared: "事件已清空。",
  new_notify_default_name: "新 Pushover 服务",
  new_group_default_name: "新组",
  new_runner_default_name: "新运行器",
  new_notify_created: "已创建新通知服务。请填写必填项并保存。",
  new_group_created: "新组已创建并保存。",
  new_runner_created: "新运行器已创建并保存。",
  new_runner_created_log: "运行器 {rid} 已创建并保存。",
  export_starting: "正在开始导出...",
  export_started_log: "导出已开始。下载应已开始。",
  export_started_flash: "导出已开始。下载应已开始。",
  export_failed: "导出失败：{err}",
  import_running: "正在导入：{name}",
  import_ok: "导入成功：已导入 {count} 个运行器。",
  import_failed: "导入失败：{err}",
  system_ready: "系统就绪。",
  system_ready_log: "系统就绪。",
  start_failed: "启动失败：{err}",
};

function currentLang() {
  return I18N[ui.lang] ? ui.lang : LANG_FALLBACK;
}

function nextLang(lang) {
  const idx = LANG_ORDER.indexOf(lang);
  if (idx < 0) return LANG_ORDER[0];
  return LANG_ORDER[(idx + 1) % LANG_ORDER.length];
}

function t(key, vars = null) {
  const lang = currentLang();
  const dict = I18N[lang] || I18N[LANG_FALLBACK];
  let s = dict[key];
  if (s === undefined) s = I18N.en[key];
  if (s === undefined) s = I18N.de[key];
  if (s === undefined) s = String(key);
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

function applyLanguageToStaticDom() {
  const lang = currentLang();
  document.documentElement.lang = lang;

  const openInfoTitle = el("openInfoTitle");
  if (openInfoTitle) openInfoTitle.title = t("open_info_title");

  const notifyJournalTitle = el("notifyJournalTitle");
  if (notifyJournalTitle) notifyJournalTitle.textContent = t("notification_journal");

  const clearNotifyJournalBtn = el("clearNotifyJournalBtn");
  if (clearNotifyJournalBtn) clearNotifyJournalBtn.textContent = t("clear_journal");

  const eventsTitle = el("eventsTitle");
  if (eventsTitle) eventsTitle.textContent = t("events");

  const clearEventsBtn = el("clearEventsBtn");
  if (clearEventsBtn) clearEventsBtn.textContent = t("clear_events");

  const addNotifyBtn = el("addNotifyBtn");
  if (addNotifyBtn) addNotifyBtn.textContent = t("add_service");

  const addRunnerBtn = el("addRunnerBtn");
  if (addRunnerBtn) addRunnerBtn.textContent = t("add_runner");

  const addGroupBtn = el("addGroupBtn");
  if (addGroupBtn) addGroupBtn.textContent = t("add_group");

  const exportBtn = el("exportBtn");
  if (exportBtn) exportBtn.textContent = t("export");

  const importBtn = el("importBtn");
  if (importBtn) importBtn.textContent = t("import");

  const closeInfoBtn = el("closeInfoBtn");
  if (closeInfoBtn) closeInfoBtn.textContent = t("close");

  const infoBodies = Array.from(document.querySelectorAll("#infoModal [data-lang]"));
  if (infoBodies.length) {
    let showLang = lang;
    if (!infoBodies.some((node) => node.dataset.lang === showLang)) {
      showLang = infoBodies.some((node) => node.dataset.lang === "en")
        ? "en"
        : String(infoBodies[0].dataset.lang || "");
    }
    infoBodies.forEach((node) => {
      node.classList.toggle("hidden", node.dataset.lang !== showLang);
    });
  }

  const toggleBtn = el("langToggleBtn");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-label", t("lang_switch_aria"));
    toggleBtn.textContent = LANG_LABELS[lang] || lang.toUpperCase();
    const next = nextLang(lang);
    toggleBtn.title = t(`lang_toggle_title_to_${next}`);
  }

  // Keep buttons consistent even before the first state render completes.
  syncSortModeButtons();
}

function setLanguage(nextLang) {
  const normalized = normalizeLang(nextLang) || LANG_FALLBACK;
  if (normalized === ui.lang) return;
  ui.lang = normalized;
  saveUIState();
  applyLanguageToStaticDom();
  syncSortModeButtons();
  renderNotifyProfiles();
  renderRunners();
  renderNotifyJournal();
  tickRunnerElapsed();
  updateGlobalRunningStatus();
}

function syncSortModeButtons() {
  const notifyBtn = el("sortNotifyBtn");
  const runnerBtn = el("sortRunnerBtn");
  if (notifyBtn) {
    notifyBtn.textContent = t("sort_label", { state: ui.notifySortMode ? t("sort_on") : t("sort_off") });
    notifyBtn.classList.toggle("primary", !!ui.notifySortMode);
  }
  if (runnerBtn) {
    runnerBtn.textContent = t("sort_label", { state: ui.runnerSortMode ? t("sort_on") : t("sort_off") });
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

function normalizeRunnerStructureState() {
  if (!Array.isArray(state.runner_groups)) state.runner_groups = [];
  if (!Array.isArray(state.runner_layout)) state.runner_layout = [];

  const runnerIds = state.runners
    .map((r) => String(r?.id || "").trim())
    .filter((id) => !!id);
  const validRunnerIds = new Set(runnerIds);

  const nextGroups = [];
  const seenGroupIds = new Set();
  const assignedRunnerIds = new Set();
  for (const rawGroup of state.runner_groups) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const gid = String(rawGroup.id || "").trim();
    if (!gid || seenGroupIds.has(gid)) continue;
    seenGroupIds.add(gid);
    const nextRunnerIds = [];
    for (const rawRunnerId of Array.isArray(rawGroup.runner_ids) ? rawGroup.runner_ids : []) {
      const rid = String(rawRunnerId || "").trim();
      if (!rid || !validRunnerIds.has(rid)) continue;
      if (assignedRunnerIds.has(rid)) continue;
      if (nextRunnerIds.includes(rid)) continue;
      assignedRunnerIds.add(rid);
      nextRunnerIds.push(rid);
    }
    const nextDisabledRunnerIds = [];
    for (const rawDisabledRunnerId of Array.isArray(rawGroup.disabled_runner_ids) ? rawGroup.disabled_runner_ids : []) {
      const rid = String(rawDisabledRunnerId || "").trim();
      if (!rid || !validRunnerIds.has(rid)) continue;
      if (!nextRunnerIds.includes(rid)) continue;
      if (nextDisabledRunnerIds.includes(rid)) continue;
      nextDisabledRunnerIds.push(rid);
    }
    nextGroups.push({
      id: gid,
      name: String(rawGroup.name || "Group"),
      runner_ids: nextRunnerIds,
      disabled_runner_ids: nextDisabledRunnerIds,
      _collapsed: !!rawGroup._collapsed,
    });
  }
  state.runner_groups = nextGroups;

  const groupedRunnerIds = new Set();
  state.runner_groups.forEach((g) => {
    (g.runner_ids || []).forEach((rid) => groupedRunnerIds.add(rid));
  });

  const validGroupIds = new Set(state.runner_groups.map((g) => g.id));
  const nextLayout = [];
  const seenLayoutRunnerIds = new Set();
  const seenLayoutGroupIds = new Set();
  for (const rawItem of state.runner_layout) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const type = String(rawItem.type || "").trim().toLowerCase();
    const id = String(rawItem.id || "").trim();
    if (type === "runner") {
      if (!validRunnerIds.has(id)) continue;
      if (groupedRunnerIds.has(id)) continue;
      if (seenLayoutRunnerIds.has(id)) continue;
      seenLayoutRunnerIds.add(id);
      nextLayout.push({ type: "runner", id });
    } else if (type === "group") {
      if (!validGroupIds.has(id)) continue;
      if (seenLayoutGroupIds.has(id)) continue;
      seenLayoutGroupIds.add(id);
      nextLayout.push({ type: "group", id });
    }
  }

  for (const rid of runnerIds) {
    if (groupedRunnerIds.has(rid) || seenLayoutRunnerIds.has(rid)) continue;
    nextLayout.push({ type: "runner", id: rid });
    seenLayoutRunnerIds.add(rid);
  }
  for (const g of state.runner_groups) {
    if (seenLayoutGroupIds.has(g.id)) continue;
    nextLayout.push({ type: "group", id: g.id });
    seenLayoutGroupIds.add(g.id);
  }
  state.runner_layout = nextLayout;
}

function findRunnerById(rid) {
  return state.runners.find((r) => r.id === rid) || null;
}

function findGroupById(gid) {
  return state.runner_groups.find((g) => g.id === gid) || null;
}

function findGroupContainingRunner(rid) {
  return state.runner_groups.find((g) => (g.runner_ids || []).includes(rid)) || null;
}

function findLayoutIndexByRunnerId(rid) {
  return state.runner_layout.findIndex((item) => item?.type === "runner" && item?.id === rid);
}

function findLayoutIndexByGroupId(gid) {
  return state.runner_layout.findIndex((item) => item?.type === "group" && item?.id === gid);
}

function removeRunnerFromLayout(rid) {
  const idx = findLayoutIndexByRunnerId(rid);
  if (idx >= 0) state.runner_layout.splice(idx, 1);
}

function removeRunnerFromGroups(rid) {
  state.runner_groups.forEach((g) => {
    g.runner_ids = (g.runner_ids || []).filter((id) => id !== rid);
    g.disabled_runner_ids = (g.disabled_runner_ids || []).filter((id) => id !== rid);
  });
}

function activeRunnerIdsForGroup(group) {
  if (!group) return [];
  const disabled = new Set(Array.isArray(group.disabled_runner_ids) ? group.disabled_runner_ids : []);
  return (group.runner_ids || []).filter((rid) => !disabled.has(rid));
}

function isRunnerEnabledForGroupRun(group, rid) {
  if (!group || !rid) return true;
  const disabled = new Set(Array.isArray(group.disabled_runner_ids) ? group.disabled_runner_ids : []);
  return !disabled.has(rid);
}

function insertRunnerInLayout(rid, index) {
  removeRunnerFromGroups(rid);
  removeRunnerFromLayout(rid);
  const targetIndex = clampInt(index, 0, state.runner_layout.length);
  state.runner_layout.splice(targetIndex, 0, { type: "runner", id: rid });
  normalizeRunnerStructureState();
}

function insertRunnerIntoGroup(rid, gid, index) {
  const group = findGroupById(gid);
  if (!group) return false;
  removeRunnerFromGroups(rid);
  removeRunnerFromLayout(rid);
  const ids = Array.isArray(group.runner_ids) ? [...group.runner_ids] : [];
  const targetIndex = clampInt(index, 0, ids.length);
  ids.splice(targetIndex, 0, rid);
  group.runner_ids = ids;
  normalizeRunnerStructureState();
  return true;
}

function moveRunnerUpInStructure(rid) {
  const group = findGroupContainingRunner(rid);
  if (group) {
    const idx = (group.runner_ids || []).indexOf(rid);
    if (idx < 0) return false;
    if (idx > 0) {
      moveItemInArray(group.runner_ids, idx, idx - 1);
      return true;
    }
    const groupLayoutIdx = findLayoutIndexByGroupId(group.id);
    if (groupLayoutIdx < 0) return false;
    group.runner_ids = (group.runner_ids || []).filter((id) => id !== rid);
    state.runner_layout.splice(groupLayoutIdx, 0, { type: "runner", id: rid });
    normalizeRunnerStructureState();
    return true;
  }

  const layoutIdx = findLayoutIndexByRunnerId(rid);
  if (layoutIdx <= 0) return false;
  const prev = state.runner_layout[layoutIdx - 1];
  if (prev?.type === "runner") {
    return moveItemInArray(state.runner_layout, layoutIdx, layoutIdx - 1);
  }
  if (prev?.type === "group") {
    return insertRunnerIntoGroup(rid, prev.id, Number.MAX_SAFE_INTEGER);
  }
  return false;
}

function moveRunnerDownInStructure(rid) {
  const group = findGroupContainingRunner(rid);
  if (group) {
    const ids = group.runner_ids || [];
    const idx = ids.indexOf(rid);
    if (idx < 0) return false;
    if (idx < ids.length - 1) {
      moveItemInArray(ids, idx, idx + 1);
      return true;
    }
    const groupLayoutIdx = findLayoutIndexByGroupId(group.id);
    if (groupLayoutIdx < 0) return false;
    group.runner_ids = ids.filter((id) => id !== rid);
    state.runner_layout.splice(groupLayoutIdx + 1, 0, { type: "runner", id: rid });
    normalizeRunnerStructureState();
    return true;
  }

  const layoutIdx = findLayoutIndexByRunnerId(rid);
  if (layoutIdx < 0 || layoutIdx >= state.runner_layout.length - 1) return false;
  const next = state.runner_layout[layoutIdx + 1];
  if (next?.type === "runner") {
    return moveItemInArray(state.runner_layout, layoutIdx, layoutIdx + 1);
  }
  if (next?.type === "group") {
    return insertRunnerIntoGroup(rid, next.id, 0);
  }
  return false;
}

function moveGroupInLayout(gid, direction) {
  const layoutIdx = findLayoutIndexByGroupId(gid);
  if (layoutIdx < 0) return false;
  const target = direction < 0 ? layoutIdx - 1 : layoutIdx + 1;
  return moveItemInArray(state.runner_layout, layoutIdx, target);
}

function removeGroupAndUngroupRunners(gid) {
  const group = findGroupById(gid);
  if (!group) return false;
  const groupLayoutIdx = findLayoutIndexByGroupId(gid);
  const members = [...(group.runner_ids || [])];

  state.runner_groups = state.runner_groups.filter((g) => g.id !== gid);
  state.runner_layout = state.runner_layout.filter((item) => !(item?.type === "group" && item?.id === gid));

  if (groupLayoutIdx >= 0) {
    const inserts = members.map((rid) => ({ type: "runner", id: rid }));
    state.runner_layout.splice(groupLayoutIdx, 0, ...inserts);
  } else {
    members.forEach((rid) => state.runner_layout.push({ type: "runner", id: rid }));
  }
  delete runtime.groupStatus[gid];
  normalizeRunnerStructureState();
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
    const locale = LANG_LOCALES[currentLang()] || LANG_LOCALES[LANG_FALLBACK];
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    const locale = LANG_LOCALES[currentLang()] || LANG_LOCALES[LANG_FALLBACK];
    return d.toLocaleString(locale, {
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
  const groupNodes = document.querySelectorAll("[data-group-elapsed]");
  if (!nodes.length && !groupNodes.length) return;
  const nowMs = Date.now();
  nodes.forEach((node) => {
    const rid = String(node.dataset.runnerElapsed || "");
    const rt = runtime.status[rid] || {};
    const isActive = !!rt.running || !!rt.scheduled;
    const activeTs = String(rt.active_ts || rt.started_ts || "");
    if (isActive && activeTs) {
      const s = formatElapsedSince(activeTs, nowMs);
      if (s) {
        node.classList.remove("hidden");
        node.textContent = `⏱ ${s}`;
        node.title = t("active_since", { elapsed: s });
        return;
      }
    }
    node.classList.add("hidden");
    node.textContent = "";
    node.title = "";
  });
  groupNodes.forEach((node) => {
    const gid = String(node.dataset.groupElapsed || "");
    const groupState = runtime.groupStatus[gid] || {};
    const isActive = isGroupStatusActive(groupState);
    const startedTs = String(groupState.started_ts || "");
    if (isActive && startedTs) {
      const s = formatElapsedSince(startedTs, nowMs);
      if (s) {
        node.classList.remove("hidden");
        node.textContent = `⏱ ${s}`;
        node.title = t("active_since", { elapsed: s });
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
    return `[${ts}] ${delivery} | ${runner} -> ${service} | ${msg} | ${t("journal_error")}: ${err}`;
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
  const isDirty = ui.dirtyNotifyProfiles.has(npid);
  btn.disabled = !isDirty;
  if (!isDirty) {
    btn.title = t("no_changes");
  } else {
    btn.removeAttribute("title");
  }
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
  syncRunnerRunButton(rid);
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
  if (btn) {
    btn.classList.toggle("invalid", isRunnerSaveBlocked(r));
    btn.classList.toggle("dirty", ui.dirtyRunners.has(rid));
    const isDirty = ui.dirtyRunners.has(rid);
    btn.disabled = !isDirty;
    if (!isDirty) {
      btn.title = t("no_changes");
    } else {
      btn.removeAttribute("title");
    }
  }
  syncRunnerRunButton(rid);
}

function syncRunnerRunButton(rid) {
  const btn = document.querySelector(`[data-runstop="${rid}"]`);
  if (!btn) return;
  const r = state.runners.find((x) => x.id === rid);
  const rt = runtime.status[rid] || {};
  const isActive = !!rt.running || !!rt.scheduled;
  if (isActive) {
    btn.disabled = false;
    btn.removeAttribute("title");
    return;
  }

  let shouldDisable = false;
  let reason = "";
  if (!r || isRunnerCommandMissing(r)) {
    shouldDisable = true;
    reason = t("cmd_missing_reason");
  } else if (ui.dirtyRunners.has(rid) || isRunnerSaveBlocked(r)) {
    shouldDisable = true;
    reason = t("save_first_reason");
  }
  btn.disabled = shouldDisable;
  if (shouldDisable) {
    btn.title = reason;
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

function computeRunnerGroupSignature(g) {
  const runnerIds = Array.isArray(g?.runner_ids)
    ? g.runner_ids.map((rid) => String(rid ?? "")).sort()
    : [];
  const disabledRunnerIds = Array.isArray(g?.disabled_runner_ids)
    ? g.disabled_runner_ids.map((rid) => String(rid ?? "")).sort()
    : [];
  return JSON.stringify({
    name: String(g?.name ?? ""),
    runner_ids: runnerIds,
    disabled_runner_ids: disabledRunnerIds,
  });
}

function syncSavedRunnerGroupSignatures() {
  const next = {};
  state.runner_groups.forEach((g) => {
    next[g.id] = computeRunnerGroupSignature(g);
  });
  ui.savedRunnerGroupSignatures = next;
}

function refreshRunnerGroupDirtyState(gid) {
  if (!gid) return;
  const g = findGroupById(gid);
  if (!g) {
    ui.dirtyRunnerGroups.delete(gid);
    const missingCard = document.querySelector(`.groupCard[data-group-id="${gid}"]`);
    if (missingCard) {
      missingCard.classList.remove("is-dirty");
    }
    const missingNameInput = document.querySelector(`[data-group-name="${gid}"]`);
    if (missingNameInput) {
      missingNameInput.classList.remove("is-dirty");
    }
    return;
  }
  const currentSig = computeRunnerGroupSignature(g);
  const savedSig = ui.savedRunnerGroupSignatures[gid];
  if (savedSig === undefined || currentSig !== savedSig) {
    ui.dirtyRunnerGroups.add(gid);
  } else {
    ui.dirtyRunnerGroups.delete(gid);
  }
  const card = document.querySelector(`.groupCard[data-group-id="${gid}"]`);
  const nameInput = document.querySelector(`[data-group-name="${gid}"]`);
  const isDirty = ui.dirtyRunnerGroups.has(gid);
  if (card) {
    card.classList.toggle("is-dirty", isDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isDirty);
  }
}

function syncRunnerGroupDirtyButton(gid) {
  const isDirty = ui.dirtyRunnerGroups.has(gid);
  const card = document.querySelector(`.groupCard[data-group-id="${gid}"]`);
  const nameInput = document.querySelector(`[data-group-name="${gid}"]`);
  if (card) {
    card.classList.toggle("is-dirty", isDirty);
  }
  if (nameInput) {
    nameInput.classList.toggle("is-dirty", isDirty);
  }
  const btn = document.querySelector(`[data-save-group-name="${gid}"]`);
  if (!btn) return;
  btn.classList.toggle("dirty", isDirty);
  btn.disabled = !isDirty;
  if (!isDirty) {
    btn.title = t("no_changes");
  } else {
    btn.removeAttribute("title");
  }
}

function syncAllRunnerGroupDirtyButtons() {
  document.querySelectorAll("[data-save-group-name]").forEach((btn) => {
    const gid = btn.getAttribute("data-save-group-name");
    syncRunnerGroupDirtyButton(gid);
  });
}

function refreshAllRunnerGroupDirtyStates() {
  const existing = new Set(state.runner_groups.map((g) => g.id));
  Object.keys(ui.savedRunnerGroupSignatures).forEach((gid) => {
    if (!existing.has(gid)) {
      delete ui.savedRunnerGroupSignatures[gid];
      ui.dirtyRunnerGroups.delete(gid);
    }
  });
  state.runner_groups.forEach((g) => refreshRunnerGroupDirtyState(g.id));
}

function clearAllDirtyRunnerGroups() {
  ui.dirtyRunnerGroups.clear();
}

function notifyProfileValidationError(np) {
  if (!np) return t("unknown_notify_service");
  if ((np.name || "").trim() === "") return t("service_name_missing");
  if ((np.type || "pushover") === "pushover") {
    if ((np.config?.user_key || "").trim() === "") return t("user_key_missing");
    if ((np.config?.api_token || "").trim() === "") return t("api_token_missing");
  }
  return "";
}

function hasUnsavedLocalChanges() {
  if (ui.dirtyNotifyProfiles.size > 0 || ui.dirtyRunners.size > 0 || ui.dirtyRunnerGroups.size > 0) return true;
  if (state.notify_profiles.some((np) => !!np?._isNew)) return true;
  if (state.runners.some((r) => !!r?._isNew)) return true;
  return false;
}

function validateStateBeforePersist() {
  const blocking = [];
  for (const np of state.notify_profiles) {
    if (!np?._isNew) continue;
    const err = notifyProfileValidationError(np);
    if (err) blocking.push(`${np.name || np.id || t("new_service_fallback")}: ${err}`);
  }
  for (const r of state.runners) {
    if (!r?._isNew) continue;
    if (isRunnerCommandMissing(r)) {
      blocking.push(`Runner "${r.name || r.id || t("new_runner_fallback")}": ${t("cmd_missing_short")}`);
    }
  }
  if (blocking.length === 0) return true;
  const msg = t("save_blocked", { reasons: blocking.join(" | ") });
  hulkFlash("error", msg);
  logHulk("error", t("save_blocked_log", { reasons: blocking.join(" | ") }));
  return false;
}

function renderNotifySection() {
  const count = state.notify_profiles.length;
  const title = el("notifySectionTitle");
  const toggle = el("notifySectionToggle");
  const body = el("notifySectionBody");
  const sortBtn = el("sortNotifyBtn");

  if (title) {
    const base = t("notify_services_title");
    title.textContent = count > 0 ? `${base} (${count})` : base;
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
  normalizeRunnerStructureState();
  const runnerCount = state.runners.length;
  const topLevelCount = state.runner_layout.length;
  const hasGroupInternalMoves = state.runner_groups.some((g) => (g.runner_ids || []).length > 1);
  const canSort = topLevelCount > 1 || hasGroupInternalMoves;
  const title = el("runnerSectionTitle");
  const toggle = el("runnerSectionToggle");
  const body = el("runnerSectionBody");
  const sortBtn = el("sortRunnerBtn");

  if (title) {
    const base = t("runners_title");
    title.textContent = runnerCount > 0 ? `${base} (${runnerCount})` : base;
  }
  if (toggle) {
    toggle.textContent = ui.runnerSectionCollapsed ? "+" : "-";
  }
  if (body) {
    body.classList.toggle("hidden", ui.runnerSectionCollapsed);
  }
  if (!canSort && ui.runnerSortMode) {
    ui.runnerSortMode = false;
    saveUIState();
  }
  if (sortBtn) {
    sortBtn.classList.toggle("hidden", !canSort);
  }
  syncSortModeButtons();
}

function renderNotifyJournalSection() {
  const toggle = el("notifyJournalSectionToggle");
  const body = el("notifyJournalSectionBody");
  if (toggle) {
    toggle.textContent = ui.notifyJournalSectionCollapsed ? "+" : "-";
  }
  if (body) {
    body.classList.toggle("hidden", ui.notifyJournalSectionCollapsed);
  }
}

function renderEventsSection() {
  const toggle = el("eventsSectionToggle");
  const body = el("eventsSectionBody");
  if (toggle) {
    toggle.textContent = ui.eventsSectionCollapsed ? "+" : "-";
  }
  if (body) {
    body.classList.toggle("hidden", ui.eventsSectionCollapsed);
  }
}

function scheduleOptions(max) {
  let opts = "";
  for (let i = 0; i <= max; i++) opts += `<option value="${i}">${i}</option>`;
  return opts;
}

function runsOptions() {
  let opts = `<option value="1">1</option>`;
  for (let i = 2; i <= 100; i++) opts += `<option value="${i}">${i}</option>`;
  opts += `<option value="-1">${t("infinite")}</option>`;
  return opts;
}

function formatSecondsLabel(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return t("off");
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
  return optionsFromValues([0, 3, 5, 10, 15], (v) => (v === 0 ? t("off") : t("failures", { n: v })));
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
    ["", t("no_status")],
    ["UP", "UP"],
    ["DOWN", "DOWN"],
    ["WARN", "WARN"],
    ["INFO", "INFO"],
    ["STOP", "STOP"],
  ];
  return vals
    .map(([v, label]) => `<option value="${v}" ${curr === v ? "selected" : ""}>${label}</option>`)
    .join("");
}

function collectState() {
  normalizeRunnerStructureState();
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
    runner_groups: state.runner_groups.map((g) => ({
      id: g.id,
      name: g.name,
      runner_ids: [...(g.runner_ids || [])],
      disabled_runner_ids: [...(g.disabled_runner_ids || [])],
    })),
    runner_layout: state.runner_layout.map((item) => ({
      type: item.type === "group" ? "group" : "runner",
      id: item.id,
    })),
  };
}

function setFromState(st) {
  const prevNotifyCollapsed = new Map(
    (state.notify_profiles || []).map((np) => [String(np.id || ""), !!np._collapsed]),
  );
  const prevRunnerCollapsed = new Map(
    (state.runners || []).map((r) => [String(r.id || ""), !!r._collapsed]),
  );
  const prevGroupCollapsed = new Map(
    (state.runner_groups || []).map((g) => [String(g.id || ""), !!g._collapsed]),
  );

  clearAllDirtyNotifyProfiles();
  clearAllDirtyRunners();
  clearAllDirtyRunnerGroups();
  state.notify_profiles = (st.notify_profiles ?? []).map((np) => {
    const id = np.id ?? `notify_${uuidFallback()}`;
    return {
      id,
      name: np.name ?? "Pushover",
      type: np.type ?? "pushover",
      active: np.active !== false,
      failure_count: Number(np.failure_count || 0),
      sent_count: Number(np.sent_count || 0),
      config: {
        user_key: np.config?.user_key ?? "",
        api_token: np.config?.api_token ?? "",
      },
      _collapsed: prevNotifyCollapsed.has(id) ? !!prevNotifyCollapsed.get(id) : true,
      _isNew: false,
    };
  });
  syncSavedNotifySignatures();

  state.runners = (st.runners ?? []).map((r) => {
    const id = r.id ?? `runner_${uuidFallback()}`;
    return {
      id,
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
      _collapsed: prevRunnerCollapsed.has(id) ? !!prevRunnerCollapsed.get(id) : true,
      _isNew: false,
    };
  });
  state.runner_groups = (st.runner_groups ?? []).map((g) => {
    const id = g.id ?? `group_${uuidFallback()}`;
    return {
      id,
      name: g.name ?? t("new_group_default_name"),
      runner_ids: Array.isArray(g.runner_ids) ? g.runner_ids.slice() : [],
      disabled_runner_ids: Array.isArray(g.disabled_runner_ids) ? g.disabled_runner_ids.slice() : [],
      _collapsed: prevGroupCollapsed.has(id) ? !!prevGroupCollapsed.get(id) : true,
    };
  });
  state.runner_layout = (st.runner_layout ?? []).map((item) => ({
    type: String(item?.type || "").toLowerCase() === "group" ? "group" : "runner",
    id: item?.id ?? "",
  }));
  if (!Array.isArray(st.runner_layout) || st.runner_layout.length === 0) {
    state.runner_layout = state.runners.map((r) => ({ type: "runner", id: r.id }));
  }
  normalizeRunnerStructureState();
  syncSavedRunnerSignatures();
  syncSavedRunnerGroupSignatures();

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
    wrap.innerHTML = `<p class="hint">${escapeHtml(t("notify_none_configured"))}</p>`;
    return;
  }

	  state.notify_profiles.forEach((np, idx) => {
	    const isDirty = ui.dirtyNotifyProfiles.has(np.id);
	    const saveBlocked = isNotifySaveBlocked(np);
	    const isSaveableDirty = isDirty && !saveBlocked;
    const isActive = np.active !== false;
    const failCount = Math.max(0, Number(np.failure_count || 0));
    const sentCount = Math.max(0, Number(np.sent_count || 0));
    let notifyStatusText = "";
    if (!isActive) {
      notifyStatusText = (failCount >= 3)
        ? t("notify_status_inactive_auto", { fail: failCount, sent: sentCount })
        : t("notify_status_inactive_manual", { sent: sentCount });
    } else {
      notifyStatusText = (failCount > 0)
        ? t("notify_status_active_fail", { fail: failCount, sent: sentCount })
        : t("notify_status_active_ok", { sent: sentCount });
    }
    const notifyStatusKind = !isActive ? "error" : (failCount >= 2 ? "warn" : (failCount > 0 ? "info" : "ok"));
    const div = document.createElement("div");
    div.className = `notifyProfile${isSaveableDirty ? " is-dirty" : ""}`;
    div.dataset.notifyId = np.id;
    div.innerHTML = `
	      <div class="notifyHead">
	        <div class="notifyTitle">
	          <div class="notifyTitleRow">
	            <span class="toggle" data-toggle-notify="${np.id}">${np._collapsed ? "+" : "-"}</span>
	            <input data-npname="${np.id}" value="${escapeHtml(np.name)}" placeholder="${escapeHtml(t("service_name_placeholder"))}" />
	            <span class="small">${np.type}</span>
	          </div>
	          <span class="small notifyStateText ${notifyStatusKind}" title="${escapeHtml(notifyStatusText)}">${escapeHtml(notifyStatusText)}</span>
	        </div>
		        <div class="row gap center wrapline notifyActions">
	          <div class="row gap center reorderControls ${ui.notifySortMode ? "" : "hidden"}">
	            <button class="btn" data-move-np-up="${np.id}" ${idx === 0 ? "disabled" : ""} title="${escapeHtml(t("move_up"))}">↑</button>
	            <button class="btn" data-move-np-down="${np.id}" ${idx === state.notify_profiles.length - 1 ? "disabled" : ""} title="${escapeHtml(t("move_down"))}">↓</button>
	          </div>
		          <button class="btn ${isActive ? "primary" : "danger"}" data-toggle-npactive="${np.id}" title="${escapeHtml(isActive ? t("service_active_title") : t("service_inactive_title"))}">${escapeHtml(isActive ? t("active") : t("inactive"))}</button>
		          <button class="btn" data-test-notify="${np.id}" ${isActive ? "" : `disabled title="${escapeHtml(t("service_inactive"))}"`}>Test</button>
		          <button class="btn primary notifySaveBtn ${isDirty ? "dirty" : ""} ${saveBlocked ? "invalid" : ""}" data-save-npname="${np.id}" ${isDirty ? "" : `disabled title="${escapeHtml(t("no_changes"))}"`}>${escapeHtml(t("save"))}</button>
		          <button class="btn danger" data-del-notify="${np.id}">${escapeHtml(t("remove"))}</button>
		        </div>
		      </div>
	      <div class="notifyBody ${np._collapsed ? "hidden" : ""}" data-nbody="${np.id}">
	        <div class="grid2">
	          <label>
	            <span>User Key</span>
	            <input type="password" data-npuser="${np.id}" placeholder="${np.config.user_key ? escapeHtml(t("secret_set")) : escapeHtml(t("user_key_enter"))}" />
	          </label>
	          <label>
	            <span>API Token</span>
	            <input type="password" data-nptoken="${np.id}" placeholder="${np.config.api_token ? escapeHtml(t("secret_set")) : escapeHtml(t("api_token_enter"))}" />
	          </label>
	        </div>
	        <p class="hint" style="margin-top:8px;">${escapeHtml(t("creds_hint"))}</p>
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
          hulkFlash("success", t("service_enabled", { label }), 3200);
          logHulk("success", t("service_enabled", { label }));
        } else {
          hulkFlash("info", t("service_disabled", { label }), 3200);
          logHulk("info", t("service_disabled", { label }));
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

      logHulk("info", t("test_notify_start", { name: np.name }));
      hulkFlash("info", t("test_notify_start", { name: np.name }), 3500);
      try {
        const res = await apiPost("/api/pushover_test", { profile_id: npid, message: "" });
        logHulk("success", t("test_ok_log", { name: np.name, response: JSON.stringify(res.result) }));
        hulkFlash("success", t("test_ok_flash", { name: np.name }), 4200);
      } catch (e) {
        logHulk("error", t("test_fail", { name: np.name, err: e.message }));
        hulkFlash("error", t("test_fail", { name: np.name, err: e.message }));
      }
    });
  });

  wrap.querySelectorAll("[data-del-notify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npid = btn.getAttribute("data-del-notify");
      const np = state.notify_profiles.find((x) => x.id === npid);
      const name = np ? np.name : t("service_fallback");

      if (!confirm(t("confirm_delete_notify", { name }))) {
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
        hulkFlash("success", t("notify_removed", { name }), 3200);
        logHulk("success", t("notify_removed", { name }));
      }
    });
  });
}

function renderCasesForRunner(rid) {
  const r = state.runners.find((x) => x.id === rid);
  const wrap = document.querySelector(`[data-cases="${rid}"]`);
  if (!r || !wrap) return;
  wrap.innerHTML = "";
  const rt = runtime.status[rid] || {};
  const isActive = !!rt.running || !!rt.scheduled;
  const lockAttr = isActive ? "disabled" : "";

  r.cases.forEach((c, idx) => {
    const div = document.createElement("div");
    div.className = "case";
	    div.innerHTML = `
	      <div class="small">Case ${idx + 1}</div>
	      <div class="grid3" style="margin-top:8px;">
	        <label>
	          <span>pattern (Regex)</span>
	          <input data-cpat="${c.id}" value="${escapeHtml(c.pattern)}" placeholder="${escapeHtml(t("case_pattern_placeholder"))}" ${lockAttr} />
	        </label>
	        <label>
	          <span>message template</span>
	          <input data-cmsg="${c.id}" value="${escapeHtml(c.message_template)}" placeholder="${escapeHtml(t("case_message_placeholder"))}" ${lockAttr} />
	        </label>
	        <label>
	          <span>Status</span>
	          <select data-cstate="${c.id}" ${lockAttr}>
	            ${caseStateOptions(c.state || "")}
	          </select>
	        </label>
	      </div>
	      <div class="row between center" style="margin-top:10px;">
	        <span class="small">${escapeHtml(t("case_help"))}</span>
	        <button class="btn danger" data-crem="${c.id}" ${lockAttr}>${escapeHtml(t("remove"))}</button>
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
      if (!confirm(t("confirm_delete_case", { idx: idx + 1 }))) {
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

function isGroupStatusActive(groupState) {
  const status = String(groupState?.status || "");
  return status === "started" || status === "running" || status === "stopping";
}

function groupStateText(groupState) {
  if (!groupState || !groupState.status) return "";
  const status = String(groupState.status || "");
  const done = Math.max(0, Number(groupState.completed_count || 0));
  const total = Math.max(0, Number(groupState.total_count || 0));
  const currentRunnerId = String(groupState.current_runner_id || "").trim();
  const currentIndex = Math.max(0, Number(groupState.current_index || 0));
  const runnerObj = currentRunnerId ? findRunnerById(currentRunnerId) : null;
  const runnerName = String(runnerObj?.name || "").trim();
  const runner = currentRunnerId ? (runnerName || currentRunnerId) : "-";
  if (status === "started" || status === "running") {
    const activeIndex = currentIndex > 0
      ? currentIndex
      : (currentRunnerId ? done + 1 : done);
    const runningDone = Math.max(done, activeIndex);
    const shownDone = total > 0 ? Math.min(runningDone, total) : runningDone;
    return t("group_state_running", { done: shownDone, total, runner });
  }
  if (status === "stopping") return t("group_state_stopping");
  if (status === "finished") return t("group_state_finished", { done, total });
  if (status === "error") return t("group_state_error", { err: groupState.error || "unknown" });
  if (status === "stopped") return t("group_state_stopped");
  return status;
}

function renderRunners() {
  normalizeRunnerStructureState();
  const wrap = el("runners");
  wrap.innerHTML = "";
  renderRunnerSection();
  refreshAllRunnerDirtyStates();
  refreshAllRunnerGroupDirtyStates();
  const cloneBlockedByUnsaved = hasUnsavedLocalChanges();

  const appendRunnerCard = (container, r, moveConfig, groupContext = null) => {
    const rt = runtime.status[r.id] || {};
    const running = !!rt.running;
    const scheduled = !!rt.scheduled;
    const paused = !!rt.paused;
    const consecutiveFailures = Math.max(0, Number(rt.consecutive_failures || 0));
    const isActive = running || scheduled;
    const isLocked = isActive;
    const activeTs = String(rt.active_ts || rt.started_ts || "");
    const elapsedText = isActive ? formatElapsedSince(activeTs) : "";
    const showElapsed = isActive && !!elapsedText;
    const maxRuns = Number(r.max_runs);
    const intervalSeconds =
      ((Number(r.schedule?.hours) || 0) * 3600) +
      ((Number(r.schedule?.minutes) || 0) * 60) +
      (Number(r.schedule?.seconds) || 0);
    const hasSchedule = intervalSeconds > 0;

    let statusPrefix = "";
    if (paused) {
      statusPrefix = `⏸ (${consecutiveFailures}) `;
    }

    let runInfoText = "";
    if (!paused && isActive && hasSchedule) {
      const rc = Math.max(0, Number(rt.run_count || 0));
      if (maxRuns === -1) {
        runInfoText = `${rc}/∞`;
      } else if (maxRuns > 1) {
        runInfoText = `${rc}/${maxRuns}`;
      }
    }
    const showRunInfo = !!runInfoText;
    const runnerStateParts = [];
    if (paused) {
      runnerStateParts.push(t("runner_auto_pause_state", { n: consecutiveFailures }));
    }
    if (rt.last_case) {
      runnerStateParts.push(`${formatTime(rt.last_case_ts)}: ${rt.last_case}`);
    }
    const runnerStateText = `${statusPrefix}${runnerStateParts.join(" | ")}`.trim();
    const isDirty = ui.dirtyRunners.has(r.id);
    const saveBlocked = isRunnerSaveBlocked(r);
    const isSaveableDirty = isDirty && !saveBlocked;
    const canClone = !isLocked && !cloneBlockedByUnsaved && !r._isNew && !isDirty && !saveBlocked;
    const cloneDisabledAttr = canClone
      ? ""
      : (isLocked
        ? `disabled title="${escapeHtml(t("lock_active_title"))}"`
        : `disabled title="${escapeHtml(t("clone_needs_saved_title"))}"`);
    const runDisabledAttr = (!isActive && isRunnerCommandMissing(r))
      ? `disabled title="${escapeHtml(t("cmd_missing_reason"))}"`
      : (!isActive && (isDirty || saveBlocked))
        ? `disabled title="${escapeHtml(t("save_first_reason"))}"`
        : "";
    const lockAttr = isLocked ? "disabled" : "";
    const removeDisabledAttr = isLocked ? `disabled title="${escapeHtml(t("lock_active_title"))}"` : "";
    const upDisabled = !!moveConfig.moveUpDisabled || isLocked;
    const downDisabled = !!moveConfig.moveDownDisabled || isLocked;
    const moveUpTitle = isLocked ? t("lock_active_title") : t("move_up");
    const moveDownTitle = isLocked ? t("lock_active_title") : t("move_down");
    const groupId = String(groupContext?.groupId || "").trim();
    const isGroupMember = !!groupId;
    const isGroupRunEnabled = isGroupMember ? !!groupContext?.groupRunEnabled : true;
    const groupRunLabel = isGroupRunEnabled ? t("group_runner_enabled") : t("group_runner_disabled");
    const groupRunTitle = isGroupRunEnabled ? t("group_runner_disable_title") : t("group_runner_enable_title");

    const div = document.createElement("div");
    div.className = `runner${isSaveableDirty ? " is-dirty" : ""}${isGroupMember && !isGroupRunEnabled ? " is-group-disabled" : ""}`;
    div.dataset.runnerId = r.id;
    div.innerHTML = `
      <div class="runnerHead">
        <div class="runnerIdentity">
          <div class="runnerTitleRow">
            <span class="toggle" data-toggle="${r.id}">${r._collapsed ? "+" : "-"}</span>
            <input data-name="${r.id}" value="${escapeHtml(r.name)}" placeholder="${escapeHtml(t("runner_placeholder"))}" ${lockAttr} />
            <span class="pill runnerElapsed ${showElapsed ? "" : "hidden"}" data-runner-elapsed="${r.id}">${showElapsed ? `⏱ ${escapeHtml(elapsedText)}` : ""}</span>
            <span class="pill runnerRunInfo ${showRunInfo ? "" : "hidden"}">${showRunInfo ? escapeHtml(runInfoText) : ""}</span>
          </div>
          <div class="runnerState">
            <span class="small runnerStateText">${escapeHtml(runnerStateText)}</span>
          </div>
        </div>
        <div class="runnerActions row gap wrapline center">
          <div class="row gap center reorderControls ${ui.runnerSortMode ? "" : "hidden"}">
            <button class="btn" data-move-runner-up="${r.id}" ${upDisabled ? "disabled" : ""} title="${escapeHtml(moveUpTitle)}">↑</button>
            <button class="btn" data-move-runner-down="${r.id}" ${downDisabled ? "disabled" : ""} title="${escapeHtml(moveDownTitle)}">↓</button>
          </div>
          <button class="btn ${isActive ? "danger" : "primary"}" data-runstop="${r.id}" ${runDisabledAttr}>
            ${isActive ? "■ Stop" : "▶ Run"}
          </button>
          ${isGroupMember
            ? `<button class="btn groupMemberToggleBtn ${isGroupRunEnabled ? "primary" : ""}" data-group-member-toggle="${groupId}" data-group-member-runner="${r.id}" title="${escapeHtml(groupRunTitle)}">${escapeHtml(groupRunLabel)}</button>`
            : ""}
          <button class="btn primary runnerSaveBtn ${isDirty ? "dirty" : ""} ${saveBlocked ? "invalid" : ""}" data-save-name="${r.id}" ${isDirty ? "" : `disabled title="${escapeHtml(t("no_changes"))}"`}>${escapeHtml(t("save"))}</button>
          <button class="btn" data-clone-runner="${r.id}" ${cloneDisabledAttr}>Clone</button>
          <button class="btn danger" data-delrunner="${r.id}" ${removeDisabledAttr}>${escapeHtml(t("remove"))}</button>
        </div>
      </div>

      <div class="runnerBody ${r._collapsed ? "hidden" : ""}" data-body="${r.id}">
        <div class="runnerConfigGrid">
          <label class="runnerCommandBlock">
            <span>Command (bash -lc)</span>
            <textarea rows="7" data-command="${r.id}" ${lockAttr}>${escapeHtml(r.command)}</textarea>
          </label>
          <div class="runnerSettingsPanel">
            <div class="runnerSettingsSection">
              <span class="small runnerSectionTitle">${escapeHtml(t("notifications"))}</span>
              <div data-notify-checks="${r.id}" class="runnerNotifyChecks">
                ${state.notify_profiles.length === 0
                  ? `<span class="small" style="opacity:0.6;">${escapeHtml(t("no_services_available"))}</span>`
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
                            title="${escapeHtml(assigned ? t("notify_on_title") : t("notify_off_title"))}"
                          >
                            ${escapeHtml(assigned ? t("on") : t("off_short"))}
                          </button>
                          <button
                            class="btn ${onlyUpdates ? "primary" : ""}"
                            data-notify-updates="${r.id}"
                            data-notify-profile="${np.id}"
                            ${assigned ? "" : `disabled title="${escapeHtml(t("enable_first"))}"`}
                            title="${escapeHtml(onlyUpdates ? t("updates_only_title_on") : t("updates_only_title_off"))}"
                          >
                            ${escapeHtml(t("updates_only"))}
                          </button>
                        </div>
                      </div>
                    `;
                  }).join("")}
              </div>
            </div>

            <div class="runnerSettingsSection runnerLogButtons">
              <button class="btn ${r.logging_enabled ? "primary" : ""}" data-logging="${r.id}" title="${escapeHtml(isLocked ? t("lock_active_title") : t("logging_title"))}" ${lockAttr}>📄 Logging ${escapeHtml(r.logging_enabled ? t("logging_on") : t("logging_off"))}</button>
              <button class="btn" data-openlog="${r.id}">${escapeHtml(t("open_log"))}</button>
              <button class="btn danger" data-clearlog="${r.id}" ${lockAttr} title="${escapeHtml(isLocked ? t("lock_active_title") : t("clear_log"))}">${escapeHtml(t("clear_log"))}</button>
            </div>

            <div class="runnerSettingsSection">
              <span class="small runnerSectionTitle">${escapeHtml(t("scheduler"))}</span>
              <div class="grid3 runnerScheduleGrid">
                <label><span>${escapeHtml(t("hours"))}</span><select data-h="${r.id}" ${lockAttr}>${scheduleOptions(23)}</select></label>
                <label><span>${escapeHtml(t("minutes"))}</span><select data-m="${r.id}" ${lockAttr}>${scheduleOptions(59)}</select></label>
                <label><span>${escapeHtml(t("seconds"))}</span><select data-s="${r.id}" ${lockAttr}>${scheduleOptions(59)}</select></label>
              </div>
              <div class="runnerRunsWrap">
                <label><span>${escapeHtml(t("total_runs"))}</span><select data-runs="${r.id}" ${lockAttr}>${runsOptions()}</select></label>
              </div>
              <div class="grid3 runnerScheduleGrid" style="margin-top:10px;">
                <label>
                  <span>${escapeHtml(t("alert_cooldown"))}</span>
                  <select data-cooldown="${r.id}" ${lockAttr}>${cooldownOptions()}</select>
                </label>
                <label>
                  <span>${escapeHtml(t("escalation"))}</span>
                  <select data-escalate="${r.id}" ${lockAttr}>${escalationOptions()}</select>
                </label>
                <label>
                  <span>${escapeHtml(t("auto_pause"))}</span>
                  <select data-failpause="${r.id}" ${lockAttr}>${failurePauseOptions()}</select>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="runnerSection">
          <div class="runnerSectionHead">
            <h3>${escapeHtml(t("cases"))}</h3>
          </div>
          <p class="hint">${escapeHtml(t("cases_hint"))}</p>
          <div data-cases="${r.id}"></div>
          <div class="row" style="margin-top:10px; justify-content:flex-end;">
            <button class="btn" data-addcase="${r.id}" ${lockAttr} title="${escapeHtml(isLocked ? t("lock_active_title") : t("add_case_title"))}">${escapeHtml(t("add_case"))}</button>
          </div>
        </div>

        <div class="runnerSection">
          <div class="runnerSectionHead">
            <h3>${escapeHtml(t("output"))}</h3>
            <button class="btn" data-copy-output="${r.id}" title="${escapeHtml(t("copy_title"))}">${escapeHtml(t("copy"))}</button>
          </div>
          <pre class="output runnerOutput" data-output="${r.id}"></pre>
        </div>
      </div>
    `;
    container.appendChild(div);

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
      Number(r.failure_pause_threshold ?? 5) === 0 ? t("off") : t("failures", { n: Number(r.failure_pause_threshold ?? 5) }),
    );

    renderCasesForRunner(r.id);
    const out = runnerOutputEl(r.id);
    if (out) out.textContent = runtime.outputs[r.id] || (rt.tail || "");
  };

  state.runner_layout.forEach((item, layoutIdx) => {
    if (item.type === "runner") {
      const r = findRunnerById(item.id);
      if (!r) return;
      appendRunnerCard(wrap, r, {
        moveUpDisabled: layoutIdx <= 0,
        moveDownDisabled: layoutIdx >= state.runner_layout.length - 1,
      });
      return;
    }

    if (item.type === "group") {
      const group = findGroupById(item.id);
      if (!group) return;
      const groupState = runtime.groupStatus[group.id] || {};
      const groupActive = isGroupStatusActive(groupState);
      const groupStartedTs = String(groupState.started_ts || "");
      const groupElapsedText = groupActive ? formatElapsedSince(groupStartedTs) : "";
      const showGroupElapsed = groupActive && !!groupElapsedText;
      const isGroupDirty = ui.dirtyRunnerGroups.has(group.id);
      const groupDiv = document.createElement("div");
      groupDiv.className = `groupCard${isGroupDirty ? " is-dirty" : ""}`;
      groupDiv.dataset.groupId = group.id;
      groupDiv.innerHTML = `
        <div class="groupHead">
          <div class="groupIdentity">
            <div class="groupTitleRow">
              <span class="toggle" data-toggle-group="${group.id}">${group._collapsed ? "+" : "-"}</span>
              <input data-group-name="${group.id}" value="${escapeHtml(group.name)}" placeholder="${escapeHtml(t("group_placeholder"))}" />
              <span class="pill groupElapsed ${showGroupElapsed ? "" : "hidden"}" data-group-elapsed="${group.id}">${showGroupElapsed ? `⏱ ${escapeHtml(groupElapsedText)}` : ""}</span>
            </div>
            <div class="groupState">
              <span class="small groupStateText">${escapeHtml(groupStateText(groupState))}</span>
            </div>
          </div>
          <div class="row gap center wrapline groupActions">
            <div class="row gap center reorderControls ${ui.runnerSortMode ? "" : "hidden"}">
              <button class="btn" data-move-group-up="${group.id}" ${layoutIdx <= 0 ? "disabled" : ""} title="${escapeHtml(t("move_up"))}">↑</button>
              <button class="btn" data-move-group-down="${group.id}" ${layoutIdx >= state.runner_layout.length - 1 ? "disabled" : ""} title="${escapeHtml(t("move_down"))}">↓</button>
            </div>
            <button class="btn ${groupActive ? "danger" : "primary"}" data-group-runstop="${group.id}">
              ${escapeHtml(groupActive ? t("group_stop") : t("group_run"))}
            </button>
            <button class="btn primary groupSaveBtn ${isGroupDirty ? "dirty" : ""}" data-save-group-name="${group.id}" ${isGroupDirty ? "" : `disabled title="${escapeHtml(t("no_changes"))}"`}>${escapeHtml(t("save"))}</button>
            <button class="btn danger" data-delgroup="${group.id}">${escapeHtml(t("remove"))}</button>
          </div>
        </div>
        <div class="groupBody ${group._collapsed ? "hidden" : ""}" data-group-body="${group.id}"></div>
      `;
      wrap.appendChild(groupDiv);
      const groupBody = groupDiv.querySelector(`[data-group-body="${group.id}"]`);
      const members = (group.runner_ids || [])
        .map((rid) => ({ rid, runner: findRunnerById(rid) }))
        .filter((entry) => !!entry.runner);
      if (!members.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = t("group_empty");
        groupBody?.appendChild(empty);
      } else {
        members.forEach((entry) => {
          appendRunnerCard(groupBody, entry.runner, {
            moveUpDisabled: false,
            moveDownDisabled: false,
          }, {
            groupId: group.id,
            groupRunEnabled: isRunnerEnabledForGroupRun(group, entry.rid),
          });
        });
      }
      return;
    }
  });

  wrap.querySelectorAll(`[data-toggle]`).forEach((toggleEl) => {
    toggleEl.addEventListener("click", () => {
      const rid = toggleEl.getAttribute("data-toggle");
      const r = findRunnerById(rid);
      if (!r) return;
      r._collapsed = !r._collapsed;
      document.querySelector(`[data-body="${rid}"]`)?.classList.toggle("hidden", r._collapsed);
      toggleEl.textContent = r._collapsed ? "+" : "-";
    });
  });

  wrap.querySelectorAll(`[data-toggle-group]`).forEach((toggleEl) => {
    toggleEl.addEventListener("click", () => {
      const gid = toggleEl.getAttribute("data-toggle-group");
      const g = findGroupById(gid);
      if (!g) return;
      g._collapsed = !g._collapsed;
      document.querySelector(`[data-group-body="${gid}"]`)?.classList.toggle("hidden", g._collapsed);
      toggleEl.textContent = g._collapsed ? "+" : "-";
    });
  });

  wrap.querySelectorAll("[data-group-name]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const gid = inp.getAttribute("data-group-name");
      const g = findGroupById(gid);
      if (!g) return;
      g.name = inp.value;
      refreshRunnerGroupDirtyState(gid);
      syncRunnerGroupDirtyButton(gid);
    });
  });

  wrap.querySelectorAll("[data-save-group-name]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await autoSave();
    });
  });

  wrap.querySelectorAll("[data-group-member-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gid = btn.getAttribute("data-group-member-toggle");
      const rid = btn.getAttribute("data-group-member-runner");
      const group = findGroupById(gid);
      if (!group || !rid) return;
      const memberRunnerIds = Array.isArray(group.runner_ids) ? group.runner_ids.slice() : [];
      if (!memberRunnerIds.includes(rid)) return;
      const disabled = new Set(Array.isArray(group.disabled_runner_ids) ? group.disabled_runner_ids : []);
      if (disabled.has(rid)) {
        disabled.delete(rid);
      } else {
        disabled.add(rid);
      }
      group.disabled_runner_ids = memberRunnerIds.filter((id) => disabled.has(id));
      refreshRunnerGroupDirtyState(gid);
      syncRunnerGroupDirtyButton(gid);
      renderRunners();
      await autoSave({ skipValidation: true });
    });
  });

  wrap.querySelectorAll("[data-move-group-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gid = btn.getAttribute("data-move-group-up");
      if (!moveGroupInLayout(gid, -1)) return;
      renderRunners();
      await autoSave({ skipValidation: true });
    });
  });

  wrap.querySelectorAll("[data-move-group-down]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gid = btn.getAttribute("data-move-group-down");
      if (!moveGroupInLayout(gid, 1)) return;
      renderRunners();
      await autoSave({ skipValidation: true });
    });
  });

  wrap.querySelectorAll("[data-delgroup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gid = btn.getAttribute("data-delgroup");
      const g = findGroupById(gid);
      if (!g) return;
      const name = g.name || gid;
      if (!confirm(t("confirm_delete_group", { name }))) return;
      if (!removeGroupAndUngroupRunners(gid)) return;
      renderRunners();
      const saved = await autoSave({ skipValidation: true });
      if (saved) {
        hulkFlash("success", t("group_removed", { name }), 3200);
        logHulk("success", t("group_removed", { name }));
      }
    });
  });

  wrap.querySelectorAll("[data-move-runner-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-move-runner-up");
      if (!moveRunnerUpInStructure(rid)) return;
      renderRunners();
      await autoSave({ skipValidation: true });
    });
  });

  wrap.querySelectorAll("[data-move-runner-down]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-move-runner-down");
      if (!moveRunnerDownInStructure(rid)) return;
      renderRunners();
      await autoSave({ skipValidation: true });
    });
  });

  wrap.querySelectorAll(`[data-name]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const rid = inp.getAttribute("data-name");
      const r = findRunnerById(rid);
      if (r) r.name = inp.value;
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-command]`).forEach((ta) => {
    ta.addEventListener("input", () => {
      const rid = ta.getAttribute("data-command");
      const r = findRunnerById(rid);
      if (r) r.command = ta.value;
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
      const r = findRunnerById(rid);
      if (!r) return;
      r.logging_enabled = !r.logging_enabled;
      renderRunners();
      await autoSave();
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
      if (!confirm(t("confirm_clear_log"))) return;
      try {
        await apiFetch(`/api/log/${encodeURIComponent(rid)}`, { method: "DELETE" });
        logHulk("success", t("log_cleared_log", { rid }));
        hulkFlash("success", t("log_cleared_flash", { rid }), 3200);
      } catch (e) {
        logHulk("error", t("log_clear_failed", { rid, err: e.message }));
        hulkFlash("error", t("log_clear_failed", { rid, err: e.message }));
      }
    });
  });

  wrap.querySelectorAll(`[data-h],[data-m],[data-s]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-h") || sel.getAttribute("data-m") || sel.getAttribute("data-s");
      const r = findRunnerById(rid);
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
      const r = findRunnerById(rid);
      if (!r) return;
      r.max_runs = Number(sel.value);
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-cooldown]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-cooldown");
      const r = findRunnerById(rid);
      if (!r) return;
      r.alert_cooldown_s = Math.max(0, Number(sel.value || 0));
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-escalate]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-escalate");
      const r = findRunnerById(rid);
      if (!r) return;
      r.alert_escalation_s = Math.max(0, Number(sel.value || 0));
      refreshRunnerDirtyState(rid);
      syncRunnerDirtyButton(rid);
    });
  });

  wrap.querySelectorAll(`[data-failpause]`).forEach((sel) => {
    sel.addEventListener("change", () => {
      const rid = sel.getAttribute("data-failpause");
      const r = findRunnerById(rid);
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
      const r = findRunnerById(rid);
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
      const r = findRunnerById(rid);
      if (!r || !npid) return;
      if (!(r.notify_profile_ids || []).includes(npid)) return;
      const updatesOnly = new Set(r.notify_profile_updates_only || []);
      if (updatesOnly.has(npid)) updatesOnly.delete(npid);
      else updatesOnly.add(npid);
      r.notify_profile_updates_only = Array.from(updatesOnly);
      refreshRunnerDirtyState(rid);
      renderRunners();
      await autoSave();
    });
  });

  wrap.querySelectorAll(`[data-addcase]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-addcase");
      const r = findRunnerById(rid);
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
      const r = findRunnerById(rid);
      const name = r ? r.name : "Runner";
      if (!confirm(t("confirm_delete_runner", { name }))) return;
      state.runners = state.runners.filter((x) => x.id !== rid);
      removeRunnerFromGroups(rid);
      removeRunnerFromLayout(rid);
      normalizeRunnerStructureState();
      delete runtime.status[rid];
      delete runtime.outputs[rid];
      renderRunners();
      const saved = await autoSave();
      if (saved) {
        hulkFlash("success", t("runner_removed", { name }), 3200);
        logHulk("success", t("runner_removed", { name }));
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
          await apiPost("/api/stop", { runner_id: rid });
          hulkFlash("info", t("stop_signal_sent", { rid }), 3000);
          logHulk("info", t("stop_signal_sent", { rid }));
        } else {
          if (!validateStateBeforePersist()) return;
          const r = findRunnerById(rid);
          if (ui.dirtyRunners.has(rid) || isRunnerSaveBlocked(r)) {
            hulkFlash("info", t("run_blocked_edit", { rid }), 4200);
            logHulk("info", t("run_blocked_edit", { rid }));
            syncRunnerRunButton(rid);
            syncRunnerDirtyButton(rid);
            return;
          }
          if (isRunnerCommandMissing(r)) {
            hulkFlash("error", t("run_not_possible_missing_cmd", { rid }));
            logHulk("error", t("run_not_possible_missing_cmd", { rid }));
            syncRunnerRunButton(rid);
            syncRunnerDirtyButton(rid);
            return;
          }
          runtime.outputs[rid] = "";
          const out = runnerOutputEl(rid);
          if (out) out.textContent = "";
          await apiPost("/api/run", { state: collectState(), runner_id: rid });
          hulkFlash("success", t("runner_starting", { rid }), 3200);
          logHulk("success", t("runner_starting", { rid }));
        }
      } catch (e) {
        const msg = e?.message || String(e);
        hulkFlash("error", t("runstop_failed", { rid, err: msg }));
        logHulk("error", t("runstop_failed", { rid, err: msg }));
      }
    });
  });

  wrap.querySelectorAll(`[data-group-runstop]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gid = btn.getAttribute("data-group-runstop");
      const group = findGroupById(gid);
      if (!group) return;
      const name = group.name || gid;
      const groupState = runtime.groupStatus[gid] || {};
      const isActive = isGroupStatusActive(groupState);
      try {
        if (isActive) {
          await apiPost("/api/group/stop", { group_id: gid });
          hulkFlash("info", t("group_stop_sent", { name }), 3200);
          logHulk("info", t("group_stop_sent", { name }));
          return;
        }

        if (!validateStateBeforePersist()) return;
        if (!(group.runner_ids || []).length) {
          hulkFlash("error", t("group_empty"));
          return;
        }
        const activeRunnerIds = activeRunnerIdsForGroup(group);
        if (!activeRunnerIds.length) {
          hulkFlash("error", t("group_no_active_runners"));
          logHulk("error", t("group_no_active_runners"));
          return;
        }
        for (const rid of activeRunnerIds) {
          const r = findRunnerById(rid);
          if (!r) continue;
          if (ui.dirtyRunners.has(rid) || isRunnerSaveBlocked(r)) {
            hulkFlash("info", t("run_blocked_edit", { rid }), 4200);
            logHulk("info", t("run_blocked_edit", { rid }));
            return;
          }
          if (isRunnerCommandMissing(r)) {
            hulkFlash("error", t("run_not_possible_missing_cmd", { rid }));
            logHulk("error", t("run_not_possible_missing_cmd", { rid }));
            return;
          }
        }
        await apiPost("/api/group/run", { state: collectState(), group_id: gid });
        hulkFlash("success", t("group_run_starting", { name }), 3200);
        logHulk("success", t("group_run_starting", { name }));
      } catch (e) {
        const msg = e?.message || String(e);
        if (isActive) {
          hulkFlash("error", t("group_stop_failed", { name, err: msg }));
          logHulk("error", t("group_stop_failed", { name, err: msg }));
        } else {
          hulkFlash("error", t("group_run_failed", { name, err: msg }));
          logHulk("error", t("group_run_failed", { name, err: msg }));
        }
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
        if (!copied) throw new Error(t("clipboard_blocked"));
        const originalText = btn.textContent;
        btn.textContent = t("copied");
        hulkFlash("success", t("output_copied", { rid }), 2600);
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (e) {
        logHulk("error", t("copy_failed", { err: e.message }));
        hulkFlash("error", t("copy_failed", { err: e.message }));
      }
    });
  });

  wrap.querySelectorAll(`[data-clone-runner]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-clone-runner");
      const r = findRunnerById(rid);
      if (!r) return;
      if (hasUnsavedLocalChanges() || !!r._isNew || ui.dirtyRunners.has(rid) || isRunnerSaveBlocked(r)) {
        const msg = t("clone_blocked");
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
        hulkFlash("success", t("runner_cloned", { source: sourceName, target: targetName }), 3600);
        logHulk("success", t("runner_cloned", { source: sourceName, target: targetName }));
      } catch (e) {
        hulkFlash("error", t("clone_failed", { err: e.message }));
        logHulk("error", t("clone_failed", { err: e.message }));
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
    logHulk("error", t("journal_load_failed", { err: e.message }));
  }
}

function updateGlobalRunningStatus() {
  const runningCount = Object.values(runtime.status).filter((s) => s.running).length;
  const scheduledCount = Object.values(runtime.status).filter((s) => s.scheduled && !s.running).length;
  const status = el("runningStatus");
  const spinner = el("globalSpinner");
  const count = el("runningCount");

  const hasActivity = runningCount > 0 || scheduledCount > 0;
  const runningNow = runningCount > 0;
  const displayCount = runningNow ? runningCount : scheduledCount;

  status?.classList.toggle("hidden", !hasActivity);
  status?.classList.toggle("is-active", hasActivity);

  if (hasActivity) {
    spinner?.classList.remove("hidden");
    spinner?.classList.toggle("is-scheduled", !runningNow);
    if (spinner) {
      spinner.textContent = String(displayCount);
      const spinnerLabel = runningNow
        ? `${runningCount} ${t("running_label")}`
        : `${scheduledCount} ${t("scheduled_label")}`;
      spinner.setAttribute("title", spinnerLabel);
      spinner.setAttribute("aria-label", spinnerLabel);
    }
    const parts = [];
    if (runningCount > 0) parts.push(`${runningCount} ${t("running_label")}`);
    if (scheduledCount > 0) parts.push(`${scheduledCount} ${t("scheduled_label")}`);
    if (count) count.textContent = parts.join(" • ");
  } else {
    spinner?.classList.add("hidden");
    spinner?.classList.remove("is-scheduled");
    if (spinner) {
      spinner.textContent = "";
      spinner.removeAttribute("title");
      spinner.removeAttribute("aria-label");
    }
    if (count) count.textContent = "";
  }
}

function hasActiveRunner() {
  return Object.values(runtime.status).some((status) => !!status?.running);
}

function handleBeforeUnload(ev) {
  if (!hasActiveRunner()) return;
  const warning = t("confirm_leave_active_runner");
  ev.preventDefault();
  ev.returnValue = warning;
  return warning;
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
        const next = ev.snapshot || {};
        // Preserve local active timestamps if the backend snapshot doesn't include them
        // (e.g. during a reconnect before we receive the next started event).
        for (const rid of Object.keys(runtime.status || {})) {
          const prev = runtime.status[rid] || {};
          if (!prev.active_ts) continue;
          next[rid] = next[rid] || {};
          if (!next[rid].active_ts) {
            next[rid].active_ts = prev.active_ts;
          }
        }
        runtime.status = next;
        runtime.groupStatus = ev.group_snapshot || {};
        renderRunners();
        tickRunnerElapsed();
        updateGlobalRunningStatus();
        return;
      }

      if (ev.type === "status") {
        const rid = ev.runner_id;
        const prev = runtime.status[rid] || {};
        const wasActive = !!prev.running || !!prev.scheduled;
        runtime.status[rid] = runtime.status[rid] || {};
        if (ev.consecutive_failures !== undefined) {
          runtime.status[rid].consecutive_failures = Number(ev.consecutive_failures || 0);
        }
        if (ev.status === "started") {
          runtime.spinnerStartTimes[rid] = Date.now();
          runtime.status[rid].running = true;
          runtime.status[rid].scheduled = false;
          runtime.status[rid].paused = false;
          const startedTs = ev.ts || new Date().toISOString();
          runtime.status[rid].started_ts = startedTs;
          // Keep an "active since" timestamp across scheduled runs. A manual start (was inactive)
          // resets the active session timestamp.
          if (ev.active_ts) {
            runtime.status[rid].active_ts = ev.active_ts;
          } else if (!wasActive) {
            runtime.status[rid].active_ts = startedTs;
          } else if (!runtime.status[rid].active_ts) {
            runtime.status[rid].active_ts = startedTs;
          }
          if (ev.run_count !== undefined) {
            runtime.status[rid].run_count = ev.run_count;
          }
          if (ev.remaining !== undefined) {
            runtime.status[rid].remaining = ev.remaining;
          }
          logHulk("info", t("run_started", { rid }), ev.ts);
          renderRunners();
          updateGlobalRunningStatus();
        } else if (ev.status === "stopping") {
          logHulk("info", t("run_stopping", { rid }), ev.ts);
        } else if (ev.status === "stopped") {
          logHulk("info", t("run_stopped", { rid }), ev.ts);
          delayedStatusUpdate(rid, () => {
            runtime.status[rid].running = false;
            runtime.status[rid].scheduled = false;
            delete runtime.status[rid].started_ts;
            delete runtime.status[rid].active_ts;
            renderRunners();
            tickRunnerElapsed();
            updateGlobalRunningStatus();
          });
        } else if (ev.status === "scheduled") {
          runtime.status[rid].scheduled = true;
          logHulk("info", t("run_scheduled", { rid, sec: ev.in_s }), ev.ts);
          renderRunners();
          tickRunnerElapsed();
          updateGlobalRunningStatus();
        } else if (ev.status === "paused") {
          runtime.status[rid].running = false;
          runtime.status[rid].scheduled = false;
          runtime.status[rid].paused = true;
          delete runtime.status[rid].started_ts;
          delete runtime.status[rid].active_ts;
          runtime.status[rid].consecutive_failures = Number(ev.consecutive_failures || runtime.status[rid].consecutive_failures || 0);
          const msg = t("auto_pause_msg", { rid, n: runtime.status[rid].consecutive_failures });
          logHulk("error", msg, ev.ts);
          hulkFlash("error", msg, 5200);
          renderRunners();
          tickRunnerElapsed();
          updateGlobalRunningStatus();
        } else if (ev.status === "finished") {
          const kind = ev.stopped ? "info" : (Number(ev.exit_code) === 0 ? "success" : "error");
          logHulk(kind, t("run_finished", { rid, code: ev.exit_code, stopped: ev.stopped }), ev.ts);
          if (!ev.stopped && Number(ev.exit_code) !== 0) {
            hulkFlash("error", t("run_finished_error", { rid, code: ev.exit_code }));
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

      if (ev.type === "group_status") {
        const gid = ev.group_id;
        if (!gid) return;
        runtime.groupStatus[gid] = ev;
        const name = ev.group_name || gid;
        if (ev.status === "started") {
          logHulk("info", t("group_event_started", { name }), ev.ts);
        } else if (ev.status === "stopped") {
          logHulk("info", t("group_event_stopped", { name }), ev.ts);
        } else if (ev.status === "finished") {
          logHulk("success", t("group_event_finished", { name }), ev.ts);
        } else if (ev.status === "error") {
          const msg = t("group_event_error", { name, err: ev.error || "unknown" });
          logHulk("error", msg, ev.ts);
          hulkFlash("error", msg, 5200);
        }
        renderRunners();
        tickRunnerElapsed();
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
        const label = ev.profile_name || np?.name || npid || t("service_fallback");
        const failCount = Math.max(3, Number(ev.failure_count || 3));
        const reason = (ev.reason || "").trim();
        const baseMsg = t("notify_auto_disabled_base", { label, fail: failCount });
        const msg = reason ? `${baseMsg}${t("notify_auto_disabled_reason_suffix", { reason })}` : baseMsg;
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
    hulkFlash("error", t("event_stream_unstable"), 4500);
    logHulk("error", t("event_stream_unstable_log"));
  };
}

async function autoSave(options = {}) {
  const skipValidation = !!options.skipValidation;
  if (!skipValidation && !validateStateBeforePersist()) return false;
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
    syncSavedRunnerGroupSignatures();
    clearAllDirtyNotifyProfiles();
    clearAllDirtyRunners();
    clearAllDirtyRunnerGroups();
    syncAllNotifyDirtyButtons();
    syncAllDirtyButtons();
    syncAllRunnerGroupDirtyButtons();
    logHulk("success", t("autosave_ok"));
    return true;
  } catch (e) {
    logHulk("error", t("save_failed_log", { err: e.message }));
    hulkFlash("error", t("save_failed_flash", { err: e.message }));
    return false;
  }
}

async function wireUI() {
  const openInfoTitle = el("openInfoTitle");
  const closeInfoBtn = el("closeInfoBtn");
  const infoModal = el("infoModal");

  el("langToggleBtn")?.addEventListener("click", () => {
    setLanguage(nextLang(currentLang()));
  });

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

  el("notifyJournalSectionToggle")?.addEventListener("click", () => {
    ui.notifyJournalSectionCollapsed = !ui.notifyJournalSectionCollapsed;
    saveUIState();
    renderNotifyJournalSection();
  });

  el("eventsSectionToggle")?.addEventListener("click", () => {
    ui.eventsSectionCollapsed = !ui.eventsSectionCollapsed;
    saveUIState();
    renderEventsSection();
  });

  el("sortNotifyBtn")?.addEventListener("click", () => {
    ui.notifySortMode = !ui.notifySortMode;
    saveUIState();
    syncSortModeButtons();
    renderNotifyProfiles();
    hulkFlash("info", t("notify_sort_mode", { state: ui.notifySortMode ? t("sort_mode_on_upper") : t("sort_mode_off_upper") }), 2200);
  });

  el("sortRunnerBtn")?.addEventListener("click", () => {
    ui.runnerSortMode = !ui.runnerSortMode;
    saveUIState();
    syncSortModeButtons();
    renderRunners();
    hulkFlash("info", t("runner_sort_mode", { state: ui.runnerSortMode ? t("sort_mode_on_upper") : t("sort_mode_off_upper") }), 2200);
  });

  el("clearNotifyJournalBtn")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/notifications", { method: "DELETE" });
      ui.notifyJournalEntries = [];
      renderNotifyJournal();
      hulkFlash("success", t("journal_cleared"), 2600);
      logHulk("success", t("journal_cleared"));
    } catch (e) {
      hulkFlash("error", t("journal_clear_failed", { err: e.message }));
      logHulk("error", t("journal_clear_failed", { err: e.message }));
    }
  });

  el("clearEventsBtn")?.addEventListener("click", () => {
    const out = el("events");
    if (out) out.textContent = "";
    hulkFlash("success", t("events_cleared"), 2200);
  });

  el("addNotifyBtn").addEventListener("click", () => {
    ui.notifySectionCollapsed = false;
    saveUIState();
    state.notify_profiles.push({
      id: `notify_${uuidFallback()}`,
      name: t("new_notify_default_name"),
      type: "pushover",
      active: true,
      failure_count: 0,
      sent_count: 0,
      config: { user_key: "", api_token: "" },
      _collapsed: false,
      _isNew: true,
    });
    renderNotifyProfiles();
    hulkFlash("info", t("new_notify_created"), 4500);
  });

  el("addGroupBtn")?.addEventListener("click", async () => {
    ui.runnerSectionCollapsed = false;
    saveUIState();
    const gid = `group_${uuidFallback()}`;
    state.runner_groups.push({
      id: gid,
      name: t("new_group_default_name"),
      runner_ids: [],
      disabled_runner_ids: [],
      _collapsed: false,
    });
    state.runner_layout.push({ type: "group", id: gid });
    normalizeRunnerStructureState();
    renderRunners();
    const saved = await autoSave({ skipValidation: true });
    if (saved) {
      hulkFlash("success", t("new_group_created"), 3200);
      logHulk("success", t("new_group_created"));
    }
  });

  el("addRunnerBtn").addEventListener("click", async () => {
    ui.runnerSectionCollapsed = false;
    saveUIState();
    const rid = `runner_${uuidFallback()}`;
    state.runners.push({
      id: rid,
      name: t("new_runner_default_name"),
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
    state.runner_layout.push({ type: "runner", id: rid });
    normalizeRunnerStructureState();
    renderRunners();
    const saved = await autoSave({ skipValidation: true });
    if (saved) {
      hulkFlash("success", t("new_runner_created"), 3200);
      logHulk("success", t("new_runner_created_log", { rid }));
    }
  });

  el("exportBtn").addEventListener("click", async () => {
    logHulk("info", t("export_starting"));
    hulkFlash("info", t("export_starting"), 2800);
    try {
      const a = document.createElement("a");
      a.href = apiUrl("/api/export");
      a.download = `multi-command-runner-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logHulk("success", t("export_started_log"));
      hulkFlash("success", t("export_started_flash"), 3800);
    } catch (e) {
      logHulk("error", t("export_failed", { err: e.message }));
      hulkFlash("error", t("export_failed", { err: e.message }));
    }
  });

  el("importBtn").addEventListener("click", () => {
    el("importFile").click();
  });

  el("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logHulk("info", t("import_running", { name: file.name }));
    hulkFlash("info", t("import_running", { name: file.name }), 2800);
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
      logHulk("success", t("import_ok", { count: result.imported_count }));
      hulkFlash("success", t("import_ok", { count: result.imported_count }), 4200);

      // Reload state from server
      const st = await apiGet("/api/state");
      setFromState(st);
    } catch (e) {
      logHulk("error", t("import_failed", { err: e.message }));
      hulkFlash("error", t("import_failed", { err: e.message }));
    } finally {
      e.target.value = "";
    }
  });

}

(async function main() {
  try {
    window.addEventListener("beforeunload", handleBeforeUnload);
    applyLanguageToStaticDom();
    renderNotifyJournalSection();
    renderEventsSection();
    const st = await apiGet("/api/state");
    setFromState(st);
    await loadNotifyJournal();
    startEvents();
    startRunnerElapsedTicker();
    await wireUI();
    hulkFlash("success", t("system_ready"), 2800);
    logHulk("success", t("system_ready_log"));
  } catch (e) {
    const msg = e?.message || String(e);
    hulkFlash("error", t("start_failed", { err: msg }));
    logHulk("error", t("start_failed", { err: msg }));
    console.error(e);
  }
})();
