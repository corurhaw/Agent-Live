"""Exercise provision, restart persistence and failed writes through the CLI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).parent


class SandboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "state"

    def run_sandbox(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "scripts/sandbox.py"),
                               "--state-dir", str(self.state), *args],
                              text=True, capture_output=True)

    def saved(self):
        return json.loads((self.state / "identity.json").read_text())

    def test_provision_and_resume_across_processes(self):
        result = self.run_sandbox("init")
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.saved()
        template = json.loads((ROOT / "examples/agent-identity.example.json").read_text())
        self.assertNotEqual(before["agent_identity"]["agent_id"],
                            template["agent_identity"]["agent_id"])
        result = self.run_sandbox("remember", "Persist this experiment across restart.")
        self.assertEqual(result.returncode, 0, result.stderr)
        after = self.saved()["agent_identity"]
        self.assertEqual(after["agent_id"], before["agent_identity"]["agent_id"])
        self.assertEqual(after["integrity"]["previous_state_hash"],
                         before["agent_identity"]["integrity"]["state_hash"])
        self.assertEqual(after["autobiographical_memory"]["event_log"][-1]["summary"],
                         "Persist this experiment across restart.")
        backups = list((self.state / "snapshots").glob("*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), before)
        result = self.run_sandbox("init", "--name", "Do not replace existing state")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.saved()["agent_identity"], after)
        result = self.run_sandbox("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["event_count"], 2)

    def test_invalid_edit_preserves_state_and_refuses_future_changes(self):
        self.assertEqual(self.run_sandbox("init").returncode, 0)
        path = self.state / "identity.json"
        before = path.read_bytes()
        self.assertEqual(self.run_sandbox("remember", " ").returncode, 1)
        self.assertEqual(path.read_bytes(), before)
        data = self.saved()
        data["agent_identity"]["display_name"] = "Unauthorized edit with stale hash"
        path.write_text(json.dumps(data))
        modified = path.read_bytes()
        self.assertEqual(self.run_sandbox("remember", "Must fail").returncode, 1)
        self.assertEqual(path.read_bytes(), modified)

    def test_export_does_not_overwrite_and_independent_ids(self):
        self.assertEqual(self.run_sandbox("init").returncode, 0)
        first = self.saved()["agent_identity"]["agent_id"]
        output = Path(self.temp.name) / "export.json"
        result = self.run_sandbox("export", str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.read_text()), self.saved())
        before = output.read_bytes()
        self.assertEqual(self.run_sandbox("export", str(output)).returncode, 1)
        self.assertEqual(output.read_bytes(), before)
        self.state = Path(self.temp.name) / "other-state"
        self.assertEqual(self.run_sandbox("init").returncode, 0)
        self.assertNotEqual(self.saved()["agent_identity"]["agent_id"], first)


if __name__ == "__main__":
    unittest.main()
