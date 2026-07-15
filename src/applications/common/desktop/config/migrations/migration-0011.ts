import type { ConfigMigration } from "../ConfigCommon"

export const migrateClient: ConfigMigration = async function (oldConfig) {
	Object.assign(oldConfig, {
		desktopConfigVersion: 11,
		suppressedUpstreamDesktopReleaseVersion: null,
	})
}

export const migrateAdmin: ConfigMigration = async function (oldConfig) {
	Object.assign(oldConfig, {
		desktopConfigVersion: 11,
	})
}
