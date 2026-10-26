# Layered agent workspace

The `persistent_agent.layers` module implements an experimental trusted
supervisor for the shared workspace. It does not run language models and does
not itself isolate hostile executable code. The host owns this supervisor;
agents request operations through an authenticated adapter outside their process.

## Identity and composition

`create_agent()` generates a fresh UUID, Ed25519 key and SHA-256 public-key
fingerprint, then issues a signed composition certificate before returning the
new node. The enclosing layer provisions these credentials. Agents cannot supply
their own claimed fingerprint. "Biometric" is the design analogy; the concrete
mechanism is a cryptographic identity, not biological measurement.

Each root is an individual in the shared workspace. Children and deeper
descendants are internal components. Each certificate contains the subject and
all its descendants, including their public keys, parent relationships, senses,
capabilities and certified roles. A newly created child immediately has its own
identity; its addition invalidates the parent's previous composition certificate.
The host certifies the completed composition before allowing outward actions.

Outward actions are attributed to the root individual. The participating child
and every ancestor up to the root sign the same envelope, binding the action ID,
certificate serial, target resource, operation, payload and validity interval.
This is an envelope of ordinary signatures, not a new aggregate-signature
cryptosystem. Uninvolved children are covered by the composition certificate and
need not sign every action.

## Variable senses and encounters

An agent may have zero or any configured number of senses within its resource
budget. `Sense(sense_id, modality, range)` accepts application-defined modalities;
vision, hearing, hardware proximity, interaction and resource pressure are
examples, not required anatomy. `Eye` and the `eyes=` creation argument are aliases
for compatibility with the initial terminology.

The host maintains a directed weighted adjacency map keyed by observer, observed
node and modality. An encounter requires a corresponding sense and an in-range
edge. The host supplies these edges and observed behavior from authoritative
environment events. This prototype does not implement geometric movement,
physical hardware discovery or sensor hardware drivers.

Senses receive the encountered individual's certificate and a rough appearance,
not memories or internal communications. The current rough appearance exposes
sense count and declared behavior capabilities. Integrity checks compare current
certification and whether the observed behavior belongs to those capabilities.
This is a deterministic consistency check, not a general physics engine or a
model that can infer malicious intent from an avatar.

An encounter snapshot binds observer, target, sensor, distance, timestamp,
certificate, appearance, observed behavior, findings and any protective action.
It is signed and saved to a hash-linked, supervisor-signed audit sequence.
Later discoveries are new events; they do not rewrite the encounter. Findings
immediately enter a security queue. A discrepancy is evidence for investigation,
not a finding of guilt.

## Containment, security and doctors

Missing components, revocation, expiration, changed compositions, denied grants,
invalid signatures and replayed actions prevent mediated outward operations.
Observing an inconsistency does not automatically punish the observed node.
Security investigates and the trusted host applies any necessary containment.

Protective actions are limited to rejecting the interaction, withdrawing from
perceptual links, or isolating the observer's own individual. They do not grant
authority to damage or modify another node. Threat encounters submit a security
report immediately. If normal audit/report capacity is exhausted, a reserved
signed incident slot preserves the evidence and the individual is isolated.
There is at most one such emergency slot per individual.

Only a valid agent with the certified `doctor` role may replace a child.
Security units can approve a doctor request by majority and supply an evidence
reference, but their `security` role does not authorize replacement. Role assignment is a
privileged enrollment operation, never a self-declared capability.

`replace_child(..., doctor_id=..., reason=..., evidence_ref=...)` requires a
doctor outside the patient's individual. The replacement has its own identity;
it never inherits the missing child's fingerprint. The old subtree is retained,
detached and locked. The replacement loses any former outward grants, and the
changed composition stays locked until reviewed recovery.

Recover children before parents. Certificate recovery requires a reason and an
inspection reference and cannot waive a missing or still-locked child. Recovery
issues a new certificate and retains the previous serial in the audit trail.
The host's certificate authority performs this operation after review; certificate
renewal alone cannot clear a security lockout. A host must authenticate the
reviewing security/medical workflow before invoking this privileged API.

## Three-agent security investigations

Security responds to investigation reports in units of exactly three distinct,
currently valid security agents belonging to three independent individuals.
The patient cannot be one of those individuals. The trusted enclosing layer
assigns a complete unit with `start_investigation(report_id, security_ids)`;
one or two responders cannot start an investigation.

Each next investigation action requires at least two matching votes out of the
three assigned agents. Votes bind the case, round, voter, current certificate
serial, action and exact parameters, timestamp, and Ed25519 signature. A plurality
or three different proposals does not authorize action. A member can revise its
vote before execution; the revision is audited and replaces that member's prior
vote rather than adding another vote.

`proceed_investigation()` checks all three members' current integrity, verifies
the votes and consumes a majority decision once. The next action opens a fresh
round with no inherited votes. Certificate changes require affected votes to be
refreshed. Invalid unit membership freezes progress. The enclosing dispatcher can
assign another complete unit with `reassign_security_unit()`, retaining the reason
and evidence and discarding all old votes. This is dispatch authority, not a
permission for an individual security agent to appoint its own majority.

Supported decisions are inspection, requesting a doctor, quarantining the patient,
reviewed certificate recovery, and closing the case. Inspection returns an approved
plan for a host adapter, not unrestricted access to private state. Replacement is
not an available security action, even with unanimous votes. The legacy
`call_doctor()` entry point now requires a matching majority in an investigation;
a single officer cannot use it to bypass voting.

