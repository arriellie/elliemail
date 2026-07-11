# Update the fork from the newest upstream release

The fork tracks the newest three-part versioned `tutanota-release-*` tag (for example, `354.260707.0`) published by
upstream, rather than unreleased `upstream/master`. Older timestamp-style and legacy tags are ignored.

Start from a clean `master` that exactly matches `origin/master` and run:

```sh
./fork-maintenance/update-from-upstream-release.sh
```

The helper performs the complete update:

1. Fetches upstream tags and selects the newest release by version.
2. Treats that published production tag as the qualified upstream baseline.
3. Creates a timestamped safety branch and rebases the fork onto the release.
4. Checks required tool versions, initializes submodules, installs locked dependencies, builds an unpacked custom desktop
   release through the same `desktop.js` release path used by upstream, type-checks it, and runs the test suite.
5. Pauses while you launch the rebased build and manually verify login, mailbox loading, and basic send/receive behavior.
6. Fetches again, refuses to continue if a newer release appeared, and publishes with an exact force-with-lease after you
   type `publish`.

If the rebase stops for conflicts, resolve them and run `git rebase --continue` until it completes. The helper prints a
command in this form to resume validation and publication:

```sh
./fork-maintenance/update-from-upstream-release.sh --finish <release-tag>
```

Use `git rebase --abort` to abandon a conflicted rebase. Keep the generated
`backup/master-before-upstream-rebase-*` branch until the published build is verified. Then remove it deliberately:

```sh
git branch -D <backup-branch>
```
