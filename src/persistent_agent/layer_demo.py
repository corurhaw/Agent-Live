"""Offline vertical slice: birth, mediated action, encounter, isolation, recovery."""
from .layers import BoundaryError, Eye, LayerSupervisor


def run_demo() -> dict:
    host = LayerSupervisor()
    individual = host.create_agent(eyes=(Eye("front", "environment", 5),))
    child = host.create_agent(parent_id=individual.agent_id)
    host.certify(individual.agent_id)
    neighbor = host.create_agent(capabilities=("hop",))

    received = []
    host.register_resource("shared-notes", "append", received.append)
    host.grant(individual.agent_id, "shared-notes", "append")
    action = host.prepare_action(child.agent_id, "shared-notes", "append", "Hello workspace")
    host.dispatch(action)

    host.link(individual.agent_id, neighbor.agent_id, "environment", distance=2)
    observation = host.encounter(individual.agent_id, neighbor.agent_id, "front",
                                 behavior="walk", threat="simulated hostile request",
                                 defense="isolate")
    blocked = False
    try:
        host.prepare_action(child.agent_id, "shared-notes", "append", "Must be blocked")
    except BoundaryError:
        blocked = True
    host.recover(individual.agent_id, reason="Offline demonstration inspected",
                  evidence_ref="demo/inspection/1")

    unit = tuple(host.create_agent(roles=("security",),
                                   eyes=(Eye("front", "environment", 5),)) for _ in range(3))
    security = unit[0]
    doctor = host.create_agent(roles=("doctor",))
    host.set_present(child.agent_id, False)
    host.link(security.agent_id, individual.agent_id, "environment", distance=1)
    medical_encounter = host.encounter(security.agent_id, individual.agent_id, "front",
                                       behavior="idle")
    case = host.start_investigation(medical_encounter.encounter_id,
                                    tuple(member.agent_id for member in unit))
    for member in unit[:2]:
        host.vote_investigation(case.investigation_id, member.agent_id,
                                action="request_doctor", parameters=dict(
                                    reason="Missing component", evidence_ref="demo/encounter/2"))
    request = host.proceed_investigation(case.investigation_id, security.agent_id)
    replacement = host.create_agent()
    security_denied = False
    try:
        host.replace_child(individual.agent_id, child.agent_id, replacement.agent_id,
                            doctor_id=security.agent_id, reason="Attempted replacement",
                            evidence_ref="demo/inspection/2")
    except BoundaryError:
        security_denied = True
    host.replace_child(individual.agent_id, child.agent_id, replacement.agent_id,
                        doctor_id=doctor.agent_id, reason="Doctor checked replacement",
                        evidence_ref="demo/inspection/3")
    host.recover(replacement.agent_id, reason="Replacement checked",
                  evidence_ref="demo/inspection/3")
    host.recover(individual.agent_id, reason="Repaired individual checked",
                  evidence_ref="demo/inspection/4")
    host.acknowledge_doctor_request(doctor.agent_id, request.request_id)
    return dict(individual_id=individual.agent_id, fingerprint=individual.fingerprint,
                child_id=child.agent_id, child_fingerprint=child.fingerprint,
                signing_participants=[s.agent_id for s in action.signatures],
                received=received, findings=observation.findings,
                signed_observation_verified=host.verify_observation(observation),
                security_reports=len(host.pending_reports()),
                security_unit_size=len(unit), investigation_majority=2,
                isolated_action_blocked=blocked,
                security_replacement_denied=security_denied,
                doctor_replacement_completed=host.node(replacement.agent_id).parent_id == individual.agent_id,
                recovered=host.check_integrity(individual.agent_id))
