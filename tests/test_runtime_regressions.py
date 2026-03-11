import importlib
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path


def load_main_module():
    temp_dir = tempfile.TemporaryDirectory()
    os.environ["DATA_DIR"] = temp_dir.name
    sys.modules.pop("app.main", None)
    module = importlib.import_module("app.main")
    return temp_dir, module


class FakeNotifier:
    def enqueue(self, **kwargs):
        return None


class FakeTimer:
    def __init__(self):
        self.cancelled = False

    def cancel(self):
        self.cancelled = True


class RecordingRunnerManager:
    def __init__(self):
        self.started = []
        self.status_calls = 0

    def snapshot(self):
        return {}

    def start(self, cfg, reset_schedule=True):
        self.started.append((cfg, reset_schedule))

    def stop(self, runner_id):
        return None

    def get_runner_status(self, runner_id):
        self.status_calls += 1
        return {"running": False, "scheduled": False, "last_exit_code": 0, "stopped": False, "paused": False}


class RuntimeRegressionTests(unittest.TestCase):
    def test_refresh_runtime_configs_removes_deleted_runner_state(self):
        temp_dir, module = load_main_module()
        self.addCleanup(temp_dir.cleanup)

        manager = module.RunnerManager(module.EventBroker(), FakeNotifier())
        timer = FakeTimer()
        runner_id = "runner_deadbeef"
        manager._cfg[runner_id] = module.RunnerRuntimeConfig(
            runner_id=runner_id,
            runner_name="Deleted runner",
            command="echo test",
            logging_enabled=True,
            interval_s=60,
            max_runs=2,
            alert_cooldown_s=0,
            alert_escalation_s=0,
            failure_pause_threshold=0,
            send_last_line_on_finish=False,
            cases=[],
            notify_targets=[],
        )
        manager._timers[runner_id] = timer
        manager._remaining[runner_id] = 1
        manager._run_count[runner_id] = 4
        manager._last_case[runner_id] = "OLD"
        manager._last_case_ts[runner_id] = "2026-03-11T12:00:00+00:00"
        manager._paused_due_failures[runner_id] = True

        empty_state = module.AppState()
        manager.refresh_runtime_configs(empty_state)

        self.assertNotIn(runner_id, manager._cfg)
        self.assertNotIn(runner_id, manager._timers)
        self.assertNotIn(runner_id, manager._remaining)
        self.assertNotIn(runner_id, manager._run_count)
        self.assertNotIn(runner_id, manager._last_case)
        self.assertNotIn(runner_id, manager._last_case_ts)
        self.assertNotIn(runner_id, manager._paused_due_failures)
        self.assertTrue(timer.cancelled)

    def test_group_run_starts_scheduled_runner_as_one_shot(self):
        temp_dir, module = load_main_module()
        self.addCleanup(temp_dir.cleanup)

        runner_manager = RecordingRunnerManager()
        gsm = module.GroupSequenceManager(runner_manager, module.EventBroker())

        state = module.AppState(
            runners=[
                module.RunnerConfig(
                    id="runner_123456",
                    name="Scheduled runner",
                    command="echo ok",
                    schedule=module.ScheduleConfig(seconds=30),
                    max_runs=-1,
                )
            ],
            runner_groups=[
                module.RunnerGroupConfig(
                    id="group_123456",
                    name="Group",
                    runner_ids=["runner_123456"],
                    disabled_runner_ids=[],
                )
            ],
        )
        run = module.GroupSequenceRuntime(
            group_id="group_123456",
            group_name="Group",
            runner_ids=["runner_123456"],
            started_ts="2026-03-11T12:00:00+00:00",
            stop_event=threading.Event(),
        )

        gsm._run_group(run, state)

        self.assertEqual(len(runner_manager.started), 1)
        cfg, reset_schedule = runner_manager.started[0]
        self.assertTrue(reset_schedule)
        self.assertEqual(cfg.interval_s, 0)
        self.assertEqual(cfg.max_runs, 1)


if __name__ == "__main__":
    unittest.main()
