import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "ellie-workflow-"))
	const root = join(directory, "fork")
	const origin = join(directory, "origin.git")
	const upstream = join(directory, "upstream.git")
	mkdirSync(root)
	function git(...args) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
		assert.equal(result.status, 0, result.stderr)
		return result.stdout.trim()
	}
	git("init", "-b", "master")
	git("config", "user.name", "Workflow test")
	git("config", "user.email", "test@example.invalid")
	git("config", "core.hooksPath", "/dev/null")
	writeFileSync(join(root, "source"), "v1")
	git("add", ".")
	git("commit", "-m", "upstream v1")
	git("tag", "tutanota-desktop-release-1.0.0")
	writeFileSync(join(root, "source"), "v2")
	git("commit", "-am", "upstream v2")
	git("tag", "tutanota-desktop-release-2.0.0")
	git("init", "--bare", upstream)
	git("remote", "add", "upstream", upstream)
	git("push", "upstream", "master", "--tags")
	git("reset", "--hard", "tutanota-desktop-release-1.0.0")
	mkdirSync(join(root, "fork-maintenance"))
	writeFileSync(
		join(root, "fork-maintenance/update-from-upstream-release.sh"),
		readFileSync(new URL("./update-from-upstream-release.sh", import.meta.url)),
	)
	writeFileSync(
		join(root, "fork-maintenance/validation.mjs"),
		`
import { spawnSync } from 'node:child_process';
if (process.env.SIMULATE_REMOTE_CHANGE) {
  const result = spawnSync('git', ['--git-dir', process.env.SIMULATE_REMOTE_CHANGE, 'update-ref', 'refs/heads/master', 'refs/tags/tutanota-desktop-release-1.0.0']);
  if (result.status !== 0) process.exit(1);
}
console.log('Fixture validation passed');
`,
	)
	writeFileSync(
		join(root, "fork-maintenance/finalize-release.mjs"),
		`
import { appendFileSync } from 'node:fs';
if (process.argv[2] !== '--preflight') {
  appendFileSync('.git/finalized', process.argv[2] + '\\n');
  if (process.env.SIMULATE_FINALIZE_FAILURE) process.exit(1);
}
`,
	)
	writeFileSync(join(root, ".gitignore"), "artifacts\n")
	git("add", ".")
	git("commit", "-m", "downstream patch")
	git("init", "--bare", origin)
	git("remote", "add", "origin", origin)
	git("push", "origin", "master", "--tags")
	mkdirSync(join(root, "artifacts/desktop/mac-arm64/Ellie Mail.app"), { recursive: true })
	mkdirSync(join(root, "artifacts/desktop/linux-unpacked"), { recursive: true })
	writeFileSync(join(root, "artifacts/desktop/linux-unpacked/elliemail-desktop"), "fixture", { mode: 0o755 })
	return {
		directory,
		root,
		origin,
		git,
		run: (args, input = "", env = {}) =>
			spawnSync("sh", ["fork-maintenance/update-from-upstream-release.sh", ...args], {
				cwd: root,
				encoding: "utf8",
				input,
				env: { ...process.env, ...env },
			}),
	}
}

test("validation-only rebases, preserves a backup and lease, and can publish on finish", () => {
	const f = fixture()
	try {
		const original = f.git("rev-parse", "HEAD")
		const validation = f.run(["--validate-only"])
		assert.equal(validation.status, 0, validation.stderr)
		assert.match(validation.stdout, /Automated validation passed/)
		assert.equal(f.git("rev-parse", "origin/master"), original)
		assert.match(f.git("branch", "--list", "backup/*"), /backup\/master-before-upstream-rebase-/)
		const publication = f.run(["--finish", "tutanota-desktop-release-2.0.0", "--resume"], "")
		assert.equal(publication.status, 0, publication.stderr)
		assert.equal(f.git("rev-parse", "origin/master"), f.git("rev-parse", "HEAD"))
		assert.equal(f.git("cat-file", "-t", "ellie-release-2.0.0-r1"), "tag")
		assert.match(
			f.git("tag", "-l", "ellie-release-2.0.0-r1", "--format=%(contents)"),
			/Upstream release: tutanota-desktop-release-2.0.0\nUpstream commit:/,
		)
		assert.match(f.run([]).stdout, /Already tagged/)
	} finally {
		rmSync(f.directory, { recursive: true, force: true })
	}
})

test("a remote change during validation stops publication without a release tag", () => {
	const f = fixture()
	try {
		const result = f.run([], "", { SIMULATE_REMOTE_CHANGE: f.origin })
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /origin\/master changed during validation/)
		assert.equal(f.git("tag", "--list", "ellie-release-*"), "")
	} finally {
		rmSync(f.directory, { recursive: true, force: true })
	}
})

test("an unfinished rebase and an invalid release cannot enter validation", () => {
	const f = fixture()
	try {
		const invalid = f.run(["--release", "master"])
		assert.notEqual(invalid.status, 0)
		assert.match(invalid.stderr, /not a production desktop release tag/)
		mkdirSync(join(f.root, ".git/rebase-merge"))
		const unfinished = f.run(["--finish", "tutanota-desktop-release-2.0.0"])
		assert.notEqual(unfinished.status, 0)
		assert.match(unfinished.stderr, /a rebase is already in progress/)
	} finally {
		rmSync(f.directory, { recursive: true, force: true })
	}
})

test("an unattended update publishes, and retries finalization without another tag", () => {
	const f = fixture()
	try {
		const first = f.run([], "", { SIMULATE_FINALIZE_FAILURE: "1" })
		assert.notEqual(first.status, 0)
		assert.equal(f.git("rev-parse", "origin/master"), f.git("rev-parse", "HEAD"))
		const retry = f.run([])
		assert.equal(retry.status, 0, retry.stderr)
		assert.equal(f.git("tag", "--list", "ellie-release-*"), "ellie-release-2.0.0-r1")
		assert.equal(
			readFileSync(join(f.root, ".git/finalized"), "utf8"),
			"ellie-release-2.0.0-r1\nellie-release-2.0.0-r1\n",
		)
	} finally {
		rmSync(f.directory, { recursive: true, force: true })
	}
})