Votes and active rounds survive encrypted supervisor snapshots. Decisions,
revisions and failed action attempts remain in the signed audit history. A failed
attempt consumes its round; a retry needs a new vote. Closed cases can be removed
from the bounded active registry with `archive_investigation()` after their signed
history has been retained through the audit/archive pipeline.

Immediate self-protection and automatic certificate enforcement remain available
while a security unit is being dispatched. They do not grant a single security
agent authority to decide investigation actions. Direct host control-plane methods
such as `revoke()` and `recover()` must never be exposed as unrestricted security
agent tools; the security adapter must route these actions through voting.

## Example

```python
from persistent_agent.layers import LayerSupervisor, Sense

host = LayerSupervisor()
agent = host.create_agent(senses=(Sense("forward", "vision", 10),))
child = host.create_agent(parent_id=agent.agent_id, capabilities=("analyze",))
host.certify(agent.agent_id)

notes = []
host.register_resource("notes", "append", notes.append)
host.grant(agent.agent_id, "notes", "append")
action = host.prepare_action(child.agent_id, "notes", "append", "A finding")
host.dispatch(action)

unit = tuple(host.create_agent(roles=("security",),
                               senses=(Sense("forward", "vision", 10),)) for _ in range(3))
security = unit[0]
doctor = host.create_agent(roles=("doctor",))
host.set_present(child.agent_id, False)
host.link(security.agent_id, agent.agent_id, "vision", distance=1)
report = host.encounter(security.agent_id, agent.agent_id, "forward", behavior="idle")
case = host.start_investigation(report.encounter_id, tuple(m.agent_id for m in unit))
for member in unit[:2]:
    host.vote_investigation(case.investigation_id, member.agent_id,
                            action="request_doctor", parameters=dict(
                                reason="Missing child", evidence_ref="encounter/123"))
request = host.proceed_investigation(case.investigation_id, security.agent_id)
replacement = host.create_agent(capabilities=("analyze",))
host.replace_child(agent.agent_id, child.agent_id, replacement.agent_id,
                    doctor_id=doctor.agent_id, reason="Inspected replacement",
                    evidence_ref="inspection/124")
host.recover(replacement.agent_id, reason="Replacement checked",
              evidence_ref="inspection/124")
host.recover(agent.agent_id, reason="Composition checked",
              evidence_ref="inspection/125")
host.acknowledge_doctor_request(doctor.agent_id, request.request_id)
```

Run the included offline vertical slice:

```bash
python -m persistent_agent layers-demo
```

## Persistence and key custody

`layer_store.save_supervisor()` atomically writes a private encrypted snapshot.
It preserves identities, keys, certificates, permissions, lockouts, queued
reports, doctor requests, active investigations, signed votes, replay state and
audit history. A separate process can restore the same fingerprints and pending
investigation rounds with `load_supervisor()`.

The host supplies a Fernet encryption key from its keystore. Never put it in agent
context, source control, logs, command-line arguments or the snapshot itself.
The snapshot returns a ciphertext SHA-256 checkpoint. Pin it in separate trusted
storage and supply `expected_checkpoint=` on restore to detect an older snapshot.
Encryption alone does not prevent rollback. This host encryption key is separate
from the agent and certificate-authority signing keys inside the encrypted file.

Resource handlers are code, so they are not serialized. Reattach approved
handlers after restore. Keys remain in supervisor memory during execution;
production deployments should put signing behind a protected keystore service.
Legacy `IdentityRecord` JSON snapshots retain their existing format and do not
automatically become enrolled security principals or acquire signing authority.

## Compute and resource bounds

- No model inference occurs in routine integrity checks.
- Perception uses explicit adjacency events, not continuous all-pairs scans.
- Compositions are cached and invalidated through the ancestor path on changes.
- Certificate signature verification is cached for the exact immutable certificate;
  current enrollment, lockout, composition and expiry are still checked each time.
- Action signing costs scale with participating ancestry, bounded to depth 32.
- Configurable budgets bound agents, edges, payloads, audit events and queues.
- Full normal logs stop mediated side effects rather than silently evict evidence.
  `archive_events(durable_sink)` frees space only after the trusted sink returns
  successfully; the sink must persist or raise. The audit chain continues across
  archives. Security acknowledgement drains processed reports separately.

## Enforcement limits

Object encapsulation is not hostile-code isolation. A real deployment needs a
supervisor process outside agent execution, authenticated IPC, filesystem and
network restrictions, and OS-enforced resource limits. Never hand an agent this
supervisor object, its private keys, raw resource handlers, or methods that accept
an arbitrary actor ID. The adapter must derive that ID from the authenticated
caller; passing a known doctor's UUID is not proof of being that doctor.

This implementation assumes a trusted single writer and a trustworthy host clock.
Host methods such as creation, presence updates, grants, enrollment, recovery and
sensor updates are privileged control-plane operations. Separate process adapters
and real security/doctor model workers are not included.

Snapshot writes and external resource effects are not a distributed transaction.
For crash-safe execution, the host needs durable action consumption before side
effects and idempotency keyed by action ID. Current replay checks protect the
running supervisor and saved/restored consumed state, not unsaved crash windows.
Checkpoint storage, key backup, durable archive delivery, host compromise, side
channels and independent attestation remain deployment responsibilities.
