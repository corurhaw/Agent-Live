# Agent-Live on iPadOS

This package is an on-device experiment environment for the actual Agent-Live
identity implementation, based on repository commit
`40c751a4b10ab3e169e6e6c3b6c50ec762353cb5` with a sandbox command and tests added.
It contains Alpine Linux 3.22.6 for x86, Python 3.12.15, dependencies, Git, and
the Nano editor. No account, API key, server subscription, or package download
is required for the included experiments.

## Install on the iPad

1. Install **iSH Shell** from
   <https://apps.apple.com/us/app/ish-shell/id1436902243>.
2. Save `Agent-Live-iPadOS-Sandbox.zip` to the Files app and tap it to extract
   the folder. Keep the contained `Agent-Live-iSH.tar.gz` compressed.
3. In iSH, open the gear menu, choose **Filesystems**, then **Import**. Select
   `Agent-Live-iSH.tar.gz` in Files. Import this as a separate filesystem.
4. Select the imported filesystem and choose **Boot From This Filesystem**.
   Reopen iSH if it closes during the switch.
5. At the shell prompt, run the commands below. `agent-live init` creates a
   new UUID on your device; running it again preserves existing state.

The import mechanism is documented by iSH:
<https://github.com/ish-app/ish/wiki/Install-&-Activate-Alternate-Filesystems>.

## First experiment

```sh
agent-live init --name "Jonathan's Experiment Agent"
agent-live remember "First local persistence experiment on my iPad."
agent-live status
```

Close iSH and reopen it. Run `agent-live status` again: the UUID, event count,
and state hash should match the prior output. You can perform these steps in
airplane mode after installing iSH and downloading the package.

## Commands and files

| Command | Behavior |
| --- | --- |
| `agent-live init` | Create an independent identity once; preserve it on later calls. |
| `agent-live remember "a note"` | Append a note, save a validated snapshot, and back up the previous state. |
| `agent-live status` | Validate stored state and show UUID, event count, and hash. |
| `agent-live show` | Print the full validated JSON record. |
| `agent-live export /root/experiment-copy.json` | Create a copy; refuse to overwrite an existing destination. |
| `agent-live-tests` | Run all 20 project and sandbox tests without using your live experiment state. |

Source code is at `/root/Agent-Live`. Experiment state is at
`/root/agent-live-state/identity.json`; previous snapshots are in the sibling
`snapshots` directory. State is separate from source and is not pushed to
GitHub. Keep copies of important state outside iSH before deleting the app or
its filesystem. Copying a saved identity continues that identity; run `init`
against a new empty state directory to provision an independent experiment.

For a second independent experiment:

```sh
agent-live --state-dir /root/second-experiment init --name "Experiment Two"
agent-live --state-dir /root/second-experiment remember "A separate trial."
agent-live --state-dir /root/second-experiment status
```

Edit source with Nano, then rerun the checks:

```sh
cd /root/Agent-Live
nano scripts/sandbox.py
agent-live-tests
```

The existing module CLI remains available:

```sh
cd /root/Agent-Live
PYTHONPATH=src python3 -m persistent_agent validate /root/agent-live-state/identity.json
```

## Scope

This implements local identity, memory records, validation, hashes, and
save/reload experiments. Agent-Live does not yet include an LLM, an autonomous
task loop, tool execution, or an authenticated binding to this ChatGPT session.
The sandbox needs no model inference and makes no API calls.

iSH supplies an emulated Linux shell inside its iPadOS app container. The
filesystem and separate state directory organize experiments; they are
intended for trusted code rather than hostile-code execution. The tools
installed in iSH can access the network when you deliberately use them.
Saved state persists when the app stops, but the process should not be assumed
to run continuously while iPadOS suspends or terminates the app.

Snapshots and previous-state hashes help inspect experiments. They are not
signed, tamper-proof, or a verified append-only history. No cryptographic key
or external keystore is configured by this package.

## Verification

See `VERIFICATION.txt` for the exact build and test evidence. Tests were run
in a Linux workspace and through iSH's command-line emulator. A physical iPad
and its installed App Store build were not available for testing. If import
or boot fails, retain the original iSH filesystem and report the displayed
error; no changes to the original filesystem are required for this setup.
