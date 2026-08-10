# Maintaining the Ellie Mail downstream fork

## Branch and release contract

`master` is the one mutable Ellie integration branch. It always contains a published upstream desktop production tag plus a
small, linear series of Ellie-specific commits. It is deliberately rebased onto every new upstream desktop production release
and therefore must be published with an exact force-with-lease.

Do not create a local upstream mirror or a long-lived `release/*` branch. `upstream/master` is only a remote-tracking
reference and is never an Ellie release base. The immutable `tutanota-desktop-release-X.Y.Z` tags are the only upstream bases.

Every validated Ellie build is identified by an annotated tag:

```text
ellie-release-<upstream-desktop-version>-r<revision>
```

For example, `ellie-release-354.260707.0-r1` is the first Ellie release based on
`tutanota-desktop-release-354.260707.0`. Deploy and roll back using these Ellie tags, never an untagged `master` commit.

## Private feature workflow

Start private work from the current `master` on a temporary `feature/<name>` branch. Keep each feature to one coherent
commit or a small ordered series. Before integrating it, rebase the branch onto `master`, fast-forward it into `master`,
run the relevant checks, and delete the feature branch.

Never merge a pull request into `master`: merge commits make the downstream patch series harder to replay. To publish a
linear feature integration, run this from a clean `master`:

```sh
./fork-maintenance/publish-master.sh --publish
```

The helper requires that `master` includes the current `origin/master`, rejects merge commits, prompts for confirmation,
and uses `--force-with-lease`. It bypasses only the inherited upstream pre-push hook, which does not apply to this fork.

## Upstream release workflow

Subscribe to upstream release notifications and run the update for every published upstream desktop production tag. The helper
selects the highest three-part `tutanota-desktop-release-*` tag; legacy and timestamp-style tags and unreleased
`upstream/master` are ignored.

Start from a clean `master` that exactly matches `origin/master`:

```sh
./fork-maintenance/update-from-upstream-release.sh
```

The helper fetches remotes, creates `backup/master-before-upstream-rebase-<timestamp>`, rebases the Ellie commit stack,
and runs the required environment check, submodule sync/update, locked dependency installation, unpacked custom desktop
release build, platform artifact verification, mail type check, and test suite. On macOS, artifact verification includes
strict validation of every nested code signature. It then requires `npm run check:preflight` and a manual smoke test of
login, mailbox loading, and basic send/receive behavior.

After the smoke test, it fetches again and stops if a newer upstream release appeared. When you type `publish`, it
atomically force-updates `origin/master` with its exact lease and pushes the next annotated Ellie release tag. If a
rebase stops for conflicts, resolve them, use `git rebase --continue`, and resume the validation/publication stage with:

```sh
./fork-maintenance/update-from-upstream-release.sh --finish <upstream-release-tag>
```

To validate and publish a rebuilt or otherwise already-rebased `master` without starting another rebase, use the same
gate explicitly:

```sh
./fork-maintenance/update-from-upstream-release.sh --release <upstream-release-tag>
```

Use `git rebase --abort` to abandon an upgrade. Keep the generated safety branch until the Ellie release is verified,
then delete it deliberately. Repository-local `rerere.enabled` and `rerere.autoupdate` are enabled to reuse recurring
conflict resolutions.

## macOS local signing

Electron's fuse step modifies the already-signed Electron Framework binary. A local build must therefore receive a new
signature after the fuses are changed or macOS will terminate it at launch with `SIGKILL (Code Signature Invalid)`.

The generated Electron Builder configuration handles this directly: when a release signing identity is unavailable,
`buildSrc/electron-package-json-template.js` sets `mac.identity` to `-`, Electron Builder's ad-hoc signing identity. The
normal maintenance build command needs no extra flag or separate signing command:

```sh
node desktop release --custom-desktop-release --unpacked
```

The update helper immediately runs `codesign --verify --deep --strict` on the resulting app and stops before the remaining
checks if any nested signature is invalid. An ad-hoc-signed build is suitable for local installation and smoke testing,
but it is not Developer ID signed or notarized and must not be treated as a distributable macOS release.

If an older local artifact fails to open with the code-signature error, rebuild it with the command above and replace the
copy in `/Applications`. Verify the installed copy manually with:

```sh
codesign --verify --deep --strict --verbose=2 "/Applications/Ellie Mail.app"
```
