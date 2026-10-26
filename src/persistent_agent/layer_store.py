"""Encrypted private snapshots for the trusted layer supervisor.

The host supplies a Fernet key from its keystore. Never put that key in the
snapshot, agent context, source repository, or example configuration. Pin the
returned checkpoint in separate trusted storage if rollback detection is needed.
"""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Callable

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .layers import (AgentNode, AuditEvent, BoundaryError, Certificate, DoctorRequest, Sense,
                     LayerSupervisor, Observation, SecurityReport, _json, _public, _verify)


def _private(key: Ed25519PrivateKey) -> str:
    return key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                             serialization.NoEncryption()).hex()


def save_supervisor(host: LayerSupervisor, path: str | Path, encryption_key: bytes) -> str:
    """Atomically save encrypted state; return SHA-256 checkpoint of ciphertext.

    Call under the same single-writer coordination as other supervisor methods.
    Resource handler functions are intentionally excluded and must be reattached.
    """
    state = dict(version=1, issuer_key=_private(host._issuer_key),
                 config=dict(max_events=host._max_events, max_reports=host._max_reports,
                             max_agents=host._max_agents, max_links=host._max_links,
                             max_payload_bytes=host._max_payload, certificate_ttl=host._ttl),
                 nodes=[asdict(n) for n in host._nodes.values()],
                 keys={n: _private(k) for n, k in host._keys.items()},
                 present=host._present, locked=sorted(host._locked),
                 certificates=[asdict(c) for c in host._certificates.values()],
                 links=[[*k, v] for k, v in host._links.items()],
                 permissions=sorted(host._permissions),
                 events=[asdict(e) for e in host._events],
                 audit_head=host._audit_head, audit_sequence=host._audit_sequence,
                 reports=[asdict(r) for r in host._reports],
                 emergency={k: asdict(o) for k, o in host._emergency.items()},
                 doctor_requests=[asdict(r) for r in host._doctor_requests],
                 used_actions=host._used_actions)
    encrypted = Fernet(encryption_key).encrypt(_json(state).encode())
    target = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".agent-layer-",
                                         delete=False) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            handle.write(encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return hashlib.sha256(encrypted).hexdigest()


def load_supervisor(path: str | Path, encryption_key: bytes, *,
                    clock: Callable[[], float] = time.time,
                    expected_checkpoint: str | None = None) -> LayerSupervisor:
    """Restore identities, lockouts, reports and replay protection; no code is loaded."""
    encrypted = Path(path).read_bytes()
    if expected_checkpoint is not None and hashlib.sha256(encrypted).hexdigest() != expected_checkpoint:
        raise BoundaryError("snapshot checkpoint mismatch (possible rollback)")
    try:
        state = json.loads(Fernet(encryption_key).decrypt(encrypted))
        if state["version"] != 1:
            raise BoundaryError("unsupported layer snapshot version")
        host = LayerSupervisor(clock=clock, **state["config"])
        host._issuer_key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(state["issuer_key"]))
        host.issuer_public_key = _public(host._issuer_key)
        for raw in state["nodes"]:
            node = AgentNode(**{**raw, "senses": tuple(Sense(**s) for s in raw["senses"]),
                                "capabilities": tuple(raw["capabilities"]),
                                "roles": tuple(raw["roles"])})
            host._nodes[node.agent_id] = node
            host._children[node.agent_id] = set()
        host._keys = {n: Ed25519PrivateKey.from_private_bytes(bytes.fromhex(k))
                      for n, k in state["keys"].items()}
        for node in host._nodes.values():
            if (_public(host._keys[node.agent_id]) != node.public_key
                    or node.fingerprint != "sha256:" + hashlib.sha256(
                        bytes.fromhex(node.public_key)).hexdigest()):
                raise BoundaryError("snapshot identity/key mismatch")
            current, visited = node, set()
            while current.parent_id is not None:
                if current.agent_id in visited or len(visited) >= 32:
                    raise BoundaryError("invalid snapshot ancestry")
                visited.add(current.agent_id)
                current = host._nodes[current.parent_id]
            if node.parent_id is not None:
                host._children[node.parent_id].add(node.agent_id)
        host._present = state["present"]
        host._locked = set(state["locked"])
        for raw in state["certificates"]:
            cert = Certificate(**raw)
            if (cert.issuer != host.issuer_public_key or not _verify(host.issuer_public_key,
                    "agent-live/certificate/v1", cert.body(), cert.signature)):
                raise BoundaryError("invalid snapshot certificate")
            host._certificates[cert.subject_id] = cert
        host._links = {tuple(row[:3]): row[3] for row in state["links"]}
        host._permissions = {tuple(p) for p in state["permissions"]}
        host._events = [AuditEvent(**e) for e in state["events"]]
        host._audit_head, host._audit_sequence = state["audit_head"], state["audit_sequence"]
        host._reports = [SecurityReport(**r) for r in state["reports"]]
        host._emergency = {k: Observation(**{**o, "findings": tuple(o["findings"])})
                           for k, o in state["emergency"].items()}
        host._used_actions = state["used_actions"]
        host._doctor_requests = [DoctorRequest(**r) for r in state["doctor_requests"]]
        return host
    except (InvalidToken, ValueError, KeyError, TypeError) as exc:
        raise BoundaryError("invalid encrypted supervisor snapshot") from exc
