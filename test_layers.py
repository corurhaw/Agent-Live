"""Behavioral checks for trusted layer mediation and encounter evidence."""
from dataclasses import replace
import json
import subprocess
import sys
import unittest

from persistent_agent.layers import BoundaryError, Eye, LayerSupervisor, Sense


class LayerTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.host = LayerSupervisor(clock=lambda: self.now, max_events=100)
        self.eye = Eye("forward", "environment", 10.0)
        self.a = self.host.create_agent(eyes=(self.eye,), capabilities=("hop",))
        self.child = self.host.create_agent(parent_id=self.a.agent_id)
        self.b = self.host.create_agent(capabilities=("walk",))
        self.host.certify(self.a.agent_id)
        self.host.certify(self.b.agent_id)

    def test_creation_issues_unique_identity_before_return(self):
        self.assertNotEqual(self.a.fingerprint, self.child.fingerprint)
        self.assertEqual(self.host.certificate(self.child.agent_id).subject_id,
                         self.child.agent_id)
        self.assertTrue(self.host.check_integrity(self.a.agent_id))

    def test_arbitrary_eye_counts_and_nonhuman_capabilities_are_valid(self):
        for count in (0, 1, 2, 4, 6, 9):
            agent = self.host.create_agent(
                eyes=tuple(Eye(str(i), "custom", 2) for i in range(count)),
                capabilities=("roll",))
            self.assertEqual(len(agent.eyes), count)
            self.assertTrue(self.host.check_integrity(agent.agent_id))

    def test_all_descendants_are_certified_and_ancestor_invalidates_on_birth(self):
        before = self.host.certificate(self.a.agent_id)
        grandchild = self.host.create_agent(parent_id=self.child.agent_id)
        self.assertFalse(self.host.check_integrity(self.a.agent_id))
        self.assertTrue(self.host.check_integrity(grandchild.agent_id))
        corrected = self.host.recover(self.a.agent_id, reason="Authorized new child",
                                      evidence_ref="inspection/1")
        members = json.loads(corrected.manifest)
        self.assertEqual({m["agent_id"] for m in members},
                         {self.a.agent_id, self.child.agent_id, grandchild.agent_id})
        self.assertNotEqual(before.serial, corrected.serial)

    def test_parent_and_child_sign_bound_action_and_cannot_replay(self):
        self.host.grant(self.a.agent_id, "shared-store", "write")
        self.host.register_resource("shared-store", "write", lambda value: value + 1)
        action = self.host.prepare_action(self.child.agent_id, "shared-store", "write", 5)
        self.assertEqual({x.agent_id for x in action.signatures},
                         {self.a.agent_id, self.child.agent_id})
        self.assertEqual(self.host.dispatch(action), 6)
        with self.assertRaises(BoundaryError):
            self.host.dispatch(action)
        fresh = self.host.prepare_action(self.child.agent_id, "shared-store", "write", 5)
        with self.assertRaises(BoundaryError):
            self.host.dispatch(replace(fresh, payload="6"))
        with self.assertRaises(BoundaryError):
            self.host.dispatch(replace(fresh, signatures=fresh.signatures[:1]))

    def test_revocation_lockout_and_reviewed_recovery(self):
        self.host.grant(self.a.agent_id, "store", "read")
        self.host.register_resource("store", "read", lambda value: "ok")
        pending = self.host.prepare_action(self.child.agent_id, "store", "read", None)
        self.host.revoke(self.a.agent_id, reason="Investigate")
        with self.assertRaises(BoundaryError):
            self.host.dispatch(pending)
        with self.assertRaises(BoundaryError):
            self.host.recover(self.a.agent_id, reason="", evidence_ref="")
        self.host.recover(self.a.agent_id, reason="Inspected composition",
                          evidence_ref="inspection/2")
        with self.assertRaises(BoundaryError):
            self.host.dispatch(pending)
        fresh = self.host.prepare_action(self.child.agent_id, "store", "read", None)
        self.assertEqual(self.host.dispatch(fresh), "ok")

    def test_missing_child_locks_parent_and_cannot_be_recaptured_by_certify(self):
        self.host.set_present(self.child.agent_id, False)
        self.assertFalse(self.host.check_integrity(self.a.agent_id))
        with self.assertRaises(BoundaryError):
            self.host.certify(self.a.agent_id)
        with self.assertRaises(BoundaryError):
            self.host.recover(self.a.agent_id, reason="Still missing",
                              evidence_ref="inspection/3")
        self.host.set_present(self.child.agent_id, True)
        self.assertFalse(self.host.check_integrity(self.a.agent_id))
        self.host.recover(self.child.agent_id, reason="Child presence verified",
                          evidence_ref="inspection/4-child")
        self.host.recover(self.a.agent_id, reason="Child located and checked",
                          evidence_ref="inspection/4")
        self.assertTrue(self.host.check_integrity(self.a.agent_id))

    def test_only_visible_neighbors_can_be_observed(self):
        with self.assertRaises(BoundaryError):
            self.host.encounter(self.a.agent_id, self.b.agent_id, "forward", behavior="walk")
        self.host.link(self.a.agent_id, self.b.agent_id, "environment", distance=11)
        with self.assertRaises(BoundaryError):
            self.host.encounter(self.a.agent_id, self.b.agent_id, "forward", behavior="walk")
        self.host.link(self.a.agent_id, self.b.agent_id, "environment", distance=2)
        observation = self.host.encounter(self.a.agent_id, self.b.agent_id, "forward",
                                          behavior="walk")
        self.assertEqual(observation.findings, ())
        self.assertNotIn("memory", observation.body)

    def test_encounter_snapshot_and_report_are_signed_and_not_retroactive(self):
        self.host.link(self.a.agent_id, self.b.agent_id, "environment", distance=1)
        observation = self.host.encounter(self.a.agent_id, self.b.agent_id, "forward",
                                          behavior="fly")
        self.assertIn("behavior_not_in_certified_capabilities", observation.findings)
        original = observation.body
        self.assertTrue(self.host.verify_observation(observation))
        self.assertFalse(self.host.verify_observation(replace(observation, body="{}")))
        self.host.revoke(self.b.agent_id, reason="Follow-up investigation")
        self.now += 5
        report = self.host.pending_reports()[0]
        self.assertEqual(report.encounter_id, observation.encounter_id)
        self.assertEqual(report.observed_at, 1000)
        self.assertEqual(observation.body, original)
        self.assertEqual(report.reported_at, 1000)

    def test_danger_allows_only_self_protection_and_reports_immediately(self):
        self.host.link(self.a.agent_id, self.b.agent_id, "environment", distance=1)
        observation = self.host.encounter(self.a.agent_id, self.b.agent_id, "forward",
                                          behavior="walk", threat="hostile access attempt",
                                          defense="isolate")
        self.assertEqual(self.host.pending_reports()[0].encounter_id,
                         observation.encounter_id)
        self.assertFalse(self.host.check_integrity(self.a.agent_id))
        self.assertTrue(self.host.check_integrity(self.b.agent_id))
        self.host.recover(self.a.agent_id, reason="Threat contained",
                          evidence_ref="incident/5")
        self.assertTrue(self.host.check_integrity(self.a.agent_id))

    def test_expiry_and_permission_denial(self):
        with self.assertRaises(BoundaryError):
            self.host.prepare_action(self.child.agent_id, "unknown", "write", {})
        self.now += 400
        self.assertFalse(self.host.check_integrity(self.a.agent_id))

    def test_replacement_preserves_distinct_identity_and_requires_review(self):
        doctor = self.host.create_agent(roles=("doctor",))
        original = self.host.certificate(self.a.agent_id)
        self.host.set_present(self.child.agent_id, False)
        replacement = self.host.create_agent()
        with self.assertRaises(BoundaryError):
            self.host.replace_child(self.a.agent_id, self.child.agent_id,
                                    replacement.agent_id, doctor_id=doctor.agent_id,
                                    reason="", evidence_ref="")
        self.host.replace_child(self.a.agent_id, self.child.agent_id,
                                replacement.agent_id, doctor_id=doctor.agent_id,
                                reason="Replace failed component",
                                evidence_ref="inspection/6")
        self.assertFalse(self.host.check_integrity(self.a.agent_id))
        self.assertFalse(self.host.check_integrity(self.child.agent_id))
        self.host.recover(replacement.agent_id, reason="Replacement checked",
                          evidence_ref="inspection/6-new")
        cert = self.host.recover(self.a.agent_id, reason="Composition checked",
                                 evidence_ref="inspection/6-parent")
        self.assertFalse(self.host.verify_certificate(original))
        members = {m["agent_id"] for m in json.loads(cert.manifest)}
        self.assertIn(replacement.agent_id, members)
        self.assertNotIn(self.child.agent_id, members)
        self.assertNotEqual(self.child.fingerprint, replacement.fingerprint)

    def test_multiple_eye_modalities_and_weights(self):
        agent = self.host.create_agent(eyes=tuple(
            Eye(mode, mode, 5) for mode in ("environment", "hardware", "interaction", "custom")))
        for mode in ("environment", "hardware", "interaction", "custom"):
            self.host.link(agent.agent_id, self.b.agent_id, mode, distance=3)
            seen = self.host.encounter(agent.agent_id, self.b.agent_id, mode, behavior="walk")
            self.assertEqual(json.loads(seen.body)["sense"]["modality"], mode)

    def test_forged_certificate_and_permission_withdrawal(self):
        cert = self.host.certificate(self.a.agent_id)
        self.assertFalse(self.host.verify_certificate(replace(cert, manifest="[]")))
        self.assertFalse(self.host.verify_certificate(replace(cert, signature="00")))
        self.host.grant(self.a.agent_id, "store", "read")
        self.host.register_resource("store", "read", lambda value: "ok")
        pending = self.host.prepare_action(self.child.agent_id, "store", "read", None)
        self.host.withdraw_grant(self.a.agent_id, "store", "read")
        with self.assertRaises(BoundaryError):
            self.host.dispatch(pending)

    def test_resource_exhaustion_fails_closed_without_silent_log_eviction(self):
        host = LayerSupervisor(clock=lambda: 1000, max_events=3)
        a = host.create_agent()
        host.grant(a.agent_id, "store", "write")
        calls = []
        host.register_resource("store", "write", calls.append)
        action = host.prepare_action(a.agent_id, "store", "write", 1)
        self.assertEqual(len(host.events()), 3)
        with self.assertRaises(BoundaryError):
            host.dispatch(action)
        self.assertEqual(calls, [])
        self.assertEqual(len(host.events()), 3)

    def test_installed_cli_exercises_the_boundary(self):
        result = subprocess.run([sys.executable, "-m", "persistent_agent", "layers-demo"],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertTrue(output["isolated_action_blocked"])
        self.assertTrue(output["recovered"])
        self.assertTrue(output["signed_observation_verified"])
        self.assertTrue(output["security_replacement_denied"])
        self.assertTrue(output["doctor_replacement_completed"])
        self.assertEqual(output["received"], ["Hello workspace"])

    def test_security_can_call_doctor_but_cannot_replace_child(self):
        security = self.host.create_agent(roles=("security",))
        doctor = self.host.create_agent(roles=("doctor",))
        replacement = self.host.create_agent()
        request = self.host.call_doctor(security.agent_id, self.a.agent_id,
                                        reason="Missing child", evidence_ref="encounter/7")
        self.assertEqual(self.host.doctor_requests(), (request,))
        for unauthorized in (security, self.b):
            with self.assertRaises(BoundaryError):
                self.host.replace_child(self.a.agent_id, self.child.agent_id,
                                        replacement.agent_id, doctor_id=unauthorized.agent_id,
                                        reason="Replace", evidence_ref="inspection/7")
        with self.assertRaises(BoundaryError):
            self.host.call_doctor(self.b.agent_id, self.a.agent_id,
                                  reason="Call", evidence_ref="encounter/8")
        self.host.acknowledge_doctor_request(doctor.agent_id, request.request_id)
        self.assertEqual(self.host.doctor_requests(), ())

    def test_senses_are_general_and_certified_without_a_fixed_count(self):
        senses = tuple(Sense(str(i), mode, 3) for i, mode in enumerate(
            ("vision", "hearing", "timing", "resource-pressure", "custom", "custom")))
        agent = self.host.create_agent(senses=senses)
        self.assertEqual(agent.senses, senses)
        manifest = json.loads(self.host.certificate(agent.agent_id).manifest)
        self.assertEqual(len(manifest[0]["senses"]), 6)


if __name__ == "__main__":
    unittest.main()
