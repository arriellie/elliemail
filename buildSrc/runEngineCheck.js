import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

export function runEngineCheck() {
	execFileSync(process.execPath, [resolve(import.meta.dirname, "check-engines.js")], { stdio: "inherit" })
}
