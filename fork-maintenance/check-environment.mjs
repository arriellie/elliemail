#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(process.argv[2] ?? process.cwd())
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))

function versionTuple(value) {
	const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
	if (!match) throw new Error(`Cannot parse version from: ${value}`)
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

function compare(left, right) {
	for (let index = 0; index < 3; index++) {
		if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
	}
	return 0
}

function satisfies(version, range) {
	return range.split(/\s+/).every((constraint) => {
		const match = constraint.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/)
		if (!match) throw new Error(`Unsupported engine constraint: ${constraint}`)
		const result = compare(versionTuple(version), versionTuple(match[2]))
		switch (match[1] ?? "=") {
			case ">=": return result >= 0
			case "<=": return result <= 0
			case ">": return result > 0
			case "<": return result < 0
			default: return result === 0
		}
	})
}

function commandVersion(command, args = ["--version"]) {
	const result = spawnSync(command, args, { encoding: "utf8" })
	if (result.error) throw new Error(`${command} is unavailable: ${result.error.message}`)
	if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
	return `${result.stdout}${result.stderr}`.trim()
}

const nodeVersion = process.version.slice(1)
const npmVersion = commandVersion("npm")
if (!satisfies(nodeVersion, packageJson.engines.node)) {
	throw new Error(`Node ${nodeVersion} does not satisfy ${packageJson.engines.node}`)
}
if (!satisfies(npmVersion, packageJson.engines.npm)) {
	throw new Error(`npm ${npmVersion} does not satisfy ${packageJson.engines.npm}`)
}

const emccVersion = commandVersion("emcc")
const wasm2jsVersion = commandVersion("wasm2js")
const cargoVersion = commandVersion("cargo")
if (compare(versionTuple(cargoVersion), [1, 80, 0]) < 0) {
	throw new Error(`Cargo ${cargoVersion} is older than 1.80.0`)
}

console.log(`Environment passed: Node ${nodeVersion}, npm ${npmVersion}`)
console.log(`Environment passed: ${emccVersion.split("\n")[0]}`)
console.log(`Environment passed: ${wasm2jsVersion.split("\n")[0]}`)
console.log(`Environment passed: ${cargoVersion.split("\n")[0]}`)
