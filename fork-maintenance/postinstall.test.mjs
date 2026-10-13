import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, delimiter } from "node:path"
import { spawnSync } from "node:child_process"

test("release installs preserve vendored libraries while keeping the other postinstall tasks", () => {
	const root = mkdtempSync(join(tmpdir(), "ellie-postinstall-"))
	try {
		for (const path of ["buildSrc", "node_modules/rollup", "src/plugin-kit/plugins/nextcloud", "bin", "libs"])
			mkdirSync(join(root, path), { recursive: true })
		writeFileSync(
			join(root, "buildSrc/postinstall.js"),
			readFileSync(new URL("../buildSrc/postinstall.js", import.meta.url)),
		)
		writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
		writeFileSync(
			join(root, "node_modules/rollup/package.json"),
			JSON.stringify({ type: "module", main: "index.js" }),
		)
		writeFileSync(join(root, "node_modules/rollup/index.js"), "export {}")
		writeFileSync(
			join(root, "buildSrc/updateLibs.js"),
			"import {writeFileSync} from 'node:fs'; export async function updateLibs() { writeFileSync('libs/snapshot', 'regenerated'); }",
		)
		for (const command of ["npm", "git"])
			writeFileSync(
				join(root, "bin", command),
				`#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> "$ELLIE_POSTINSTALL_TEST_LOG"\nprintf '{}\\n'\n`,
				{ mode: 0o755 },
			)
		const log = join(root, "calls.log")
		for (const [flag, expected] of [
			["1", "audited"],
			["", "regenerated"],
		]) {
			writeFileSync(join(root, "libs/snapshot"), "audited")
			writeFileSync(log, "")
			const result = spawnSync(process.execPath, ["buildSrc/postinstall.js"], {
				cwd: root,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: join(root, "bin") + delimiter + process.env.PATH,
					ELLIE_POSTINSTALL_TEST_LOG: log,
					ELLIE_PRESERVE_VENDORED_LIBS: flag,
				},
			})
			assert.equal(result.status, 0, result.stderr)
			assert.equal(readFileSync(join(root, "libs/snapshot"), "utf8"), expected)
			assert.match(readFileSync(log, "utf8"), /npm list --json/)
			assert.match(readFileSync(log, "utf8"), /git submodule update --init/)
			assert.match(readFileSync(log, "utf8"), /npm ci/)
			assert.equal(
				JSON.parse(readFileSync(join(root, "node_modules/.npm-deps-resolved"), "utf8")).constructor,
				Object,
			)
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
