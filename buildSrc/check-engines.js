#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function parseVersion(version) {
	const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
	if (!match) {
		throw new Error(`Invalid version: ${version}`)
	}
	return match.slice(1).map(Number)
}

function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return 1
		if (a[i] < b[i]) return -1
	}
	return 0
}

function matchesComparator(actual, comparator) {
	const trimmed = comparator.trim()
	if (!trimmed) return true

	const match = trimmed.match(/^(>=|<=|>|<|=)?\s*v?(\d+\.\d+\.\d+)$/)
	if (!match) {
		throw new Error(`Unsupported engine comparator: "${comparator}"`)
	}

	const op = match[1] ?? "="
	const expected = parseVersion(match[2])
	const actualParsed = parseVersion(actual)
	const cmp = compareVersions(actualParsed, expected)

	switch (op) {
		case ">":
			return cmp > 0
		case ">=":
			return cmp >= 0
		case "<":
			return cmp < 0
		case "<=":
			return cmp <= 0
		case "=":
			return cmp === 0
		default:
			throw new Error(`Unsupported comparison operator: "${op}"`)
	}
}

function matchesRange(actual, range) {
	const alternatives = range
		.split("||")
		.map((part) => part.trim())
		.filter(Boolean)

	if (alternatives.length === 0) {
		throw new Error(`Invalid engine range: "${range}"`)
	}

	return alternatives.some((alternative) => {
		const comparators = alternative.split(/\s+/).filter(Boolean)
		return comparators.every((comparator) => matchesComparator(actual, comparator))
	})
}

function matchesPinnedMinorRange(actual, range) {
	const trimmedRange = range.trim()
	const singleLowerBound = trimmedRange.match(/^>=\s*v?(\d+\.\d+\.\d+)$/)
	if (!singleLowerBound) {
		return null
	}

	const actualParsed = parseVersion(actual)
	const expected = parseVersion(singleLowerBound[1])
	const hasSameMajorMinor = actualParsed[0] === expected[0] && actualParsed[1] === expected[1]

	if (!hasSameMajorMinor) {
		return false
	}

	return compareVersions(actualParsed, expected) >= 0
}

function checkEngine(name, expectedRange, actualVersion) {
	if (!expectedRange) {
		return
	}

	const strictNodeMatch = name === "node" ? matchesPinnedMinorRange(actualVersion, expectedRange) : null
	const isCompatible = strictNodeMatch ?? matchesRange(actualVersion, expectedRange)

	if (!isCompatible) {
		console.error(`\n❌ ${name} version is incompatible.`)
		console.error(`Required (${name}): ${expectedRange}`)
		console.error(`Current  (${name}): ${actualVersion.replace(/^v/, "")}`)
		if (name === "node" && strictNodeMatch !== null) {
			const [major, minor] = parseVersion(expectedRange.replace(/^>=\s*v?/, ""))
			console.error(`Expected a ${major}.${minor}.x runtime (same minor as the baseline).`)
		}
		process.exitCode = 1
	}
}

function main() {
	const rootPackagePath = resolve(import.meta.dirname, "..", "package.json")
	const packageJson = JSON.parse(readFileSync(rootPackagePath, "utf8"))
	const engines = packageJson.engines ?? {}
	const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()
	const nodeVersion = process.version

	try {
		checkEngine("node", engines.node, nodeVersion)
		checkEngine("npm", engines.npm, npmVersion)
	} catch (error) {
		console.error(`\n❌ Unable to evaluate engine constraints: ${error.message}`)
		process.exit(1)
	}

	if (process.exitCode) {
		process.exit(process.exitCode)
	}

	console.log(`✅ Engine check passed (node ${nodeVersion}, npm ${npmVersion})`)
}

main()
