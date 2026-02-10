# command-runner

This revision:
- No Pushover trigger if token/user key are not both set (no error).
- Stop works for scheduled runners too (cancels timer; stop button enabled when scheduled).
- Per-runner log file (data/run_<runner_id>.log) and UI link to open it.
