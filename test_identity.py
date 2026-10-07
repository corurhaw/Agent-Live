"""Regression checks for persistent identity validation and file storage."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / "src"))
from persistent_agent import IdentityRecord, IdentityValidationError

ROOT = Path(__file__).parent


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.record = IdentityRecord.load(ROOT / "examples/agent-identity.example.json")

    def test_original_hash_is_compatible(self):
        self.assertEqual(self.record.state_hash(),
                         "sha256:1513a95e1273ebefb523aa2beb5bb1f78688fdef13276a28b3e3c0b34d3504eb")

    def test_required_fields(self):
        data = deepcopy(self.record.data)
        del data["agent_identity"]["relationships"]
        with self.assertRaises(IdentityValidationError):
            IdentityRecord(data).validate_core_invariants()

    def test_malformed_records(self):
        cases = [None, [], {}, {"schema_version": "1.1", "agent_identity": []}]
        for data in cases:
            with self.subTest(data=data), self.assertRaises(IdentityValidationError):
                IdentityRecord(data).validate_core_invariants()

    def test_lineage(self):
        for change in [
            {"generation": True},
            {"generation": 1, "parent_agent_id": None},
            {"generation": 1, "parent_agent_id": "not-a-uuid"},
            {"generation": 1, "parent_agent_id": self.record.data["agent_identity"]["agent_id"]},
            {"generation": 0, "parent_agent_id": "28338b91-039e-4668-acdb-9cb55982baf1"},
        ]:
            data = deepcopy(self.record.data)
            data["agent_identity"]["lineage"].update(change)
            with self.subTest(change=change), self.assertRaises(IdentityValidationError):
                IdentityRecord(data).validate_core_invariants()

    def test_valid_fork(self):
        data = deepcopy(self.record.data)
        data["agent_identity"]["lineage"].update(
            generation=1, parent_agent_id="28338b91-039e-4668-acdb-9cb55982baf1")
        IdentityRecord(data).validate_core_invariants()

    def test_uuid_and_timestamp_formats(self):
        for field, value in [("agent_id", "uuid"), ("created_at", "yesterday")]:
            data = deepcopy(self.record.data)
            data["agent_identity"][field] = value
            with self.subTest(field=field), self.assertRaises(IdentityValidationError):
                IdentityRecord(data).validate_core_invariants()

    def test_stale_hash_and_explicit_rehash(self):
        data = deepcopy(self.record.with_state_hash().data)
        data["agent_identity"]["display_name"] = "Changed identity"
        data["agent_identity"]["integrity"].update(
            signature="old signature", signed_at="2026-10-04T17:00:00Z")
        with self.assertRaises(IdentityValidationError):
            IdentityRecord(data).validate_core_invariants()
        updated = IdentityRecord(data).with_state_hash()
        updated.validate_core_invariants()
        self.assertIsNone(updated.data["agent_identity"]["integrity"]["signature"])
        self.assertIsNone(updated.data["agent_identity"]["integrity"]["signed_at"])
        self.assertNotEqual(updated.state_hash(), self.record.state_hash())

    def test_duplicate_events(self):
        data = deepcopy(self.record.data)
        events = data["agent_identity"]["autobiographical_memory"]["event_log"]
        events.append(deepcopy(events[0]))
        with self.assertRaises(IdentityValidationError):
            IdentityRecord(data).validate_core_invariants()

    def test_nonfinite_values(self):
        data = deepcopy(self.record.data)
        data["agent_identity"]["self_model"]["preferences"]["bad"] = float("nan")
        with self.assertRaises(IdentityValidationError):
            IdentityRecord(data).validate_core_invariants()

    def test_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text('{"schema_version":"1.1","schema_version":"2"}')
            with self.assertRaises(IdentityValidationError):
                IdentityRecord.load(path)

    def test_persistent_roundtrip(self):
        record = self.record.with_state_hash()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            record.dump(path)
            loaded = IdentityRecord.load(path)
            self.assertEqual(record.data, loaded.data)
            self.assertEqual(record.state_hash(), loaded.state_hash())

    def test_failed_save_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            self.record.dump(path)
            before = path.read_bytes()
            with patch("persistent_agent.model.os.replace", side_effect=OSError("disk failure")):
                with self.assertRaises(OSError):
                    self.record.with_state_hash().dump(path)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual([p.name for p in Path(folder).iterdir()], ["identity.json"])

    def test_invalid_save_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            self.record.dump(path)
            before = path.read_bytes()
            bad = deepcopy(self.record.data)
            bad["agent_identity"]["status"] = "unknown"
            with self.assertRaises(IdentityValidationError):
                IdentityRecord(bad).dump(path)
            self.assertEqual(path.read_bytes(), before)

    def test_schema_copies_match(self):
        self.assertEqual(
            (ROOT / "schema/persistent-agent.schema.json").read_bytes(),
            (ROOT / "src/persistent_agent/persistent-agent.schema.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
