"""Offline experiment commands for Agent-Live's existing identity package."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from persistent_agent import IdentityRecord, IdentityValidationError


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def event(summary, kind="experiment_note"):
    return dict(event_id=str(uuid4()), timestamp=now(), event_type=kind,
                participants=[], summary=summary, source_refs=[], memory_hash=None,
                signed_by_agent=False, confidence=1.0, salience=1.0)


@contextmanager
def locked(folder):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (folder / ".lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def initialize(folder, name):
    path = folder / "identity.json"
    if path.exists():
        return IdentityRecord.load(path)
    data = deepcopy(IdentityRecord.load(ROOT / "examples/agent-identity.example.json").data)
    identity = data["agent_identity"]
    identity.update(agent_id=str(uuid4()), created_at=now(), display_name=name)
    identity["cryptographic_identity"].update(
        key_status="unsigned local experiment; no keystore configured",
        keystore_provider=None, keystore_uri=None)
    identity["runtime_binding"]["host_environment"] = "local Agent-Live sandbox"
    identity["self_model"].update(
        self_description="Local experimental identity record; no model runtime attached.",
        limitations=["No model inference, task execution, or verified signatures."])
    identity["autobiographical_memory"]["event_log"] = [event(
        "Independent local sandbox identity initialized.", "identity_initialized")]
    identity["provenance"].update(origin="local sandbox initialization",
                                    initialization_record="Created by scripts/sandbox.py")
    record = IdentityRecord(data).with_state_hash()
    record.dump(path)
    return record


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path,
                        default=Path(os.environ.get("AGENT_LIVE_STATE_DIR",
                                      str(Path.home() / "agent-live-state"))))
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="initialize once; preserve an existing identity")
    init.add_argument("--name", default="Local Experiment Agent")
    commands.add_parser("status", help="validate saved state and summarize it")
    commands.add_parser("show", help="print the complete validated record")
    remember = commands.add_parser("remember", help="save a note and back up the previous state")
    remember.add_argument("text")
    export = commands.add_parser("export", help="create a private copy without overwriting a file")
    export.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    folder = args.state_dir.expanduser().resolve()
    try:
        with locked(folder):
            if args.command == "init":
                record = initialize(folder, args.name)
            else:
                record = IdentityRecord.load(folder / "identity.json")
            if args.command == "remember":
                if not args.text.strip():
                    raise ValueError("a memory note must not be empty")
                data = deepcopy(record.data)
                identity = data["agent_identity"]
                identity["autobiographical_memory"]["event_log"].append(event(args.text))
                identity["integrity"]["previous_state_hash"] = record.state_hash()
                updated = IdentityRecord(data).with_state_hash()
                backups = folder / "snapshots"
                backups.mkdir(exist_ok=True, mode=0o700)
                record.dump(backups / (str(uuid4()) + ".json"))
                updated.dump(folder / "identity.json")
                record = updated
            if args.command == "show":
                print(json.dumps(record.data, indent=2, ensure_ascii=False))
            elif args.command == "export":
                # Exclusive creation prevents replacing an unrelated destination.
                with args.path.expanduser().open("x", encoding="utf-8") as out:
                    json.dump(record.data, out, indent=2, ensure_ascii=False, allow_nan=False)
                    out.write("\n")
                print(f"Exported validated identity to {args.path}")
            else:
                identity = record.data["agent_identity"]
                print(json.dumps(dict(agent_id=identity["agent_id"],
                                      display_name=identity["display_name"],
                                      event_count=len(identity["autobiographical_memory"]["event_log"]),
                                      state_hash=record.state_hash(),
                                      state_file=str(folder / "identity.json")), indent=2))
        return 0
    except (OSError, ValueError, IdentityValidationError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
