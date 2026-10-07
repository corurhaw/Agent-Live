# Persistent-Agent repair

The identity snapshot layer is now validated and usable from an installed Python package.
The design still supports identity, relationships, memories, provenance and lineage.

## Reproduced defects
- Missing required identity sections were accepted.
- A fork with a non-UUID parent was accepted.
- A stale stored state hash was accepted.
- The design document omitted schema_version and integrity encoding fields required by the executable record.

## Changes
- Full Draft 2020-12 validation with UUID and RFC 3339 timestamp checks.
- Forks require a valid parent, reject self-parenting, and reject a parent on generation zero.
- Stored SHA-256 state hashes are checked; deliberate rehashing clears stale signature metadata.
- Duplicate event/relationship IDs, duplicate JSON object keys and non-finite values are rejected.
- Validated snapshots save through a temporary file and atomic replacement.
- The schema ships inside the Python package, with declared validation dependencies.
- README installation, persistence and verification instructions corrected.
- Security signing instructions now match the hash encoding.
- Conceptual templates in the design document are labeled, and omitted executable fields added.

## Fresh verification
- Original example smoke test passed before repair.
- python -m unittest -v test_identity: 14 tests passed.
- Built persistent_agent-0.1.1-py3-none-any.whl.
- Installed wheel outside the source checkout: bundled schema found.
- Separate Python process restored the same UUID and state hash.
- Original example hash preserved:
  sha256:1513a95e1273ebefb523aa2beb5bb1f78688fdef13276a28b3e3c0b34d3504eb

## Limits
This provides persistent identity snapshots. A host must load the record at startup
and save authorized changes. It does not create an independent running agent,
bind ChatGPT to the record, verify cryptographic signatures, enforce an append-only
history, prevent concurrent writers, or detect a coordinated rewrite/rollback.
The session coordination label /root is separate from the durable UUID.
