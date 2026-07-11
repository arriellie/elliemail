#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const EMCC_BASELINE_VERSION = [3, 1, 59]
const MIN_CARGO_VERSION = [1, 80, 0]
const args = new Set(process.argv.slice(2))

function getBinaryName(command) {
	return process.platform === "win32" ? `${command}.exe` : command
}

function formatVersion(version) {
	return version.join(".")
}

function parseVersion(text, label) {
	const match = text.match(/\b(\d+)\.(\d+)(?:\.(\d+))?\b/)
	if (!match) {
		throw new Error(`Unable to parse ${label} version from output:\n${text.trim() || "(empty output)"}`)
	}

	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return 1
		if (a[i] < b[i]) return -1
	}
	return 0
}

function runCommand(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})

	if (result.error) {
		throw new Error(`Unable to run ${command}: ${result.error.message}`)
	}

	if (result.status !== 0) {
		const output = `${result.stdout}${result.stderr}`.trim()
		throw new Error(`${command} exited with code ${result.status}${output ? `:\n${output}` : ""}`)
	}

	return `${result.stdout}${result.stderr}`.trim()
}

function runEngineCheck() {
	const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "check-engines.js")], {
		stdio: "inherit",
	})

	if (result.error) {
		throw new Error(`Unable to run engine check: ${result.error.message}`)
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1)
	}
}

function checkEmcc() {
	const output = runCommand("emcc", ["--version"])
	const version = parseVersion(output, "emcc")

	if (version[0] !== EMCC_BASELINE_VERSION[0] || version[1] !== EMCC_BASELINE_VERSION[1]) {
		throw new Error(
			`Unsupported emcc version: ${formatVersion(version)}. Expected ${EMCC_BASELINE_VERSION[0]}.${EMCC_BASELINE_VERSION[1]}.x (baseline ${formatVersion(EMCC_BASELINE_VERSION)}).`,
		)
	}

	console.log(`✅ emcc check passed (${formatVersion(version)}, baseline ${formatVersion(EMCC_BASELINE_VERSION)})`)
}

function checkWasm2js() {
	runCommand("wasm2js", ["--version"])
	console.log("✅ wasm2js check passed")
}

function checkCargo() {
	const output = runCommand("cargo", ["--version"])
	const version = parseVersion(output, "cargo")

	if (compareVersions(version, MIN_CARGO_VERSION) < 0) {
		throw new Error(`Unsupported cargo version: ${formatVersion(version)}. Expected >= ${formatVersion(MIN_CARGO_VERSION)}.`)
	}

	console.log(`✅ cargo check passed (${formatVersion(version)})`)
}

function getAndroidSdkDir() {
	if (process.env.ANDROID_HOME) {
		return { path: process.env.ANDROID_HOME, source: "ANDROID_HOME" }
	}

	if (process.env.ANDROID_SDK_ROOT) {
		return { path: process.env.ANDROID_SDK_ROOT, source: "ANDROID_SDK_ROOT" }
	}

	const localPropertiesPath = resolve(import.meta.dirname, "..", "app-android", "local.properties")
	if (!existsSync(localPropertiesPath)) {
		return null
	}

	const localProperties = readFileSync(localPropertiesPath, "utf8")
	const match = localProperties.match(/^sdk\.dir=(.+)$/m)
	if (!match) {
		return null
	}

	return {
		path: match[1].trim().replace(/\\:/g, ":").replace(/\\\\/g, "\\"),
		source: "app-android/local.properties",
	}
}

function checkJava() {
	if (process.env.JAVA_HOME) {
		const javaHomeBin = resolve(process.env.JAVA_HOME, "bin")
		if (!existsSync(resolve(javaHomeBin, getBinaryName("java"))) || !existsSync(resolve(javaHomeBin, getBinaryName("javac")))) {
			throw new Error(`JAVA_HOME is set but does not contain java/javac binaries: ${process.env.JAVA_HOME}`)
		}
	}

	const output = runCommand("javac", ["-version"])
	const version = parseVersion(output, "javac")
	console.log(`✅ JDK check passed (javac ${formatVersion(version)})`)
}

function checkAndroidSdk() {
	const sdkDir = getAndroidSdkDir()
	if (!sdkDir) {
		throw new Error("Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT, or configure app-android/local.properties.")
	}

	if (!existsSync(sdkDir.path)) {
		throw new Error(`Android SDK directory does not exist (${sdkDir.source}): ${sdkDir.path}`)
	}

	console.log(`✅ Android SDK check passed (${sdkDir.path} via ${sdkDir.source})`)
}

function main() {
	const isAndroid = args.has("android") || args.has("--android")

	if (args.has("--help") || args.has("-h")) {
		console.log("Usage: node buildSrc/preflight.js [android]")
		return
	}

	runEngineCheck()
	checkEmcc()
	checkWasm2js()
	checkCargo()

	if (isAndroid) {
		checkJava()
		checkAndroidSdk()
	}

	console.log(`✅ Preflight passed${isAndroid ? " (android)" : ""}`)
}

try {
	main()
} catch (error) {
	console.error(`\n❌ Preflight failed: ${error.message}`)
	process.exit(1)
}
