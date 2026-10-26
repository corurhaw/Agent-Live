"""A security investigation requires three independent officers and a majority."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from cryptography.fernet import Fernet

from persistent_agent.layers import BoundaryError, LayerSupervisor, Sense
from persistent_agent.layer_store import load_supervisor, save_supervisor


class InvestigationTests(unittest.TestCase):
    def setUp(self):
        self.host = LayerSupervisor(clock=lambda: 1000)
        self.observer = self.host.create_agent(senses=(Sense("eye", "vision", 5),))
        self.patient = self.host.create_agent(capabilities=("hop",))
        self.officers = tuple(self.host.create_agent(roles=("security",)) for _ in range(3))
        self.ids = tuple(o.agent_id for o in self.officers)
        self.host.link(self.observer.agent_id, self.patient.agent_id, "vision", distance=1)
        report = self.host.encounter(self.observer.agent_id, self.patient.agent_id,
                                     "eye", behavior="walk")
        self.report_id = report.encounter_id

    def start(self):
        return self.host.start_investigation(self.report_id, self.ids)

    def vote(self, case, member, action="request_doctor", **parameters):
        return self.host.vote_investigation(case.investigation_id, member,
                                            action=action, parameters=parameters)

    def test_unit_requires_exactly_three_distinct_valid_security_individuals(self):
        for members in (self.ids[:1], self.ids[:2], self.ids + (self.observer.agent_id,),
                        (self.ids[0], self.ids[0], self.ids[1]),
                        (self.ids[0], self.ids[1], self.observer.agent_id)):
            with self.assertRaises(BoundaryError):
                self.host.start_investigation(self.report_id, members)
        unit = self.start()
        self.assertEqual(unit.security_ids, self.ids)

    def test_one_officer_cannot_act_and_two_matching_votes_can(self):
        case = self.start()
        params = dict(reason="Inspect component", evidence_ref="case/1")
        self.vote(case, self.ids[0], **params)
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        with self.assertRaises(BoundaryError):
            self.host.call_doctor(self.ids[0], self.patient.agent_id, **params)
        self.assertEqual(self.host.doctor_requests(), ())
        self.vote(case, self.ids[1], **params)
        request = self.host.proceed_investigation(case.investigation_id, self.ids[1])
        self.assertEqual(request.patient_id, self.patient.agent_id)
        self.assertEqual(len(self.host.doctor_requests()), 1)
        self.assertEqual(self.host.investigation(case.investigation_id).round_number, 2)
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[1])

    def test_split_votes_are_not_a_majority_and_parameters_must_match(self):
        case = self.start()
        self.vote(case, self.ids[0], "inspect", evidence_ref="different/1")
        self.vote(case, self.ids[1], "inspect", evidence_ref="different/2")
        self.vote(case, self.ids[2], "close", reason="No fault")
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])

    def test_duplicate_votes_outsiders_and_unsupported_actions_are_rejected(self):
        case = self.start()
        self.vote(case, self.ids[0], "inspect", evidence_ref="case/2")
        for member, action in ((self.ids[0], "inspect"), (self.observer.agent_id, "inspect"),
                               (self.ids[1], "replace_child")):
            with self.assertRaises(BoundaryError):
                self.vote(case, member, action, evidence_ref="case/2")

    def test_majority_controls_each_new_step_and_cannot_replace_children(self):
        case = self.start()
        for member in self.ids[:2]:
            self.vote(case, member, "quarantine", reason="Inspect mismatch")
        self.host.proceed_investigation(case.investigation_id, self.ids[0])
        self.assertFalse(self.host.check_integrity(self.patient.agent_id))
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        for member in self.ids[1:]:
            self.vote(case, member, "recover", reason="Checked", evidence_ref="inspection/3")
        self.host.proceed_investigation(case.investigation_id, self.ids[2])
        self.assertTrue(self.host.check_integrity(self.patient.agent_id))
        for member in self.ids[:2]:
            self.vote(case, member, "close", reason="Complete")
        self.host.proceed_investigation(case.investigation_id, self.ids[0])
        with self.assertRaises(BoundaryError):
            self.vote(case, self.ids[0], "inspect", evidence_ref="case/4")

    def test_unit_stops_if_an_officer_is_revoked(self):
        case = self.start()
        for member in self.ids[:2]:
            self.vote(case, member, "quarantine", reason="Inspect")
        self.host.revoke(self.ids[2], reason="Officer integrity failure")
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        self.assertTrue(self.host.check_integrity(self.patient.agent_id))

    def test_revised_votes_can_resolve_a_three_way_split(self):
        case = self.start()
        self.vote(case, self.ids[0], "inspect", evidence_ref="case/6")
        self.vote(case, self.ids[1], "close", reason="Complete")
        self.vote(case, self.ids[2], "quarantine", reason="Investigate")
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        self.vote(case, self.ids[2], "inspect", evidence_ref="case/6")
        self.assertEqual(len(self.host.investigation(case.investigation_id).votes), 3)
        result = self.host.proceed_investigation(case.investigation_id, self.ids[0])
        self.assertEqual(result["action"], "inspect")

    def test_certificate_changes_require_fresh_votes(self):
        case = self.start()
        for member in self.ids[:2]:
            self.vote(case, member, "inspect", evidence_ref="case/7")
        self.host.certify(self.ids[0])
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        self.vote(case, self.ids[0], "inspect", evidence_ref="case/7")
        self.host.proceed_investigation(case.investigation_id, self.ids[0])

    def test_reassignment_is_a_full_unit_and_does_not_reuse_prior_votes(self):
        case = self.start()
        for member in self.ids[:2]:
            self.vote(case, member, "inspect", evidence_ref="case/8")
        self.host.revoke(self.ids[2], reason="Officer unavailable")
        replacement = self.host.create_agent(roles=("security",))
        with self.assertRaises(BoundaryError):
            self.host.reassign_security_unit(case.investigation_id, self.ids[:2],
                                             reason="Replace unit", evidence_ref="dispatch/1")
        ids = self.ids[:2] + (replacement.agent_id,)
        updated = self.host.reassign_security_unit(case.investigation_id, ids,
                                                   reason="Replace unit", evidence_ref="dispatch/1")
        self.assertEqual(updated.votes, ())
        with self.assertRaises(BoundaryError):
            self.host.proceed_investigation(case.investigation_id, self.ids[0])
        for member in ids[:2]:
            self.vote(updated, member, "inspect", evidence_ref="case/8")
        self.host.proceed_investigation(case.investigation_id, ids[0])

    def test_votes_are_signed_and_survive_encrypted_restart(self):
        case = self.start()
        vote = self.vote(case, self.ids[0], "inspect", evidence_ref="case/5")
        self.assertTrue(self.host.verify_security_vote(vote))
        self.assertFalse(self.host.verify_security_vote(replace(vote, action="quarantine")))
        key = Fernet.generate_key()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "supervisor.enc"
            pin = save_supervisor(self.host, path, key)
            host = load_supervisor(path, key, clock=lambda: 1000, expected_checkpoint=pin)
            self.assertEqual(host.investigation(case.investigation_id).votes, (vote,))
            host.vote_investigation(case.investigation_id, self.ids[1], action="inspect",
                                    parameters=dict(evidence_ref="case/5"))
            decision = host.proceed_investigation(case.investigation_id, self.ids[1])
            self.assertEqual(decision["action"], "inspect")

    def test_three_subagents_of_one_individual_do_not_make_three_officers(self):
        parent = self.host.create_agent()
        members = []
        for _ in range(3):
            members.append(self.host.create_agent(parent_id=parent.agent_id, roles=("security",)))
            self.host.certify(parent.agent_id)
        with self.assertRaises(BoundaryError):
            self.host.start_investigation(self.report_id, tuple(m.agent_id for m in members))

    def test_full_audit_does_not_consume_votes_or_apply_the_action(self):
        host = LayerSupervisor(max_events=10)
        observer = host.create_agent(senses=(Sense("eye", "vision", 1),))
        patient = host.create_agent()
        ids = tuple(host.create_agent(roles=("security",)).agent_id for _ in range(3))
        host.link(observer.agent_id, patient.agent_id, "vision", distance=1)
        report = host.encounter(observer.agent_id, patient.agent_id, "eye", behavior="walk")
        case = host.start_investigation(report.encounter_id, ids)
        for member in ids[:2]:
            host.vote_investigation(case.investigation_id, member, action="quarantine",
                                    parameters=dict(reason="Inspect mismatch"))
        with self.assertRaises(BoundaryError):
            host.proceed_investigation(case.investigation_id, ids[0])
        self.assertTrue(host.check_integrity(patient.agent_id))
        self.assertEqual(host.investigation(case.investigation_id).round_number, 1)
        archived = []
        host.archive_events(archived.extend)
        host.proceed_investigation(case.investigation_id, ids[0])
        self.assertFalse(host.check_integrity(patient.agent_id))


if __name__ == "__main__":
    unittest.main()
