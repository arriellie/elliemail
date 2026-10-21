# Maintaining the Ellie Mail fork

For an agent-assisted update, read this file and run the helper. No manual smoke test or publication confirmation is
required. The complete operation validates, publishes a GitHub Release explicitly marked **Latest**, uploads the app
and SHA-256 checksum, and installs it into `/Applications/Ellie Mail.app`.

```sh
# Cheap discovery only (no build).
./fork-maintenance/update-from-upstream-release.sh --check
# Complete unattended update; safe retries reuse matching validation checkpoints.
./fork-maintenance/update-from-upstream-release.sh
```

Report the GitHub Release link, installed app, and backup branch when finished. Inspect individual stage logs only on
failure; do not replay successful build/test logs into agent context.

## Branch and release contract

`master` is the only mutable integration branch: an immutable upstream production desktop tag followed by a small,
linear Ellie patch series. Only three-part `tutanota-desktop-release-X.Y.Z` tags are valid bases, never `upstream/master`.
Every release has an annotated `ellie-release-<upstream-version>-r<revision>` tag and a GitHub Release. Deploy/roll back
using these Ellie tags. Do not create a mirror or long-lived `release/*` branch.

The helper starts from clean `master` matching `origin/master`, fetches only relevant tags/branches, creates
`backup/master-before-upstream-rebase-<timestamp>`, and rebases the Ellie commits. It atomically pushes master and the
new tag with an exact force-with-lease. It bypasses the inherited pre-push hook, which rejects this fork's direct master
publication. Remote changes, dirty sources, merge commits, and a newer upstream release stop publication.

After the push, the helper creates a draft GitHub Release, uploads the macOS app ZIP and checksum, then publishes it
with `--latest` and verifies GitHub's Latest endpoint. An upload or install failure is an incomplete update: rerun the
same command to finish the same release without creating another revision. Published assets are never overwritten;
retries verify their SHA-256 digests. Git publication, GitHub publication, and local installation cannot be one transaction.

Installation stages and verifies the new app before replacing the installed copy. A running installed Ellie Mail receives
SIGTERM and up to 30 seconds to quit normally, then reopens after replacement. The prior bundle remains at
`/Applications/.Ellie Mail.previous.app`; installation verification failures restore it. Account data stays in its existing
location. Installation currently supports macOS; the helper fails early on other platforms or missing GitHub access.

## Validation and recovery

Validation runs environment/preflight checks, submodule sync/update, locked dependency installation, maintenance tests,
an unpacked custom desktop build, artifact branding/signature verification, mail type checking, and the full test suite.
There is no authenticated mailbox smoke-test gate. Automated checks do not establish live send/receive behavior.

```sh
# Optional preparation only; does not publish or install.
./fork-maintenance/update-from-upstream-release.sh --validate-only
# After resolving rebase conflicts with git rebase --continue:
./fork-maintenance/update-from-upstream-release.sh --finish <upstream-tag>
# Validate/publish changes already based on the latest upstream release:
./fork-maintenance/update-from-upstream-release.sh --release <upstream-tag>
# Force every validation stage to run again:
./fork-maintenance/update-from-upstream-release.sh --release <upstream-tag> --fresh
```

Matching validation checkpoints are reused by default (`--resume` remains an accepted explicit alias). They match the
commit, tools, environment, and metadata of sources, dependencies, submodules and generated outputs. Git internals and
compiler caches are excluded. Environment, preflight and signature checks always run. Successful stages keep logs and
checkpoints in the Git-local state directory; failures print only the last 60 lines. This is a local resume guard, not an
integrity attestation. ZIPs are reused when the signed app resource seal is unchanged.

```sh
git rev-parse --git-path fork-maintenance
node --test fork-maintenance/*.test.mjs
```

The captured `publication-lease` persists across interruptions; it is never silently refreshed to overwrite someone else's
work. A recorded successful atomic publication can be recovered after a crash. Otherwise inspect/reconcile remote changes
before deliberately removing the lease and starting `--release`. A killed process may leave `update.lock` or
`validation.lock`; check that no update/build is running before removing these. Use `git rebase --abort` to abandon an
upgrade. Retain the safety branch until satisfied with the installed release. Local rerere reuses recurring resolutions.

Release installs use `ELLIE_PRESERVE_VENDORED_LIBS=1 npm ci`: dependency scripts, engine checks and submodule/Nextcloud
setup run, while reviewed `libs/` snapshots remain unchanged. For intentional dependency changes, use ordinary `npm ci`,
review/commit regenerated libraries, then run the helper.

For private work, use a temporary `c-<name>` branch, keep coherent linear commits, rebase onto master and fast-forward
integrate. Never merge a PR into master. `publish-master.sh --publish` publishes an explicitly requested linear feature
integration without prompting; it does not build, create a release or install. For application updates use the release helper.
Maintenance commits can bypass inherited full-iOS formatting with `git -c core.hooksPath=/dev/null commit` after formatting
changed files and running maintenance tests; the iOS tree is unrelated to these changes.

## Stable local macOS signing and Keychain access

Run this **once** on a new Mac, accepting the macOS certificate trust/password prompt:

```sh
./fork-maintenance/setup-macos-signing.sh
```

It creates a reusable, ten-year local code-signing certificate and a dedicated keychain in
`~/Library/Application Support/Ellie Mail Signing/`. Private material/passwords stay outside Git with owner-only access.
Trust is restricted to code signing for the current user. Only Apple's signing tools receive access to the private key.
Back up this directory securely: replacing its certificate changes the app identity again.

The release helper automatically unlocks that dedicated keychain and selects the saved certificate for every build.
It fails if the selected identity cannot sign. `ELLIE_MAC_SIGNING_IDENTITY` and `CSC_KEYCHAIN` can select an existing
certificate instead. Preserve the same bundle ID, app name, certificate and credential store across releases.

The first transition from an old ad-hoc app may still ask for the login Keychain password: choose **Always Allow** for
Ellie Mail's existing Safe Storage item. Future builds with this same certificate have a stable designated requirement
and should retain that authorization. This cannot bypass macOS security or unlock a locked login keychain automatically.
Do not delete/recreate credential items or use plaintext storage to avoid a prompt.

Without a configured certificate, local builds fall back to ad-hoc signing after Electron's fuse changes, so they still
launch, but their hash-based identity changes each build. Both local signing modes are for personal use: these GitHub
assets are not Developer ID signed or notarized for public distribution.

```sh
codesign --verify --deep --strict --verbose=2 "/Applications/Ellie Mail.app"
codesign -d -r- "/Applications/Ellie Mail.app"
```
