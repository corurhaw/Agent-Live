"""Encrypted restart continuity, rollback pins and bounded incident handling."""
from dataclasses import asdict
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from cryptography.fernet import Fernet

from persistent_agent.layers import BoundaryError, Eye, LayerSupervisor
from persistent_agent.layer_store import load_supervisor, save_supervisor


class LayerStoreTests(unittest.TestCase):
    def test_restart_preserves_identity_lockout_and_replay_state(self):
        host = LayerSupervisor(clock=lambda: 1000)
        agent = host.create_agent()
        host.grant(agent.agent_id, "store", "read")
        host.register_resource("store", "read", lambda _: "ok")
        action = host.prepare_action(agent.agent_id, "store", "read", None)
        host.dispatch(action)
        locked = host.create_agent()
        host.revoke(locked.agent_id, reason="Keep quarantined across restart")
        unit = tuple(host.create_agent(roles=("security",),
                                       senses=(Eye("eye", "vision", 5),)) for _ in range(3))
        security = unit[0]
        doctor = host.create_agent(roles=("doctor",))
        host.link(security.agent_id, locked.agent_id, "vision", distance=1)
        report = host.encounter(security.agent_id, locked.agent_id, "eye", behavior="idle")
        case = host.start_investigation(report.encounter_id, tuple(m.agent_id for m in unit))
        for member in unit[:2]:
            host.vote_investigation(case.investigation_id, member.agent_id,
                                    action="request_doctor", parameters=dict(
                                        reason="Inspect quarantined agent", evidence_ref="case/1"))
        referral = host.proceed_investigation(case.investigation_id, security.agent_id)
        key = Fernet.generate_key()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "supervisor.enc"
            pin = save_supervisor(host, path, key)
            self.assertNotIn(agent.agent_id.encode(), path.read_bytes())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            restored = load_supervisor(path, key, clock=lambda: 1000, expected_checkpoint=pin)
            self.assertEqual(restored.node(agent.agent_id), agent)
            self.assertTrue(restored.check_integrity(agent.agent_id))
            self.assertFalse(restored.check_integrity(locked.agent_id))
            self.assertEqual(restored.doctor_requests(), (referral,))
            restored.acknowledge_doctor_request(doctor.agent_id, referral.request_id)
            self.assertEqual(restored.doctor_requests(), ())
            restored.register_resource("store", "read", lambda _: "ok")
            with self.assertRaises(BoundaryError):
                restored.dispatch(action)
            # A second Python process verifies continuity using host-supplied secret
            # over stdin; the encryption key never appears in process arguments.
            code = '''import json, sys
from persistent_agent.layer_store import load_supervisor
p = json.load(sys.stdin)
h = load_supervisor(p["path"], p["key"].encode(), clock=lambda:1000,
                    expected_checkpoint=p["pin"])
print(h.node(p["agent"]).fingerprint)
'''
            result = subprocess.run([sys.executable, "-c", code], input=json.dumps(dict(
                path=str(path), key=key.decode(), pin=pin, agent=agent.agent_id)),
                text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), agent.fingerprint)

    def test_wrong_key_corruption_and_rollback_are_rejected(self):
        host, key = LayerSupervisor(), Fernet.generate_key()
        host.create_agent()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "supervisor.enc"
            save_supervisor(host, path, key)
            older = path.read_bytes()
            host.create_agent()
            current_pin = save_supervisor(host, path, key)
            with self.assertRaises(BoundaryError):
                load_supervisor(path, Fernet.generate_key())
            path.write_bytes(older)
            with self.assertRaises(BoundaryError):
                load_supervisor(path, key, expected_checkpoint=current_pin)
            path.write_bytes(older[:-5] + b"XXXXX")
            with self.assertRaises(BoundaryError):
                load_supervisor(path, key)

    def test_audit_drains_only_after_success_and_chain_continues(self):
        host = LayerSupervisor(max_events=1)
        agent = host.create_agent()
        first = host.events()
        def failed_sink(events):
            raise OSError("storage unavailable")
        with self.assertRaises(OSError):
            host.archive_events(failed_sink)
        self.assertEqual(host.events(), first)
        saved = []
        host.archive_events(saved.extend)
        host.revoke(agent.agent_id, reason="Test chain across archive")
        next_event = json.loads(host.events()[0].body)
        self.assertEqual(next_event["previous"], first[0].digest)
        self.assertEqual(next_event["sequence"], 1)

    def test_threat_preserves_emergency_evidence_and_isolates_when_queues_are_full(self):
        host = LayerSupervisor(max_events=2)
        a = host.create_agent(eyes=(Eye("eye", "environment", 1),))
        b = host.create_agent(capabilities=("walk",))
        host.link(a.agent_id, b.agent_id, "environment", distance=1)
        encounter = host.encounter(a.agent_id, b.agent_id, "eye", behavior="walk",
                                   threat="observed hostile request", defense="isolate")
        self.assertFalse(host.check_integrity(a.agent_id))
        self.assertEqual(host.emergency_observations(), (encounter,))
        self.assertEqual(host.pending_reports()[0].encounter_id, encounter.encounter_id)
        self.assertTrue(host.verify_observation(encounter))
        key = Fernet.generate_key()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "supervisor.enc"
            pin = save_supervisor(host, path, key)
            restored = load_supervisor(path, key, expected_checkpoint=pin)
            self.assertEqual(restored.emergency_observations(), (encounter,))
            self.assertFalse(restored.check_integrity(a.agent_id))


if __name__ == "__main__":
    unittest.main()
