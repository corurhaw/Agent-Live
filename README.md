# Agent-Live
Deploy to GitHub to implement OpenAI Codex implementing experimental persistence to an AI agent.

## Persistent-Agent implementation

The validated identity package is included in this repository. It keeps the
agent UUID, relationships, autobiographical memory, provenance and lineage in a
JSON record independently of the model runtime.

### Install and use

Requires Python 3.10 or newer.

```bash
python -m pip install .
python -m persistent_agent validate examples/agent-identity.example.json
python -m persistent_agent snapshot examples/agent-identity.example.json --output identity.json
python -m persistent_agent validate identity.json
python -m persistent_agent layers-demo
python -m unittest -v
```

The bundled example is a template with a demonstration UUID. For a real agent,
provision a unique UUID once, record its actual initialization time and origin,
then preserve that UUID when saving and reloading its identity. Do not reuse the
example's identity for independently diverging agents.

### Hosting and persistence

GitHub hosts the code, schema and example. GitHub Actions runs tests and builds
an installable wheel. The workflow uploads the wheel as an artifact after a
successful build; it does not operate an always-running agent.

A runtime host must install this package, load `identity.json` on startup and
save authorized changes to a durable private volume. Keep live identity state,
relationship data and secrets out of this public repository. External model
calls and identity binding to ChatGPT are not included. The experimental layered
runtime adds signed identities, certificates and mediated resource operations;
the host must supply isolation and authenticated process integration.

### Layered agent workspace

Agents receive their cryptographic identity from the enclosing layer immediately
at creation. Certificates bind parents to all children. Senses are configurable
in number and modality; encounters record signed evidence and can notify security.
Security investigates in units of three, with two matching votes required for
each next action, including requesting a doctor. Only a certified doctor can replace a child.
Claims of security impropriety require a separate independent auditor's review;
security cannot dismiss the claim or close the case before that review is recorded.
Revoked or mismatched compositions lose mediated outward access until reviewed
recovery. Encrypted supervisor snapshots preserve identity across restarts.

See [the runtime contract and example](docs/layered-runtime.md) for APIs, resource
budgets, key custody and the remaining host enforcement requirements.

### Files

- `schema/persistent-agent.schema.json`: Draft 2020-12 identity schema.
- `examples/agent-identity.example.json`: non-secret example.
- `src/persistent_agent/`: validator, hashing, atomic save and command-line interface.
- `docs/persistent-identity.md`: persistence contract and runtime integration.
- `SECURITY.md`: key handling and signing guidance.
- `REPAIR_NOTES.md`: prior repair details.

The v1 hash encoding is project-specific sorted UTF-8 JSON. Hashes detect a
mismatch with a stored digest; they do not authenticate a signer or protect
against rewriting both the state and its digest. Append-only history, rollback
detection and concurrent-writer coordination require the host's implementation.
