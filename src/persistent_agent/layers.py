"""Trusted, single-writer reference supervisor for a layered agent workspace.

This module runs OUTSIDE agent code. Python objects are not an OS sandbox.
The host authenticates callers, supplies observations, and owns this API and keys.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import hashlib
import json
import math
import time
from typing import Callable
from uuid import uuid4

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


class BoundaryError(ValueError):
    """A mediated operation was denied; no authority is implied by identity."""


def _json(value: object) -> str:
    """Versioned protocol uses project JSON encoding, not RFC 8785."""
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise BoundaryError("finite JSON values required") from exc


def _sign(key: Ed25519PrivateKey, domain: str, body: str) -> str:
    return key.sign((domain + "\n" + body).encode("utf-8")).hex()


def _verify(public: str, domain: str, body: str, signature: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(public)).verify(
            bytes.fromhex(signature), (domain + "\n" + body).encode("utf-8"))
        return True
    except (ValueError, InvalidSignature):
        return False


def _public(key: Ed25519PrivateKey) -> str:
    return key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()


@dataclass(frozen=True)
class Sense:
    sense_id: str
    modality: str
    range: float

    def __post_init__(self):
        if not self.sense_id or not self.modality or not math.isfinite(self.range) or self.range < 0:
            raise BoundaryError("senses need an ID, modality, and finite nonnegative range")

    @property
    def eye_id(self) -> str:
        return self.sense_id


# Vision is one possible sense. Keep the brainstorming's original API spelling.
Eye = Sense


@dataclass(frozen=True)
class AgentNode:
    agent_id: str
    parent_id: str | None
    created_at: float
    public_key: str
    fingerprint: str
    senses: tuple[Sense, ...]
    capabilities: tuple[str, ...]
    roles: tuple[str, ...] = ()

    @property
    def eyes(self) -> tuple[Sense, ...]:
        return self.senses


@dataclass(frozen=True)
class Certificate:
    serial: str
    subject_id: str
    issuer: str
    issued_at: float
    expires_at: float
    manifest: str
    signature: str = ""

    def body(self) -> str:
        return _json({k: v for k, v in asdict(self).items() if k != "signature"})


@dataclass(frozen=True)
class ActionSignature:
    agent_id: str
    signature: str


@dataclass(frozen=True)
class Action:
    action_id: str
    subject_id: str
    actor_id: str
    certificate_serial: str
    resource: str
    operation: str
    payload: str
    created_at: float
    expires_at: float
    signatures: tuple[ActionSignature, ...] = ()

    def body(self) -> str:
        return _json({k: v for k, v in asdict(self).items() if k != "signatures"})


@dataclass(frozen=True)
class Observation:
    encounter_id: str
    observer_id: str
    observed_id: str
    observed_at: float
    findings: tuple[str, ...]
    body: str
    signature: str

    def signing_body(self) -> str:
        return _json({k: v for k, v in asdict(self).items() if k != "signature"})


@dataclass(frozen=True)
class SecurityReport:
    encounter_id: str
    observer_id: str
    observed_id: str
    observed_at: float
    reported_at: float
    observation_signature: str


@dataclass(frozen=True)
class AuditEvent:
    body: str
    digest: str
    signature: str


@dataclass(frozen=True)
class DoctorRequest:
    request_id: str
    security_id: str
    patient_id: str
    requested_at: float
    reason: str
    evidence_ref: str


@dataclass(frozen=True)
class SecurityVote:
    investigation_id: str
    round_number: int
    security_id: str
    certificate_serial: str
    action: str
    parameters: str
    voted_at: float
    signature: str = ""

    def body(self) -> str:
        return _json({k: v for k, v in asdict(self).items() if k != "signature"})


@dataclass(frozen=True)
class Investigation:
    investigation_id: str
    report_id: str
    patient_id: str
    security_ids: tuple[str, ...]
    round_number: int = 1
    votes: tuple[SecurityVote, ...] = ()
    closed: bool = False
    security_roots: tuple[str, ...] = ()


@dataclass(frozen=True)
class AuditFinding:
    complaint_id: str
    auditor_id: str
    certificate_serial: str
    outcome: str
    rationale: str
    evidence_refs: tuple[str, ...]
    evaluated_at: float
    signature: str = ""

    def body(self) -> str:
        return _json({k: v for k, v in asdict(self).items() if k != "signature"})


@dataclass(frozen=True)
class AuditReview:
    complaint_id: str
    investigation_id: str
    claimant_id: str
    raised_at: float
    claim: str
    evidence_ref: str
    investigation_snapshot: str
    audit_head: str | None
    claim_signature: str = ""
    auditor_id: str | None = None
    finding: AuditFinding | None = None

    def complaint_body(self) -> str:
        return _json({k: v for k, v in asdict(self).items()
                      if k not in ("claim_signature", "auditor_id", "finding")})


class LayerSupervisor:
    """Privileged reference API, never expose this object to untrusted agents.

    Each root is an individual in this workspace; descendants act through its
    boundary. The ancestry signs each outward action, with the root as external
    accountable identity. Certificates include every descendant, while only the
    participating ancestry signs an action. All state and keys are in memory.
    """

    def __init__(self, *, clock: Callable[[], float] = time.time,
                 max_events: int = 10000, max_reports: int = 1000,
                 max_agents: int = 1000, max_links: int = 10000,
                 max_payload_bytes: int = 65536, certificate_ttl: float = 300):
        if any(type(n) is not int or n < 1 for n in
               (max_events, max_reports, max_agents, max_links, max_payload_bytes)):
            raise BoundaryError("positive integer resource budgets required")
        if not math.isfinite(certificate_ttl) or certificate_ttl <= 0:
            raise BoundaryError("positive finite certificate lifetime required")
        self._clock = clock
        self._max_events, self._max_reports = max_events, max_reports
        self._max_agents, self._max_links = max_agents, max_links
        self._max_payload = max_payload_bytes
        self._ttl = certificate_ttl
        self._issuer_key = Ed25519PrivateKey.generate()
        self.issuer_public_key = _public(self._issuer_key)
        self._nodes: dict[str, AgentNode] = {}
        self._keys: dict[str, Ed25519PrivateKey] = {}
        self._children: dict[str, set[str]] = {}
        self._present: dict[str, bool] = {}
        self._certificates: dict[str, Certificate] = {}
        self._signature_cache: dict[str, Certificate] = {}
        self._locked: set[str] = set()
        self._manifests: dict[str, str] = {}
        self._links: dict[tuple[str, str, str], float] = {}
        self._permissions: set[tuple[str, str, str]] = set()
        self._resources: dict[tuple[str, str], Callable] = {}
        self._events: list[AuditEvent] = []
        self._audit_head: str | None = None
        self._audit_sequence = 0
        self._reports: list[SecurityReport] = []
        self._emergency: dict[str, Observation] = {}
        self._doctor_requests: list[DoctorRequest] = []
        self._investigations: dict[str, Investigation] = {}
        self._archived_investigations: dict[str, Investigation] = {}
        self._audit_reviews: dict[str, AuditReview] = {}
        self._used_actions: dict[str, float] = {}

    def _now(self) -> float:
        now = self._clock()
        if not math.isfinite(now):
            raise BoundaryError("clock must return a finite timestamp")
        return now

    def _room(self, *, report: bool = False, events: int = 1) -> None:
        if len(self._events) + events > self._max_events:
            raise BoundaryError("audit capacity exhausted; archive/restart required")
        if report and len(self._reports) >= self._max_reports:
            raise BoundaryError("security queue full; supervisor intervention required")

    def _event(self, kind: str, details: object) -> None:
        self._room()
        body = _json(dict(version=1, sequence=self._audit_sequence, at=self._now(),
                          kind=kind, details=details,
                          previous=self._audit_head))
        self._events.append(AuditEvent(body, hashlib.sha256(body.encode()).hexdigest(),
                                       _sign(self._issuer_key, "agent-live/audit/v1", body)))
        self._audit_head = self._events[-1].digest
        self._audit_sequence += 1

    def events(self) -> tuple[AuditEvent, ...]:
        return tuple(self._events)

    def pending_reports(self) -> tuple[SecurityReport, ...]:
        emergency = tuple(SecurityReport(o.encounter_id, o.observer_id, o.observed_id,
                                         o.observed_at, o.observed_at, o.signature)
                          for o in self._emergency.values())
        return tuple(self._reports) + emergency

    def emergency_observations(self) -> tuple[Observation, ...]:
        """One reserved signed incident slot per individual, independent of normal queues."""
        return tuple(self._emergency.values())

    def archive_events(self, durable_sink: Callable[[tuple[AuditEvent, ...]], None]) -> None:
        """Privileged backpressure relief. Sink MUST durably save or raise on failure.

        The hash-chain head and sequence survive draining. This synchronous,
        single-writer call does not silently discard or evict unarchived events.
        """
        if self._events:
            durable_sink(tuple(self._events))
            self._events.clear()

    def acknowledge_report(self, encounter_id: str) -> None:
        """Privileged security acknowledgement, retaining its signed audit event."""
        if not any(r.encounter_id == encounter_id for r in self.pending_reports()):
            raise BoundaryError("unknown report")
        self._event("security_acknowledged", encounter_id)
        self._reports = [r for r in self._reports if r.encounter_id != encounter_id]
        self._emergency = {k: o for k, o in self._emergency.items()
                           if o.encounter_id != encounter_id}

    def node(self, agent_id: str) -> AgentNode:
        try:
            return self._nodes[agent_id]
        except KeyError as exc:
            raise BoundaryError("unknown agent") from exc

    def _ancestry(self, agent_id: str) -> tuple[str, ...]:
        result = []
        current = self.node(agent_id)
        while True:
            result.append(current.agent_id)
            if current.parent_id is None:
                return tuple(result)
            current = self.node(current.parent_id)

    def _invalidate(self, agent_id: str, *, lock: bool = False) -> None:
        for member in self._ancestry(agent_id):
            self._manifests.pop(member, None)
            if lock:
                self._locked.add(member)

    def _manifest(self, agent_id: str) -> str:
        if agent_id not in self._manifests:
            pending, members = [agent_id], []
            while pending:
                current = pending.pop()
                if not self._present[current]:
                    raise BoundaryError("required child or parent is missing")
                members.append(asdict(self.node(current)))
                pending.extend(sorted(self._children[current]))
            self._manifests[agent_id] = _json(sorted(members, key=lambda m: m["agent_id"]))
        return self._manifests[agent_id]

    def _component_roles(self, agent_id: str, *, exclude: str | None = None) -> set[str]:
        pending, roles = [agent_id], set()
        while pending:
            member = pending.pop()
            if member != exclude:
                roles.update(self.node(member).roles)
                pending.extend(self._children[member])
        return roles

    @staticmethod
    def _separate_auditors(roles: set[str]) -> None:
        if {"security", "auditor"} <= roles:
            raise BoundaryError("auditor and security roles must belong to separate individuals")

    def _issue(self, agent_id: str) -> Certificate:
        now = self._now()
        certificate = Certificate(str(uuid4()), agent_id, self.issuer_public_key,
                                  now, now + self._ttl, self._manifest(agent_id))
        certificate = replace(certificate, signature=_sign(
            self._issuer_key, "agent-live/certificate/v1", certificate.body()))
        self._certificates[agent_id] = certificate
        self._signature_cache.pop(agent_id, None)
        return certificate

    def create_agent(self, *, parent_id: str | None = None,
                     senses: tuple[Sense, ...] = (), eyes: tuple[Sense, ...] | None = None,
                     capabilities: tuple[str, ...] = (), roles: tuple[str, ...] = ()) -> AgentNode:
        """Provision a key, fingerprint and certificate before publishing a node.

        This trusted creation API generates a fresh identity, never accepts an
        arbitrary claimed fingerprint, and never transfers an existing identity.
        """
        self._room()
        if len(self._nodes) >= self._max_agents:
            raise BoundaryError("agent capacity exhausted")
        if parent_id is not None:
            if len(self._ancestry(parent_id)) >= 32:
                raise BoundaryError("maximum composition depth reached")
            if not self.check_integrity(parent_id):
                raise BoundaryError("parent must be valid before creating a child")
        if eyes is not None:
            if senses:
                raise BoundaryError("specify senses, or the eyes alias, not both")
            senses = eyes
        senses, capabilities, roles = tuple(senses), tuple(capabilities), tuple(roles)
        if (any(not isinstance(sense, Sense) for sense in senses)
                or len({sense.sense_id for sense in senses}) != len(senses)
                or any(not isinstance(c, str) or not c for c in capabilities)
                or len(set(capabilities)) != len(capabilities)
                or any(r not in ("security", "doctor", "auditor") for r in roles)
                or len(set(roles)) != len(roles)):
            raise BoundaryError("unique senses, named capabilities, and authorized roles required")
        combined_roles = set(roles)
        if parent_id is not None:
            combined_roles.update(self._component_roles(self._ancestry(parent_id)[-1]))
        self._separate_auditors(combined_roles)
        if len(_json([asdict(s) for s in senses] + list(capabilities) + list(roles))) > self._max_payload:
            raise BoundaryError("agent description exceeds budget")
        key = Ed25519PrivateKey.generate()
        public = _public(key)
        node = AgentNode(str(uuid4()), parent_id, self._now(), public,
                         "sha256:" + hashlib.sha256(bytes.fromhex(public)).hexdigest(),
                         senses, tuple(sorted(capabilities)), tuple(sorted(roles)))
        self._event("agent_created", asdict(node))
        self._nodes[node.agent_id] = node
        self._keys[node.agent_id] = key
        self._children[node.agent_id] = set()
        self._present[node.agent_id] = True
        if parent_id is not None:
            self._children[parent_id].add(node.agent_id)
            self._invalidate(parent_id)
        self._issue(node.agent_id)
        return node

    def certificate(self, agent_id: str) -> Certificate:
        self.node(agent_id)
        return self._certificates[agent_id]

    def certify(self, agent_id: str) -> Certificate:
        """Trusted enrollment/renewal; cannot undo security lockout."""
        if agent_id in self._locked:
            raise BoundaryError("reviewed recovery required")
        manifest = self._manifest(agent_id)
        self._event("composition_certified", dict(agent_id=agent_id, manifest=manifest))
        return self._issue(agent_id)

    def check_integrity(self, agent_id: str) -> bool:
        try:
            return self.verify_certificate(self.certificate(agent_id))
        except BoundaryError:
            return False

    def verify_certificate(self, cert: Certificate) -> bool:
        """Verify against this trusted issuer AND current enrollment/revocation state."""
        try:
            if (cert.subject_id in self._locked
                    or cert != self.certificate(cert.subject_id)
                    or not cert.issued_at <= self._now() < cert.expires_at
                    or cert.issuer != self.issuer_public_key
                    or cert.manifest != self._manifest(cert.subject_id)):
                return False
            if self._signature_cache.get(cert.subject_id) != cert:
                if not _verify(self.issuer_public_key, "agent-live/certificate/v1",
                               cert.body(), cert.signature):
                    return False
                self._signature_cache[cert.subject_id] = cert
            return True
        except BoundaryError:
            return False

    def revoke(self, agent_id: str, *, reason: str) -> None:
        if not reason.strip():
            raise BoundaryError("revocation reason required")
        self.node(agent_id)
        self._event("certificate_revoked", dict(agent_id=agent_id, reason=reason))
        self._invalidate(agent_id, lock=True)

    def set_present(self, agent_id: str, present: bool) -> None:
        """Trusted lifecycle input, not an agent's self-reported liveness."""
        self.node(agent_id)
        if type(present) is not bool:
            raise BoundaryError("boolean presence required")
        self._event("presence_changed", dict(agent_id=agent_id, present=present))
        self._present[agent_id] = present
        self._invalidate(agent_id, lock=True)

    def recover(self, agent_id: str, *, reason: str, evidence_ref: str) -> Certificate:
        """Privileged, reviewed recovery. No automatic trust in an anomaly report."""
        if not reason.strip() or not evidence_ref.strip():
            raise BoundaryError("recovery needs a reason and inspection evidence reference")
        manifest = self._manifest(agent_id)  # Missing children cannot be waved through.
        members = {member["agent_id"] for member in json.loads(manifest)}
        if any(member in self._locked for member in members - {agent_id}):
            raise BoundaryError("recover locked children before their parent")
        self._event("certificate_recovered", dict(
            agent_id=agent_id, previous=self.certificate(agent_id).serial,
            reason=reason, evidence_ref=evidence_ref, manifest=manifest))
        cert = self._issue(agent_id)
        self._locked.discard(agent_id)
        return cert

    def _require_role(self, actor_id: str, role: str) -> None:
        if (role not in self.node(actor_id).roles
                or not self.check_integrity(self._ancestry(actor_id)[-1])):
            raise BoundaryError("valid certified " + role + " agent required")

    def investigation(self, investigation_id: str) -> Investigation:
        try:
            return self._investigations[investigation_id]
        except KeyError as exc:
            raise BoundaryError("unknown security investigation") from exc

    def _check_unit(self, members: tuple[str, ...], patient_id: str) -> None:
        if len(members) != 3 or len(set(members)) != 3:
            raise BoundaryError("an investigation needs exactly three distinct security agents")
        roots = set()
        for member in members:
            self._require_role(member, "security")
            roots.add(self._ancestry(member)[-1])
        if len(roots) != 3 or self._ancestry(patient_id)[-1] in roots:
            raise BoundaryError("unit members must be three individuals outside the patient")

    def start_investigation(self, report_id: str,
                            security_ids: tuple[str, ...]) -> Investigation:
        """Trusted dispatcher assigns exactly one three-agent unit to a report."""
        report = next((r for r in self.pending_reports() if r.encounter_id == report_id), None)
        if report is None:
            raise BoundaryError("investigation requires an existing security report")
        patient_id = self._ancestry(report.observed_id)[-1]
        members = tuple(security_ids)
        self._check_unit(members, patient_id)
        if len(self._investigations) >= self._max_reports:
            raise BoundaryError("investigation capacity exhausted; archive closed cases")
        if any(c.report_id == report_id and not c.closed for c in self._investigations.values()):
            raise BoundaryError("report already has an active investigation")
        case = Investigation(str(uuid4()), report_id, patient_id, members,
                             security_roots=tuple(self._ancestry(m)[-1] for m in members))
        self._event("investigation_started", asdict(case))
        self._investigations[case.investigation_id] = case
        return case

    def reassign_security_unit(self, investigation_id: str, security_ids: tuple[str, ...], *,
                               reason: str, evidence_ref: str) -> Investigation:
        """Trusted dispatcher replaces an unavailable unit, discarding its old votes."""
        case = self.investigation(investigation_id)
        if case.closed or not reason.strip() or not evidence_ref.strip():
            raise BoundaryError("unit reassignment requires an open case and review evidence")
        members = tuple(security_ids)
        self._check_unit(members, case.patient_id)
        roots = (set(case.security_roots) | {self._ancestry(m)[-1] for m in members}
                 | {self._ancestry(m)[-1] for m in case.security_ids})
        updated = replace(case, security_ids=members, round_number=case.round_number + 1,
                          votes=(), security_roots=tuple(sorted(roots)))
        self._event("security_unit_reassigned", dict(previous=asdict(case), updated=asdict(updated),
                                                     reason=reason, evidence_ref=evidence_ref))
        self._investigations[investigation_id] = updated
        return updated

    def _investigation_parameters(self, action: str, parameters: dict) -> str:
        fields = {"inspect": {"evidence_ref"}, "request_doctor": {"reason", "evidence_ref"},
                  "quarantine": {"reason"}, "recover": {"reason", "evidence_ref"},
                  "close": {"reason"}}
        if (action not in fields or type(parameters) is not dict
                or set(parameters) != fields[action]
                or any(not isinstance(v, str) or not v.strip() for v in parameters.values())):
            raise BoundaryError("unsupported investigation action or invalid parameters")
        encoded = _json(parameters)
        if len(encoded.encode()) > self._max_payload:
            raise BoundaryError("investigation parameters exceed payload budget")
        return encoded

    def vote_investigation(self, investigation_id: str, security_id: str, *,
                           action: str, parameters: dict) -> SecurityVote:
        case = self.investigation(investigation_id)
        self._check_unit(case.security_ids, case.patient_id)
        if case.closed or security_id not in case.security_ids:
            raise BoundaryError("only assigned unit members can vote on an open case")
        encoded = self._investigation_parameters(action, parameters)
        prior = next((v for v in case.votes if v.security_id == security_id), None)
        if (prior and prior.action == action and prior.parameters == encoded
                and self.verify_security_vote(prior)):
            raise BoundaryError("duplicate vote")
        cert = self.certificate(self._ancestry(security_id)[-1])
        vote = SecurityVote(case.investigation_id, case.round_number, security_id,
                            cert.serial, action, encoded, self._now())
        vote = replace(vote, signature=_sign(self._keys[security_id],
                                             "agent-live/security-vote/v1", vote.body()))
        self._event("security_vote_revised" if prior else "security_vote_cast", asdict(vote))
        votes = tuple(v for v in case.votes if v.security_id != security_id) + (vote,)
        self._investigations[investigation_id] = replace(case, votes=votes)
        return vote

    def verify_security_vote(self, vote: SecurityVote) -> bool:
        try:
            self._require_role(vote.security_id, "security")
            cert = self.certificate(self._ancestry(vote.security_id)[-1])
            return (cert.serial == vote.certificate_serial and vote.voted_at <= self._now()
                    and _verify(self.node(vote.security_id).public_key,
                                "agent-live/security-vote/v1", vote.body(), vote.signature))
        except BoundaryError:
            return False

    def _majority(self, case: Investigation) -> SecurityVote:
        if case.closed:
            raise BoundaryError("investigation is closed")
        self._check_unit(case.security_ids, case.patient_id)
        counts: dict[tuple[str, str], int] = {}
        seen = set()
        for vote in case.votes:
            if (vote.security_id not in case.security_ids or vote.security_id in seen
                    or vote.investigation_id != case.investigation_id
                    or vote.round_number != case.round_number
                    or not self.verify_security_vote(vote)):
                raise BoundaryError("invalid or stale investigation vote")
            seen.add(vote.security_id)
            proposal = vote.action, vote.parameters
            counts[proposal] = counts.get(proposal, 0) + 1
        for vote in case.votes:
            if counts[vote.action, vote.parameters] >= 2:
                return vote
        raise BoundaryError("no majority: two matching votes out of three are required")

    def proceed_investigation(self, investigation_id: str, security_id: str) -> object:
        """Consume one majority decision; every subsequent action needs new votes."""
        case = self.investigation(investigation_id)
        if security_id not in case.security_ids:
            raise BoundaryError("only the assigned security unit can proceed")
        winner = self._majority(case)
        if winner.action == "close" and self.pending_audits(investigation_id):
            raise BoundaryError("independent auditor review is required before closing this case")
        parameters = json.loads(winner.parameters)
        self._investigation_parameters(winner.action, parameters)
        # Reserve for decision, operation, and a possible failure record before
        # any side effect. There is no concurrent writer in this reference host.
        self._room(events=3)
        self._event("investigation_decided", dict(investigation_id=investigation_id,
                    round_number=case.round_number, action=winner.action,
                    parameters=parameters, votes=[asdict(v) for v in case.votes]))
        self._investigations[investigation_id] = replace(
            case, round_number=case.round_number + 1, votes=(), closed=winner.action == "close")
        try:
            if winner.action == "request_doctor":
                return self._enqueue_doctor(winner.security_id, case.patient_id, **parameters)
            if winner.action == "quarantine":
                return self.revoke(case.patient_id, **parameters)
            if winner.action == "recover":
                return self.recover(case.patient_id, **parameters)
            if winner.action == "close":
                if any(r.encounter_id == case.report_id for r in self.pending_reports()):
                    self.acknowledge_report(case.report_id)
                return None
            # An inspection decision is a plan for the host's inspection adapter;
            # it conveys no new permission to read private state or replace parts.
            return dict(action="inspect", patient_id=case.patient_id, **parameters)
        except Exception as exc:
            self._event("investigation_step_failed", dict(investigation_id=investigation_id,
                        round_number=case.round_number, error_type=type(exc).__name__))
            raise

    def archive_investigation(self, investigation_id: str) -> None:
        """Trusted housekeeping; signed history remains in the audit/archive."""
        if not self.investigation(investigation_id).closed:
            raise BoundaryError("only closed investigations may be archived")
        if self.pending_audits(investigation_id):
            raise BoundaryError("cannot archive an investigation awaiting auditor review")
        if len(self._archived_investigations) >= self._max_reports:
            raise BoundaryError("reviewable investigation archive is full")
        self._event("investigation_archived", investigation_id)
        self._archived_investigations[investigation_id] = self._investigations.pop(investigation_id)

    def _reviewable_investigation(self, investigation_id: str) -> Investigation:
        case = self._investigations.get(investigation_id) or self._archived_investigations.get(investigation_id)
        if case is None:
            raise BoundaryError("unknown investigation for auditor review")
        return case

    def audit_review(self, complaint_id: str) -> AuditReview:
        try:
            return self._audit_reviews[complaint_id]
        except KeyError as exc:
            raise BoundaryError("unknown security complaint") from exc

    def pending_audits(self, investigation_id: str | None = None) -> tuple[AuditReview, ...]:
        return tuple(r for r in self._audit_reviews.values() if r.finding is None
                     and (investigation_id is None or r.investigation_id == investigation_id))

    def raise_security_complaint(self, investigation_id: str, claimant_id: str, *,
                                 claim: str, evidence_ref: str) -> AuditReview:
        """Protected host reporting channel, including for quarantined claimants.

        Acceptance creates a mandatory review; no security vote can dismiss it.
        An allegation does not itself revoke anyone's identity or establish guilt.
        """
        case = self._reviewable_investigation(investigation_id)
        self.node(claimant_id)  # The host authenticates this caller, even during lockout.
        if not claim.strip() or not evidence_ref.strip():
            raise BoundaryError("a claim and evidence reference are required")
        if len(_json([claim, evidence_ref]).encode()) > self._max_payload:
            raise BoundaryError("complaint exceeds payload budget")
        if len(self._audit_reviews) >= self._max_reports:
            raise BoundaryError("auditor review queue full; complaint was not accepted")
        review = AuditReview(str(uuid4()), investigation_id, claimant_id, self._now(),
                             claim, evidence_ref, _json(asdict(case)), self._audit_head)
        review = replace(review, claim_signature=_sign(self._keys[claimant_id],
                         "agent-live/security-complaint/v1", review.complaint_body()))
        self._event("independent_audit_required", asdict(review))
        self._audit_reviews[review.complaint_id] = review
        return review

    def _check_auditor(self, review: AuditReview, auditor_id: str) -> None:
        self._require_role(auditor_id, "auditor")
        root = self._ancestry(auditor_id)[-1]
        self._separate_auditors(self._component_roles(root))
        case = self._reviewable_investigation(review.investigation_id)
        snapshot = json.loads(review.investigation_snapshot)
        involved = (set(case.security_roots) | set(snapshot.get("security_roots", ()))
                    | {self._ancestry(m)[-1] for m in case.security_ids}
                    | {case.patient_id, self._ancestry(case.patient_id)[-1],
                       self._ancestry(review.claimant_id)[-1]})
        if root in involved:
            raise BoundaryError("auditor must be independent of the unit, patient and claimant")

    def verify_security_complaint(self, review: AuditReview) -> bool:
        return _verify(self.node(review.claimant_id).public_key,
                       "agent-live/security-complaint/v1", review.complaint_body(),
                       review.claim_signature)

    def assign_auditor(self, complaint_id: str, auditor_id: str) -> AuditReview:
        """Trusted enclosing-layer dispatch; security does not select its own reviewer."""
        review = self.audit_review(complaint_id)
        if review.finding is not None:
            raise BoundaryError("audit review is already complete")
        self._check_auditor(review, auditor_id)
        self._event("auditor_assigned", dict(complaint_id=complaint_id, auditor_id=auditor_id,
                                             previous_auditor=review.auditor_id))
        updated = replace(review, auditor_id=auditor_id)
        self._audit_reviews[complaint_id] = updated
        return updated

    def submit_audit_finding(self, complaint_id: str, auditor_id: str, *, outcome: str,
                             rationale: str, evidence_refs: tuple[str, ...]) -> AuditFinding:
        review = self.audit_review(complaint_id)
        self._check_auditor(review, auditor_id)
        if review.finding is not None or review.auditor_id != auditor_id:
            raise BoundaryError("only the assigned auditor can complete an unfinished review")
        refs = tuple(evidence_refs)
        if (outcome not in ("substantiated", "unsubstantiated", "inconclusive")
                or not rationale.strip() or not refs
                or any(not isinstance(ref, str) or not ref.strip() for ref in refs)):
            raise BoundaryError("auditor must provide an outcome, rationale and evidence references")
        if len(_json([rationale, refs]).encode()) > self._max_payload:
            raise BoundaryError("audit finding exceeds payload budget")
        cert = self.certificate(self._ancestry(auditor_id)[-1])
        finding = AuditFinding(complaint_id, auditor_id, cert.serial, outcome, rationale,
                               refs, self._now())
        finding = replace(finding, signature=_sign(self._keys[auditor_id],
                          "agent-live/audit-finding/v1", finding.body()))
        self._event("independent_audit_completed", asdict(finding))
        self._audit_reviews[complaint_id] = replace(review, finding=finding)
        return finding

    def verify_audit_finding(self, finding: AuditFinding) -> bool:
        """Historical signature verification, independent of later certificate renewal."""
        return _verify(self.node(finding.auditor_id).public_key,
                       "agent-live/audit-finding/v1", finding.body(), finding.signature)

    def archive_audit_review(self, complaint_id: str, durable_sink: Callable[[AuditReview], None]) -> None:
        """Completed reviews may leave the bounded registry only after durable export."""
        review = self.audit_review(complaint_id)
        if review.finding is None:
            raise BoundaryError("unreviewed claims cannot be archived or dismissed")
        self._room()
        durable_sink(review)
        self._event("audit_review_archived", complaint_id)
        del self._audit_reviews[complaint_id]

    def call_doctor(self, security_id: str, patient_id: str, *,
                    reason: str, evidence_ref: str,
                    investigation_id: str | None = None) -> DoctorRequest:
        """Compatibility entry point: a single security agent cannot request treatment."""
        self._require_role(security_id, "security")
        if investigation_id is None:
            raise BoundaryError("doctor requests require a three-agent investigation majority")
        case = self.investigation(investigation_id)
        winner = self._majority(case)
        if (case.patient_id != patient_id or winner.action != "request_doctor"
                or winner.parameters != _json(dict(reason=reason, evidence_ref=evidence_ref))):
            raise BoundaryError("doctor request does not match the majority decision")
        return self.proceed_investigation(investigation_id, security_id)

    def _enqueue_doctor(self, security_id: str, patient_id: str, *,
                    reason: str, evidence_ref: str) -> DoctorRequest:
        """Internal operation after a consumed majority decision; no replacement authority."""
        self._require_role(security_id, "security")
        self.node(patient_id)
        if not reason.strip() or not evidence_ref.strip():
            raise BoundaryError("doctor request needs a reason and evidence reference")
        if len(self._doctor_requests) >= self._max_reports:
            raise BoundaryError("doctor request queue full")
        request = DoctorRequest(str(uuid4()), security_id, patient_id, self._now(),
                                reason, evidence_ref)
        self._event("doctor_requested", asdict(request))
        self._doctor_requests.append(request)
        return request

    def doctor_requests(self) -> tuple[DoctorRequest, ...]:
        return tuple(self._doctor_requests)

    def acknowledge_doctor_request(self, doctor_id: str, request_id: str) -> None:
        self._require_role(doctor_id, "doctor")
        if not any(r.request_id == request_id for r in self._doctor_requests):
            raise BoundaryError("unknown doctor request")
        self._event("doctor_request_acknowledged", dict(doctor_id=doctor_id,
                                                       request_id=request_id))
        self._doctor_requests = [r for r in self._doctor_requests if r.request_id != request_id]

    def replace_child(self, parent_id: str, old_id: str, new_id: str, *, doctor_id: str,
                      reason: str, evidence_ref: str) -> None:
        """Privileged repair: attach an inspected replacement with its OWN identity.

        The old subtree is retained and locked as a detached individual. The
        replacement must be a valid root in this workspace, never an identity
        borrowed from another parent. Parent recovery is a separate explicit step.
        """
        self._require_role(doctor_id, "doctor")
        if self._ancestry(doctor_id)[-1] == self._ancestry(parent_id)[-1]:
            raise BoundaryError("replacement needs a doctor outside the patient individual")
        self.node(parent_id)
        old, new = self.node(old_id), self.node(new_id)
        if (not reason.strip() or not evidence_ref.strip() or old.parent_id != parent_id
                or new.parent_id is not None or new_id in self._ancestry(parent_id)
                or not self.check_integrity(new_id)):
            raise BoundaryError("reviewed replacement with a valid independent node required")
        self._separate_auditors(self._component_roles(self._ancestry(parent_id)[-1], exclude=old_id)
                                | self._component_roles(new_id))
        # Check the deepest replacement path before changing any membership.
        pending, depth = [(new_id, 1)], len(self._ancestry(parent_id))
        while pending:
            member, level = pending.pop()
            if depth + level > 32:
                raise BoundaryError("maximum composition depth reached")
            pending.extend((child, level + 1) for child in self._children[member])
        self._event("child_replaced", dict(doctor_id=doctor_id, parent_id=parent_id, old_id=old_id,
                                           new_id=new_id, reason=reason,
                                           evidence_ref=evidence_ref))
        self._children[parent_id].remove(old_id)
        self._children[parent_id].add(new_id)
        self._nodes[old_id] = replace(old, parent_id=None)
        self._nodes[new_id] = replace(new, parent_id=parent_id)
        self._invalidate(old_id, lock=True)
        self._invalidate(new_id, lock=True)
        # Remove the replacement's former outward authority; it now acts as a part.
        self._permissions = {p for p in self._permissions if p[0] != new_id}

    def grant(self, subject_id: str, resource: str, operation: str) -> None:
        self.node(subject_id)
        if self.node(subject_id).parent_id is not None:
            raise BoundaryError("outward grants belong to the root individual")
        self._event("permission_granted", [subject_id, resource, operation])
        self._permissions.add((subject_id, resource, operation))

    def withdraw_grant(self, subject_id: str, resource: str, operation: str) -> None:
        self._event("permission_withdrawn", [subject_id, resource, operation])
        self._permissions.discard((subject_id, resource, operation))

    def register_resource(self, resource: str, operation: str, handler: Callable) -> None:
        if (resource, operation) in self._resources or not callable(handler):
            raise BoundaryError("resource operation must be new and callable")
        self._event("resource_registered", [resource, operation])
        self._resources[resource, operation] = handler

    def prepare_action(self, actor_id: str, resource: str,
                       operation: str, payload: object) -> Action:
        """Host-only signing seam; authenticate the requesting process BEFORE this call."""
        ancestry = self._ancestry(actor_id)
        subject = ancestry[-1]
        if (not self.check_integrity(subject)
                or (subject, resource, operation) not in self._permissions):
            raise BoundaryError("invalid individual or denied permission")
        encoded = _json(payload)
        if len(encoded.encode()) > self._max_payload:
            raise BoundaryError("payload budget exceeded")
        now = self._now()
        cert = self.certificate(subject)
        action = Action(str(uuid4()), subject, actor_id, cert.serial, resource,
                        operation, encoded, now, min(now + 30, cert.expires_at))
        return replace(action, signatures=tuple(ActionSignature(
            member, _sign(self._keys[member], "agent-live/action/v1", action.body()))
            for member in ancestry))

    def dispatch(self, action: Action) -> object:
        """Verify and consume a signed action before invoking an approved resource."""
        ancestry = self._ancestry(action.actor_id)
        now = self._now()
        self._used_actions = {k: v for k, v in self._used_actions.items() if v > now}
        if (action.subject_id != ancestry[-1]
                or not self.check_integrity(action.subject_id)
                or action.certificate_serial != self.certificate(action.subject_id).serial
                or not action.created_at <= now < action.expires_at
                or action.expires_at > self.certificate(action.subject_id).expires_at
                or action.expires_at - action.created_at > 30
                or action.action_id in self._used_actions
                or (action.subject_id, action.resource, action.operation) not in self._permissions
                or (action.resource, action.operation) not in self._resources
                or len(action.payload.encode()) > self._max_payload
                or tuple(s.agent_id for s in action.signatures) != ancestry):
            raise BoundaryError("action failed boundary checks")
        if not all(_verify(self.node(s.agent_id).public_key, "agent-live/action/v1",
                           action.body(), s.signature) for s in action.signatures):
            raise BoundaryError("invalid parent/child action signature")
        try:
            payload = json.loads(action.payload)
            if _json(payload) != action.payload:
                raise BoundaryError("noncanonical action payload")
        except (ValueError, TypeError) as exc:
            raise BoundaryError("invalid action payload") from exc
        self._event("action_dispatched", asdict(action))
        self._used_actions[action.action_id] = action.expires_at
        # Failure still consumes the action. Audit records an attempt, not success.
        return self._resources[action.resource, action.operation](payload)

    def link(self, observer: str, observed: str, modality: str, *, distance: float) -> None:
        """Trusted directed adjacency update; no all-pairs scan is performed."""
        self.node(observer)
        self.node(observed)
        if not modality or not math.isfinite(distance) or distance < 0:
            raise BoundaryError("finite nonnegative distance and modality required")
        edge = observer, observed, modality
        if edge not in self._links and len(self._links) >= self._max_links:
            raise BoundaryError("visibility budget exhausted")
        self._links[edge] = distance

    def unlink(self, observer: str, observed: str, modality: str) -> None:
        self._links.pop((observer, observed, modality), None)

    def encounter(self, observer_id: str, observed_id: str, sense_id: str, *,
                  behavior: str, threat: str | None = None,
                  defense: str | None = None) -> Observation:
        """Capture trusted sensor input now; publish evidence, never infer guilt.

        The rough appearance is derived from registry state, not a target's
        assertion. Call on each relevant movement/action event, not every tick.
        """
        observer, observed = self.node(observer_id), self.node(observed_id)
        sense = next((s for s in observer.senses if s.sense_id == sense_id), None)
        distance = self._links.get((observer_id, observed_id, sense.modality)) if sense else None
        if sense is None or distance is None or distance > sense.range:
            raise BoundaryError("target is outside this sense's perceptual range")
        if not self.check_integrity(self._ancestry(observer_id)[-1]):
            raise BoundaryError("observer is locked out; privileged recovery remains available")
        if defense not in (None, "reject", "withdraw", "isolate") or (defense and not threat):
            raise BoundaryError("only bounded self-protection for an observed threat is allowed")
        if not isinstance(behavior, str) or not behavior:
            raise BoundaryError("observed behavior required")
        if len(_json([behavior, threat]).encode()) > self._max_payload:
            raise BoundaryError("observation budget exceeded")
        findings = []
        observed_root = self._ancestry(observed_id)[-1]
        if not self.check_integrity(observed_root):
            findings.append("invalid_certificate_or_composition")
        if behavior not in observed.capabilities:
            findings.append("behavior_not_in_certified_capabilities")
        if threat:
            findings.append("reported_threat")
        now = self._now()
        body = _json(dict(
            sense=asdict(sense), distance=distance, behavior=behavior, threat=threat,
            defense=defense, certificate=asdict(self.certificate(observed_root)),
            appearance=dict(sense_count=len(observed.senses), capabilities=observed.capabilities)))
        unsigned = Observation(str(uuid4()), observer_id, observed_id, now,
                               tuple(findings), body, "")
        observation = replace(unsigned, signature=_sign(
            self._keys[observer_id], "agent-live/observation/v1", unsigned.signing_body()))
        try:
            self._room(report=bool(findings))
            self._event("encounter", asdict(observation))
        except BoundaryError:
            if threat:
                root = self._ancestry(observer_id)[-1]
                # Reserve evidence before isolating. A locked root cannot produce
                # another ordinary encounter, bounding this store by max_agents.
                self._emergency[root] = observation
                self._invalidate(root, lock=True)
                return observation
            raise
        if defense == "withdraw":
            self._links = {k: v for k, v in self._links.items()
                           if observer_id not in k[:2]}
        elif defense == "isolate":
            self._invalidate(self._ancestry(observer_id)[-1], lock=True)
        # reject performs no interaction; no permissions to modify the other agent.
        if findings:
            self._reports.append(SecurityReport(observation.encounter_id, observer_id,
                                                observed_id, now, now, observation.signature))
        return observation

    def verify_observation(self, observation: Observation) -> bool:
        return _verify(self.node(observation.observer_id).public_key,
                       "agent-live/observation/v1", observation.signing_body(),
                       observation.signature)
