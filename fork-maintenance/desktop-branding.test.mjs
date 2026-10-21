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
			assert.equal(config.build.mac.identity, process.env.ELLIE_MAC_SIGNING_IDENTITY || "-")
			assert.equal(config.build.appId, "io.arrie.elliemail" + nameSuffix)
		})
	}
}

test("an explicit local signing identity requires successful signing", async () => {
	const previous = process.env.ELLIE_MAC_SIGNING_IDENTITY
	try {
		process.env.ELLIE_MAC_SIGNING_IDENTITY = "Local certificate"
		const config = await generateTemplate({
			app: "mail",
			nameSuffix: "",
			version: "1.0.0",
			updateUrl: "",
			iconPath: "resources/icon.png",
			sign: false,
			unpacked: true,
			architecture: "arm64",
		})
		assert.equal(config.build.mac.identity, "Local certificate")
		assert.equal(config.build.forceCodeSigning, true)
	} finally {
		if (previous === undefined) delete process.env.ELLIE_MAC_SIGNING_IDENTITY
		else process.env.ELLIE_MAC_SIGNING_IDENTITY = previous
	}
})
