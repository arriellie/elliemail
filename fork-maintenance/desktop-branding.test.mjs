import { test } from "node:test"
import assert from "node:assert/strict"
import generateTemplate from "../buildSrc/electron-package-json-template.js"

for (const [app, baseName] of [
	["mail", "Ellie Mail"],
	["calendar", "Ellie Calendar"],
]) {
	for (const [nameSuffix, suffix] of [
		["", ""],
		["-test", " Test"],
		["-snapshot", " Dev"],
	]) {
		test(`${app}${nameSuffix}: macOS bundle and executable use ${baseName}${suffix}`, async () => {
			const config = await generateTemplate({
				app,
				nameSuffix,
				version: "1.0.0",
				updateUrl: "",
				iconPath: "resources/desktop-icons/logo-solo-red.png",
				sign: false,
				notarize: false,
				unpacked: true,
				architecture: "arm64",
			})
			assert.equal(config.build.productName, baseName + suffix)
			assert.equal(config.build.mac.executableName, baseName + suffix)
			assert.equal(config.build.mac.identity, "-")
			assert.equal(config.build.appId, "io.arrie.elliemail" + nameSuffix)
		})
	}
}
