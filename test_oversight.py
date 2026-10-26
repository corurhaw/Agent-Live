"""Claims about security always require a separate, independent auditor."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from cryptography.fernet import Fernet

from persistent_agent.layers import BoundaryError, LayerSupervisor, Sense
from persistent_agent.layer_store import load_supervisor, save_supervisor


class OversightTests(unittest.TestCase):
    def setUp(self):
        self.host = LayerSupervisor(clock=lambda: 1000)
        self.observer = self.host.create_agent(senses=(Sense("eye", "vision", 1),))
        self.patient = self.host.create_agent()
        self.unit = tuple(self.host.create_agent(roles=("security",)) for _ in range(3))
        self.host.link(self.observer.agent_id, self.patient.agent_id, "vision", distance=1)
        report = self.host.encounter(self.observer.agent_id, self.patient.agent_id,
                                     "eye", behavior="walk")
        self.case = self.host.start_investigation(report.encounter_id,
                                                 tuple(m.agent_id for m in self.unit))

    def claim(self):
        return self.host.raise_security_complaint(self.case.investigation_id,
                                                  self.patient.agent_id,
                                                  claim="Security may have exceeded its authority",
                                                  evidence_ref="encounter/1")

    def vote_close(self):
        for member in self.unit[:2]:
            self.host.vote_investigation(self.case.investigation_id, member.agent_id,
                                         action="close", parameters=dict(reason="Investigation complete"))

    def test_complaint_is_queued_without_auditor_and_prevents_security_closing_it(self):
        review = self.claim()
        self.assertTrue(self.host.verify_security_complaint(review))
        self.assertFalse(self.host.verify_security_complaint(replace(review, claim="Changed claim")))
        self.assertEqual(self.host.pending_audits(), (review,))
        self.vote_close()
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(self.case.investigation_id, self.unit[0].agent_id)
        with self.assertRaises(BoundaryError):
            self.host.submit_audit_finding(review.complaint_id, self.unit[0].agent_id,
                                           outcome="unsubstantiated", rationale="Dismiss claim",
                                           evidence_refs=("case/1",))
        self.assertFalse(self.host.investigation(self.case.investigation_id).closed)

    def test_auditor_role_is_separate_across_the_individual_boundary(self):
        with self.assertRaises(BoundaryError):
            self.host.create_agent(roles=("security", "auditor"))
        with self.assertRaises(BoundaryError):
            self.host.create_agent(parent_id=self.unit[0].agent_id, roles=("auditor",))
        auditor = self.host.create_agent(roles=("auditor",))
        with self.assertRaises(BoundaryError):
            self.host.create_agent(parent_id=auditor.agent_id, roles=("security",))

    def test_only_assigned_independent_auditor_can_finish_review(self):
        auditor = self.host.create_agent(roles=("auditor",))
        other = self.host.create_agent(roles=("auditor",))
        review = self.claim()
        self.host.assign_auditor(review.complaint_id, auditor.agent_id)
        with self.assertRaises(BoundaryError):
            self.host.submit_audit_finding(review.complaint_id, other.agent_id,
                                           outcome="inconclusive", rationale="Not assigned",
                                           evidence_refs=("case/1",))
        finding = self.host.submit_audit_finding(review.complaint_id, auditor.agent_id,
                                                outcome="inconclusive", rationale="More evidence is needed",
                                                evidence_refs=("case/1", "votes/1"))
        self.assertTrue(self.host.verify_audit_finding(finding))
        self.assertFalse(self.host.verify_audit_finding(replace(finding, outcome="substantiated")))
        self.assertEqual(self.host.pending_audits(), ())
        self.vote_close()
        self.host.proceed_investigation(self.case.investigation_id, self.unit[0].agent_id)

    def test_claims_after_closure_and_archiving_still_require_auditors(self):
        self.vote_close()
        self.host.proceed_investigation(self.case.investigation_id, self.unit[0].agent_id)
        self.host.archive_investigation(self.case.investigation_id)
        review = self.claim()
        self.assertEqual(self.host.pending_audits(), (review,))
        auditor = self.host.create_agent(roles=("auditor",))
        self.host.assign_auditor(review.complaint_id, auditor.agent_id)
        self.host.submit_audit_finding(review.complaint_id, auditor.agent_id,
                                       outcome="unsubstantiated", rationale="Signed records support the actions",
                                       evidence_refs=("archive/1",))

    def test_locked_patient_can_raise_claim_and_pending_review_survives_restart(self):
        self.host.revoke(self.patient.agent_id, reason="Investigate")
        review = self.claim()
        key = Fernet.generate_key()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "supervisor.enc"
            pin = save_supervisor(self.host, path, key)
            host = load_supervisor(path, key, clock=lambda: 1000, expected_checkpoint=pin)
            self.assertEqual(host.pending_audits(), (review,))
            auditor = host.create_agent(roles=("auditor",))
            host.assign_auditor(review.complaint_id, auditor.agent_id)
            finding = host.submit_audit_finding(review.complaint_id, auditor.agent_id,
                                                outcome="substantiated", rationale="Evidence reviewed",
                                                evidence_refs=("inspection/2",))
            pin = save_supervisor(host, path, key)
            restored = load_supervisor(path, key, clock=lambda: 1000, expected_checkpoint=pin)
            self.assertEqual(restored.audit_review(review.complaint_id).finding, finding)
            self.assertTrue(restored.verify_audit_finding(finding))

    def test_patient_cannot_supply_its_own_auditor(self):
        auditor = self.host.create_agent(parent_id=self.patient.agent_id, roles=("auditor",))
        self.host.certify(self.patient.agent_id)
        review = self.claim()
        with self.assertRaises(BoundaryError):
            self.host.assign_auditor(review.complaint_id, auditor.agent_id)

    def test_doctor_cannot_merge_auditor_into_a_security_individual(self):
        security = self.unit[0]
        child = self.host.create_agent(parent_id=security.agent_id)
        auditor = self.host.create_agent(roles=("auditor",))
        doctor = self.host.create_agent(roles=("doctor",))
        with self.assertRaises(BoundaryError):
            self.host.replace_child(security.agent_id, child.agent_id, auditor.agent_id,
                                     doctor_id=doctor.agent_id, reason="Attempt role merge",
                                     evidence_ref="inspection/3")
        self.assertIsNone(self.host.node(auditor.agent_id).parent_id)

    def test_pending_reviews_cannot_be_discarded_and_completed_export_must_succeed(self):
        review = self.claim()
        exported = []
        with self.assertRaises(BoundaryError):
            self.host.archive_audit_review(review.complaint_id, exported.append)
        self.assertEqual(exported, [])
        auditor = self.host.create_agent(roles=("auditor",))
        self.host.assign_auditor(review.complaint_id, auditor.agent_id)
        self.host.submit_audit_finding(review.complaint_id, auditor.agent_id,
                                       outcome="inconclusive", rationale="Evidence evaluated",
                                       evidence_refs=("case/2",))
        def unavailable_storage(item):
            raise OSError("archive unavailable")
        with self.assertRaises(OSError):
            self.host.archive_audit_review(review.complaint_id, unavailable_storage)
        self.assertIsNotNone(self.host.audit_review(review.complaint_id).finding)
        self.host.archive_audit_review(review.complaint_id, exported.append)
        self.assertEqual(len(exported), 1)

    def test_revoked_auditor_cannot_finish_but_review_can_be_reassigned(self):
        review = self.claim()
        first = self.host.create_agent(roles=("auditor",))
        second = self.host.create_agent(roles=("auditor",))
        self.host.assign_auditor(review.complaint_id, first.agent_id)
        self.host.revoke(first.agent_id, reason="Review auditor integrity")
        with self.assertRaises(BoundaryError):
            self.host.submit_audit_finding(review.complaint_id, first.agent_id,
                                           outcome="unsubstantiated", rationale="Dismiss",
                                           evidence_refs=("case/3",))
        self.host.assign_auditor(review.complaint_id, second.agent_id)
        self.host.submit_audit_finding(review.complaint_id, second.agent_id,
                                       outcome="inconclusive", rationale="Records reviewed",
                                       evidence_refs=("case/3",))


if __name__ == "__main__":
    unittest.main()
