import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { environmentIdentity, fingerprint, reusableStages } from "./validation.mjs"

test("resume invalidates checks when source, dependencies, artifacts or environment change", () => {
	const root = mkdtempSync(join(tmpdir(), "ellie-validation-"))
	try {
		for (const path of ["src", "node_modules", "artifacts", ".git", "cache"]) mkdirSync(join(root, path))
		for (const path of ["src/mail.ts", "node_modules/module.js", "artifacts/app"])
			writeFileSync(join(root, path), "original")
		const identity = ["commit", "node-version", "environment"]
		const initial = fingerprint(root, identity)
		writeFileSync(join(root, ".git/log"), "new log")
		writeFileSync(join(root, "cache/log"), "new cache")
		assert.equal(fingerprint(root, identity), initial)
		assert.notEqual(fingerprint(root, [...identity, "changed-toolchain"]), initial)
		for (const path of ["src/mail.ts", "node_modules/module.js", "artifacts/app"]) {
			const before = fingerprint(root, identity)
			utimesSync(join(root, path), new Date(0), new Date(0))
			assert.notEqual(fingerprint(root, identity), before, path)
		}
		const before = fingerprint(root, identity)
		symlinkSync("src/mail.ts", join(root, "link"))
		assert.notEqual(fingerprint(root, identity), before)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("only an explicitly resumed, matching, ordered checkpoint can skip stages", () => {
	const stages = ["dependencies", "build", "types", "tests"]
	const state = { fingerprint: "unchanged", completed: ["dependencies", "build"] }
	assert.deepEqual(reusableStages(state, "unchanged", stages, true), state.completed)
	assert.deepEqual(reusableStages(state, "changed", stages, true), [])
	assert.deepEqual(reusableStages(state, "unchanged", stages, false), [])
	assert.deepEqual(reusableStages({ ...state, completed: ["tests"] }, "unchanged", stages, true), [])
	assert.deepEqual(reusableStages(undefined, "unchanged", stages, true), [])
})

test("resume ignores agent invocation metadata but retains build environment changes", () => {
	const first = {
		CODEX_TOOL_CALL_ID: "first",
		CODEX_SESSION_ID: "one",
		FNM_MULTISHELL_PATH: "/one",
		PATH: "/one/bin:/usr/bin",
		NODE_OPTIONS: "--max-old-space-size=4096",
	}
	const second = {
		...first,
		CODEX_TOOL_CALL_ID: "second",
		CODEX_SESSION_ID: "two",
		FNM_MULTISHELL_PATH: "/two",
		PATH: "/two/bin:/usr/bin",
	}
	assert.deepEqual(environmentIdentity(first), environmentIdentity(second))
	assert.notDeepEqual(
		environmentIdentity(first),
		environmentIdentity({ ...second, NODE_OPTIONS: "--max-old-space-size=8192" }),
	)
})
