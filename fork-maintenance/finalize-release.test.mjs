import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installApp, publishRelease } from "./finalize-release.mjs"

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "ellie-finalize-"))
	return { root }
}

test("GitHub release is created from the tag, marked Latest, and never uploads the local app", () => {
	const f = fixture()
	try {
		let release
		const calls = []
		const run = (executable, args) => {
			assert.equal(executable, "gh")
			calls.push(args)
			if (args[0] === "api")
				return JSON.stringify(args[1].endsWith("/latest") ? release : [[...(release ? [release] : [])]])
			if (args[1] === "create")
				release = {
					tag_name: "ellie-release-1.0.0-r1",
					assets: [],
					html_url: "https://example.invalid/release",
					draft: true,
				}
			if (args[1] === "edit") {
				assert.ok(args.includes("--latest"))
				release.draft = false
			}
			return ""
		}
		publishRelease("ellie-release-1.0.0-r1", run)
		publishRelease("ellie-release-1.0.0-r1", run)
		assert.equal(calls.filter((args) => args[1] === "create").length, 1)
		assert.equal(calls.some((args) => args[1] === "upload"), false)
	} finally {
		rmSync(f.root, { recursive: true, force: true })
	}
})

test("a release creation failure does not attempt publication", () => {
	const f = fixture()
	try {
		const calls = []
		assert.throws(
			() =>
				publishRelease("tag", (exe, args) => {
					calls.push(args)
					if (args[0] === "api") return "[[]]"
					if (args[1] === "create") throw new Error("create failed")
				}),
			/create failed/,
		)
		assert.equal(
			calls.some((args) => args[1] === "edit"),
			false,
		)
	} finally {
		rmSync(f.root, { recursive: true, force: true })
	}
})

test("installation stages and verifies the app, retains rollback, and restores it on failure", () => {
	const f = fixture()
	try {
		const applications = join(f.root, "Applications")
		const source = join(f.root, "build/Ellie Mail.app")
		const installed = join(applications, "Ellie Mail.app")
		for (const app of [source, installed]) {
			mkdirSync(join(app, "Contents/_CodeSignature"), { recursive: true })
			mkdirSync(join(app, "Contents/MacOS"), { recursive: true })
			writeFileSync(join(app, "Contents/MacOS/Ellie Mail"), "executable")
		}
		writeFileSync(join(source, "Contents/_CodeSignature/CodeResources"), "new app")
		writeFileSync(join(installed, "Contents/_CodeSignature/CodeResources"), "old app")
		let fail = true
		const run = (exe, args) => {
			if (exe === "ditto") cpSync(args[0], args[1], { recursive: true })
			if (exe === "codesign" && args.at(-1) === installed && fail) throw new Error("verification failed")
			return ""
		}
		assert.throws(() => installApp(source, "r1", f.root, run, applications), /verification failed/)
		assert.equal(readFileSync(join(installed, "Contents/_CodeSignature/CodeResources"), "utf8"), "old app")
		fail = false
		installApp(source, "r1", f.root, run, applications)
		assert.equal(readFileSync(join(installed, "Contents/_CodeSignature/CodeResources"), "utf8"), "new app")
		assert.ok(existsSync(join(applications, ".Ellie Mail.previous.app")))
		installApp(source, "r1", f.root, run, applications)
	} finally {
		rmSync(f.root, { recursive: true, force: true })
	}
})
