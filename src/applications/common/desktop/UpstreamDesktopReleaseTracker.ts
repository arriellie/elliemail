import type { App, NativeImage } from "electron"
import { BuildConfigKey, DesktopConfigKey } from "../../../platform-kit/app-env"
import type { LazyLoaded } from "../../../platform-kit/utils"
import { lang } from "../../../ui/utils/LanguageViewModel"
import type { DesktopConfig } from "./config/DesktopConfig"
import type { DesktopNotifier } from "./notifications/DesktopNotifier"

const TAG = "[UpstreamDesktopReleaseTracker]"
const GITHUB_RELEASES_URL = "https://api.github.com/repos/tutao/tutanota/releases?per_page=100"
const UPSTREAM_DESKTOP_RELEASE_TAG = /^tutanota-desktop-release-(\d+)\.(\d+)\.(\d+)$/
const UPDATE_INSTRUCTIONS_URL = "https://github.com/arriellie/elliemail/blob/master/fork-maintenance/README.md"

type IntervalID = ReturnType<typeof setInterval>
export type IntervalSetter = (fn: () => void, time?: number) => IntervalID
export type ReleaseFetch = () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type UpstreamDesktopReleaseStatus = {
	version: string
	notificationSuppressed: boolean
}

type GitHubRelease = {
	tag_name?: unknown
	draft?: unknown
	prerelease?: unknown
	published_at?: unknown
}

export function compareThreePartVersions(left: string, right: string): number {
	const leftMatch = left.match(/^(\d+)\.(\d+)\.(\d+)$/)
	const rightMatch = right.match(/^(\d+)\.(\d+)\.(\d+)$/)
	if (leftMatch == null || rightMatch == null) {
		throw new Error(`Expected three-part versions, got ${left} and ${right}`)
	}

	for (let index = 1; index <= 3; index++) {
		const difference = Number(leftMatch[index]) - Number(rightMatch[index])
		if (difference !== 0) return difference
	}
	return 0
}

export function findLatestUpstreamDesktopRelease(releases: unknown): string | null {
	if (!Array.isArray(releases)) {
		throw new Error("GitHub releases response is not an array")
	}

	let latestVersion: string | null = null
	for (const release of releases) {
		if (release == null || typeof release !== "object") continue
		const { tag_name, draft, prerelease, published_at } = release as GitHubRelease
		if (draft !== false || prerelease !== false || typeof published_at !== "string" || published_at.length === 0 || typeof tag_name !== "string") {
			continue
		}
		const match = tag_name.match(UPSTREAM_DESKTOP_RELEASE_TAG)
		if (match == null) continue

		const version = `${match[1]}.${match[2]}.${match[3]}`
		if (latestVersion == null || compareThreePartVersions(version, latestVersion) > 0) {
			latestVersion = version
		}
	}
	return latestVersion
}

/**
 * Checks upstream desktop releases for custom Ellie builds. It intentionally does not use electron-updater,
 * because the release it discovers is informational and cannot be safely installed over this fork.
 */
export class UpstreamDesktopReleaseTracker {
	private pollingInterval: IntervalID | null = null
	private checkInProgress: Promise<void> | null = null
	private trackingEnabled: boolean | null = null
	private notifiedVersion: string | null = null
	private _status: UpstreamDesktopReleaseStatus | null = null

	constructor(
		private readonly conf: DesktopConfig,
		private readonly notifier: DesktopNotifier,
		private readonly app: App,
		private readonly icon: LazyLoaded<NativeImage>,
		private readonly openExternal: (url: string) => Promise<void>,
		private readonly fetchReleases: ReleaseFetch = () => fetch(GITHUB_RELEASES_URL),
		private readonly scheduler: IntervalSetter = setInterval,
	) {}

	get status(): UpstreamDesktopReleaseStatus | null {
		return this._status
	}

	async start(): Promise<void> {
		if (!(await this.isTrackingEnabled())) {
			return
		}
		if (this.pollingInterval != null) return

		const interval = await this.conf.getConst(BuildConfigKey.pollingInterval)
		this.pollingInterval = this.scheduler(() => void this.refresh(), interval)
		await this.refresh()
	}

	/**
	 * Refreshes the status for a settings view that opens while the startup check is still in progress.
	 * Concurrent callers share one request, and non-custom builds never make a release request.
	 */
	async refresh(): Promise<void> {
		if (!(await this.isTrackingEnabled())) return
		if (this.checkInProgress != null) return this.checkInProgress

		this.checkInProgress = this.check().finally(() => {
			this.checkInProgress = null
		})
		return this.checkInProgress
	}

	stop(): void {
		if (this.pollingInterval != null) clearInterval(this.pollingInterval)
		this.pollingInterval = null
	}

	async suppressNotifications(version: string): Promise<void> {
		if (this._status?.version !== version) return
		await this.conf.setVar(DesktopConfigKey.suppressedUpstreamDesktopReleaseVersion, version)
		this._status = {
			...this._status,
			notificationSuppressed: true,
		}
	}

	async openUpdateInstructions(): Promise<void> {
		try {
			await this.openExternal(UPDATE_INSTRUCTIONS_URL)
		} catch (error) {
			console.error(TAG, "Could not open update instructions", error)
		}
	}

	private async isTrackingEnabled(): Promise<boolean> {
		if (this.trackingEnabled == null) {
			this.trackingEnabled = await this.conf.getConst(BuildConfigKey.enableUpstreamDesktopReleaseTracking)
		}
		return this.trackingEnabled ?? false
	}

	private async check(): Promise<void> {
		try {
			const response = await this.fetchReleases()
			if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}`)

			const latestVersion = findLatestUpstreamDesktopRelease(await response.json())
			if (latestVersion == null || compareThreePartVersions(latestVersion, this.app.getVersion()) <= 0) {
				this._status = null
				return
			}

			const suppressedVersion = await this.conf.getVar(DesktopConfigKey.suppressedUpstreamDesktopReleaseVersion)
			this._status = {
				version: latestVersion,
				notificationSuppressed: suppressedVersion === latestVersion,
			}

			if (!this._status.notificationSuppressed && this.notifiedVersion !== latestVersion) {
				this.notifiedVersion = latestVersion
				await this.notify(latestVersion)
			}
		} catch (error) {
			console.error(TAG, "Could not check upstream desktop releases", error)
		}
	}

	private async notify(version: string): Promise<void> {
		try {
			await this.notifier.showOneShot({
				title: lang.get("upstreamDesktopReleaseAvailable_label", { "{version}": version }),
				body: lang.get("upstreamDesktopReleaseAvailable_msg"),
				icon: await this.icon.getAsync(),
				onClick: () => this.openUpdateInstructions(),
			})
		} catch (error) {
			console.error(TAG, "Could not show upstream release notification", error)
		}
	}
}
