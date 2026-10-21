#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

function command(command, args, root) {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
	if (result.error || result.status !== 0)
		throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`)
	return result.stdout.trim()
}

// Include ignored dependencies and generated outputs, but exclude compiler caches
// and Git internals. This is a local resume guard, not a release attestation.
export function fingerprint(root, identity) {
	const hash = createHash("sha256").update(JSON.stringify(identity))
	const caches = new Set(["cache", "target", "native-cache", ".gradle", "DerivedData"])
	function visit(directory, relative = "") {
		for (const name of readdirSync(directory).sort()) {
			if (name === ".git" || name === ".DS_Store") continue
			const path = join(directory, name)
			const item = lstatSync(path)
			const location = join(relative, name)
			if (item.isDirectory() && caches.has(name)) continue
			hash.update(
				JSON.stringify([
					location,
					item.mode,
					item.isDirectory() ? null : item.size,
					item.isDirectory() ? null : item.mtimeMs,
				]),
			)
			if (item.isSymbolicLink()) hash.update(readlinkSync(path))
			else if (item.isDirectory()) visit(path, location)
		}
	}
	visit(root)
	return hash.digest("hex")
}

export function reusableStages(state, currentFingerprint, stageNames, resume) {
	if (!resume || state?.fingerprint !== currentFingerprint) return []
	const completed = state.completed ?? []
	return completed.every((name, index) => name === stageNames[index]) ? completed : []
}

export function artifact(root) {
	const directory = join(root, "artifacts/desktop")
	if (!existsSync(directory)) throw new Error("Unpacked desktop artifact is missing")
	if (process.platform === "darwin") {
		const matches = []
		for (const folder of readdirSync(directory).filter((name) => name === "mac" || name.startsWith("mac-"))) {
			for (const app of readdirSync(join(directory, folder)).filter((name) => name.endsWith(".app")))
				matches.push(join(directory, folder, app))
		}
		if (matches.length !== 1) throw new Error(`Expected one unpacked macOS app; found ${matches.length}`)
		const expectedName = "Ellie Mail"
		const expectedPath = join(dirname(matches[0]), `${expectedName}.app`)
		if (matches[0] !== expectedPath)
			throw new Error(`Incorrect app bundle name: ${matches[0]}; expected ${expectedPath}`)
		for (const key of ["CFBundleDisplayName", "CFBundleExecutable"]) {
			const name = command(
				"/usr/libexec/PlistBuddy",
				["-c", `Print :${key}`, join(expectedPath, "Contents/Info.plist")],
				root,
			)
			if (name !== expectedName) throw new Error(`Incorrect ${key}: ${name}; expected ${expectedName}`)
		}
		if (!existsSync(join(expectedPath, "Contents/MacOS", expectedName)))
			throw new Error("Branded macOS executable is missing")
		return matches[0]
	}
	if (process.platform === "linux") {
		const path = join(directory, "linux-unpacked", "elliemail-desktop")
		if (!existsSync(path) || !(lstatSync(path).mode & 0o111))
			throw new Error(`Unpacked Linux executable is missing: ${path}`)
		return path
	}
	throw new Error(`Unsupported platform: ${process.platform}`)
}

async function runStage(root, directory, name, executable, args) {
	const log = join(directory, `${name}.log`)
	const fd = openSync(log, "w")
	const started = Date.now()
	console.log(`Running ${name} (log: ${log})`)
	const heartbeat = setInterval(
		() => console.log(`Running ${name}: ${Math.round((Date.now() - started) / 1000)}s elapsed`),
		30000,
	)
	try {
		await new Promise((resolve, reject) => {
			const child = spawn(executable, args, { cwd: root, stdio: ["ignore", fd, fd] })
			child.on("error", reject)
			child.on("exit", (code, signal) =>
				code === 0 ? resolve() : reject(new Error(`${name} failed (${signal ?? code})`)),
			)
		})
		console.log(`Passed ${name} (${Math.round((Date.now() - started) / 1000)}s)`)
	} catch (error) {
		console.error(readFileSync(log, "utf8").split("\n").slice(-60).join("\n"))
		throw new Error(`${error.message}; full log: ${log}`)
	} finally {
		clearInterval(heartbeat)
		closeSync(fd)
	}
}

async function main() {
	const args = process.argv.slice(2)
	if (args.some((arg) => arg !== "--resume"))
		throw new Error("Usage: node fork-maintenance/validation.mjs [--resume]")
	const root = command("git", ["rev-parse", "--show-toplevel"], process.cwd())
	const directory = resolve(root, command("git", ["rev-parse", "--git-path", "fork-maintenance"], root))
	mkdirSync(directory, { recursive: true })
	const lock = join(directory, "validation.lock")
	try {
		mkdirSync(lock)
	} catch {
		throw new Error(
			`Validation is already running. If interrupted, remove ${lock} after checking for running builds.`,
		)
	}
	try {
		if (command("git", ["status", "--porcelain"], root))
			throw new Error("Commit or stash source changes before validation")
		const identity = [
			command("git", ["rev-parse", "HEAD"], root),
			process.execPath,
			process.version,
			process.platform,
			process.arch,
			...Object.entries(process.env)
				.filter(([key]) => !["_", "SHLVL", "PWD", "OLDPWD", "FNM_MULTISHELL_PATH"].includes(key))
				.map(([key, value]) => [
					key,
					key === "PATH" && process.env.FNM_MULTISHELL_PATH
						? value.replaceAll(process.env.FNM_MULTISHELL_PATH, "<fnm-shell>")
						: value,
				])
				.sort(),
			...["npm", "emcc", "wasm2js", "cargo"].map((tool) => command(tool, ["--version"], root)),
		]
		const receipt = join(directory, "validation.json")
		let state
		try {
			state = JSON.parse(readFileSync(receipt, "utf8"))
		} catch {
			/* First run or interrupted state write. */
		}
		const stages = [
			["submodule-sync", "git", ["submodule", "sync", "--recursive"]],
			["submodule-update", "git", ["submodule", "update", "--init", "--recursive"]],
			["dependencies", "env", ["ELLIE_PRESERVE_VENDORED_LIBS=1", "npm", "ci"]],
			[
				"maintenance-tests",
				process.execPath,
				[
					"--test",
					"fork-maintenance/validation.test.mjs",
					"fork-maintenance/workflow.test.mjs",
					"fork-maintenance/desktop-branding.test.mjs",
					"fork-maintenance/postinstall.test.mjs",
					"fork-maintenance/finalize-release.test.mjs",
				],
			],
			["desktop-build", process.execPath, ["desktop", "release", "--custom-desktop-release", "--unpacked"]],
			["mail-types", "npm", ["run", "mail:types"]],
			["tests", "npm", ["test"]],
		]
		const completed = reusableStages(
			state,
			fingerprint(root, identity),
			stages.map(([name]) => name),
			args.includes("--resume"),
		)
		if (args.includes("--resume") && !completed.length)
			console.log("No matching checkpoint; running all validation stages.")
		// Never cache environment or signature checks, including on publication resume.
		await runStage(root, directory, "environment", process.execPath, ["fork-maintenance/check-environment.mjs"])
		await runStage(root, directory, "preflight", "npm", ["run", "check:preflight"])
		for (const [name, executable, stageArgs] of stages) {
			if (completed.includes(name))
				console.log(`Reusing ${name} (unchanged source, environment and generated files)`)
			else {
				await runStage(root, directory, name, executable, stageArgs)
				if (
					command("git", ["status", "--porcelain"], root) ||
					command("git", ["rev-parse", "HEAD"], root) !== identity[0]
				)
					throw new Error(`${name} changed source or HEAD; inspect before continuing`)
				completed.push(name)
				writeFileSync(
					`${receipt}.tmp`,
					JSON.stringify(
						{ head: identity[0], completed, fingerprint: fingerprint(root, identity) },
						null,
						2,
					) + "\n",
				)
				renameSync(`${receipt}.tmp`, receipt)
			}
			if (name === "desktop-build") {
				const path = artifact(root)
				if (process.platform === "darwin")
					await runStage(root, directory, "signatures", "codesign", [
						"--verify",
						"--deep",
						"--strict",
						"--verbose=2",
						path,
					])
				console.log(`Verified desktop artifact: ${path}`)
			}
		}
		console.log(`Automated validation passed at ${identity[0]}. Receipt: ${receipt}`)
	} finally {
		rmSync(lock, { recursive: true, force: true })
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`Error: ${error.message}`)
		process.exitCode = 1
	})
}
