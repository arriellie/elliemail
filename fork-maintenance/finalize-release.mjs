#!/usr/bin/env node

import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { artifact } from "./validation.mjs"

function command(executable, args, options = {}) {
	const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options })
	if (result.error || result.status !== 0)
		throw new Error(`${executable} ${args[0]} failed: ${result.error?.message ?? result.stderr}`)
	return result.stdout.trim()
}

function appSeal(path) {
	return createHash("sha256")
		.update(readFileSync(join(path, "Contents/_CodeSignature/CodeResources")))
		.update(readFileSync(join(path, "Contents/MacOS/Ellie Mail")))
		.digest("hex")
}

// Draft first, upload before publishing, explicitly mark Latest. All steps are retryable.
export function publishRelease(tag, archive, checksum, run = command) {
	const releases = JSON.parse(run("gh", ["api", "repos/{owner}/{repo}/releases", "--paginate", "--slurp"]))
	const existing = releases.flat().find((release) => release.tag_name === tag)
	if (!existing) run("gh", ["release", "create", tag, "--verify-tag", "--draft", "--title", tag, "--notes-from-tag"])
	// Existing published assets may be immutable. Never replace them on a retry.
	for (const path of [archive, checksum]) {
		const name = path.split("/").at(-1)
		const asset = existing?.assets.find((asset) => asset.name === name)
		const digest = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
		if (asset && asset.digest !== digest)
			throw new Error(
				`Published asset ${name} has a different or unavailable checksum; refusing to install a different build`,
			)
		if (!asset) run("gh", ["release", "upload", tag, path])
	}
	run("gh", ["release", "edit", tag, "--draft=false", "--prerelease=false", "--latest"])
	const latest = JSON.parse(run("gh", ["api", "repos/{owner}/{repo}/releases/latest"]))
	if (latest.tag_name !== tag) throw new Error(`GitHub Latest release is ${latest.tag_name}, expected ${tag}`)
	console.log(`GitHub Latest release: ${latest.html_url}`)
}

// Copy and verify before touching the installed app. Retain the previous app for rollback.
export function installApp(source, tag, directory, run = command, applications = "/Applications") {
	const destination = join(applications, "Ellie Mail.app")
	const staging = join(applications, ".Ellie Mail.update.app")
	const previous = join(applications, ".Ellie Mail.previous.app")
	const receipt = join(directory, "installed.json")
	try {
		if (existsSync(receipt) && existsSync(destination)) {
			const installed = JSON.parse(readFileSync(receipt, "utf8"))
			if (installed.tag === tag && appSeal(source) === appSeal(destination)) {
				run("codesign", ["--verify", "--deep", "--strict", destination])
				console.log(`Already installed: ${destination}`)
				return
			}
		}
	} catch {
		// Repair an incomplete receipt or damaged installed bundle by staging a fresh copy.
	}

	rmSync(staging, { recursive: true, force: true })
	run("ditto", [source, staging])
	run("codesign", ["--verify", "--deep", "--strict", staging])
	// Quit only this installed main process. Wait for its normal shutdown; never kill it mid-write.
	const executable = join(destination, "Contents/MacOS/Ellie Mail")
	const pids = run("ps", ["-axo", "pid=,comm="])
		.split("\n")
		.flatMap((line) => {
			const match = line.trim().match(/^(\d+)\s+(.*)$/)
			return match?.[2] === executable ? [Number(match[1])] : []
		})
	for (const pid of pids) process.kill(pid, "SIGTERM")
	const started = Date.now()
	for (const pid of pids) {
		while (true) {
			try {
				process.kill(pid, 0)
			} catch (error) {
				if (error.code === "ESRCH") break
				throw error
			}
			if (Date.now() - started > 30000) throw new Error("Ellie Mail did not quit; installation stopped safely")
			// Short synchronous wait in this standalone installer, not an agent wait.
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
		}
	}
	// A previous interrupted rename may have left only the backup. Preserve it.
	if (existsSync(destination)) {
		rmSync(previous, { recursive: true, force: true })
		renameSync(destination, previous)
	}
	try {
		renameSync(staging, destination)
		run("codesign", ["--verify", "--deep", "--strict", destination])
	} catch (error) {
		rmSync(destination, { recursive: true, force: true })
		if (existsSync(previous)) renameSync(previous, destination)
		throw error
	}
	writeFileSync(receipt, JSON.stringify({ tag, destination, seal: appSeal(destination) }) + "\n")
	if (pids.length) run("open", [destination])
	console.log(`Installed: ${destination}; rollback copy: ${previous}`)
}

function main() {
	const [tag] = process.argv.slice(2)
	if (process.platform !== "darwin") throw new Error("Automatic Applications deployment currently requires macOS")
	accessSync("/Applications", constants.W_OK)
	command("gh", ["api", "repos/{owner}/{repo}", "--jq", ".full_name"])
	if (tag === "--preflight") return
	if (!/^ellie-release-\d+\.\d+\.\d+-r\d+$/.test(tag ?? "")) throw new Error("Expected an Ellie release tag")
	const root = command("git", ["rev-parse", "--show-toplevel"])
	const head = command("git", ["rev-parse", `${tag}^{commit}`])
	command("git", ["merge-base", "--is-ancestor", head, "HEAD"])
	command("git", ["diff", "--quiet", head, "HEAD", "--", ".", ":(exclude)fork-maintenance"])
	const directory = resolve(root, command("git", ["rev-parse", "--git-path", "fork-maintenance"]))

	const app = artifact(root)
	command("codesign", ["--verify", "--deep", "--strict", app])
	const output = join(directory, "releases", tag)
	mkdirSync(output, { recursive: true })
	const archive = join(output, `${tag}-mac-${process.arch}.zip`)
	const checksum = `${archive}.sha256`
	const packaged = join(output, "packaged.json")
	// HEAD is immutable here; avoid recompressing the same validated build on retries.
	const seal = appSeal(app)
	let packageState
	try {
		packageState = JSON.parse(readFileSync(packaged, "utf8"))
	} catch {
		/* First package. */
	}
	if (packageState?.head !== head || packageState?.seal !== seal || !existsSync(archive) || !existsSync(checksum)) {
		const receipt = JSON.parse(readFileSync(join(directory, "validation.json"), "utf8"))
		if (receipt.head !== head || !receipt.completed.includes("tests"))
			throw new Error("Cached release artifact changed or is missing; validate a new release before packaging")
		const temporary = `${archive}.tmp.zip`
		rmSync(temporary, { force: true })
		command("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, temporary])
		renameSync(temporary, archive)
		const digest = command("shasum", ["-a", "256", archive]).split(/\s/)[0]
		writeFileSync(checksum, `${digest}  ${archive.split("/").at(-1)}\n`)
		writeFileSync(packaged, JSON.stringify({ head, seal }) + "\n")
	}
	publishRelease(tag, archive, checksum)
	installApp(app, tag, directory)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main()
	} catch (error) {
		console.error(`Error: ${error.message}`)
		process.exitCode = 1
	}
}
