import o, { spy } from "@tutao/otest"
import type { App, NativeImage } from "electron"
import { delay, downcast, LazyLoaded } from "../../../src/platform-kit/utils"
import {
	UpstreamDesktopReleaseTracker,
	compareThreePartVersions,
	findLatestUpstreamDesktopRelease,
} from "../../../src/applications/common/desktop/UpstreamDesktopReleaseTracker"
import type { DesktopConfig } from "../../../src/applications/common/desktop/config/DesktopConfig"
import type { DesktopNotifier } from "../../../src/applications/common/desktop/notifications/DesktopNotifier"
import { lang } from "../../../src/ui/utils/LanguageViewModel"
import en from "../../../src/ui/translations/en"

lang.init(en)

const releases = (version: string) => [
	{
		tag_name: `tutanota-desktop-release-${version}`,
		draft: false,
		prerelease: false,
		published_at: "2026-07-15T12:00:00Z",
	},
]

o.spec("UpstreamDesktopReleaseTracker", function () {
	o.test("selects the latest published upstream desktop release", function () {
		o(compareThreePartVersions("355.260710.0", "354.260707.0")).equals(1)
		o(compareThreePartVersions("354.260707.0", "354.260707.0")).equals(0)
		o(
			findLatestUpstreamDesktopRelease([
				{ tag_name: "tutanota-release-999.0.0", draft: false, prerelease: false, published_at: "2026-07-15" },
				{ tag_name: "tutanota-desktop-release-999.0.0", draft: "false", prerelease: false, published_at: "2026-07-15" },
				{ tag_name: "tutanota-desktop-release-356.0.0", draft: true, prerelease: false, published_at: "2026-07-15" },
				{ tag_name: "tutanota-desktop-release-357.0.0", draft: false, prerelease: true, published_at: "2026-07-15" },
				{ tag_name: "tutanota-desktop-release-355.260710.0", draft: false, prerelease: false, published_at: "2026-07-15" },
				{ tag_name: "tutanota-desktop-release-354.260707.0", draft: false, prerelease: false, published_at: "2026-07-15" },
			]),
		).equals("355.260710.0")
	})

	o.test("notifies once per launch, preserves status after failures, and re-enables notification for a newer release", async function () {
		let enabled = true
		let suppressedVersion: string | null = null
		let response: unknown = releases("355.260710.0")
		let scheduledCheck: (() => void) | null = null
		const notifier = downcast<DesktopNotifier>({
			showOneShot: spy(async () => {}),
		})
		const conf = downcast<DesktopConfig>({
			getConst: async (key: string) => {
				switch (key) {
					case "enableUpstreamDesktopReleaseTracking":
						return enabled
					case "pollingInterval":
						return 1
					default:
						throw new Error(`Unexpected const ${key}`)
				}
			},
			getVar: async (key: string) => {
				if (key === "suppressedUpstreamDesktopReleaseVersion") return suppressedVersion
				throw new Error(`Unexpected var ${key}`)
			},
			setVar: async (key: string, value: string) => {
				if (key !== "suppressedUpstreamDesktopReleaseVersion") throw new Error(`Unexpected set ${key}`)
				suppressedVersion = value
			},
		})
		const tracker = new UpstreamDesktopReleaseTracker(
			conf,
			notifier,
			downcast<App>({ getVersion: () => "354.260707.0" }),
			downcast<LazyLoaded<NativeImage>>({ getAsync: async () => downcast<NativeImage>({}) }),
			async () => {},
			async () => {
				if (response instanceof Error) throw response
				return { ok: true, status: 200, json: async () => response }
			},
			(fn) => {
				scheduledCheck = fn
				return downcast<ReturnType<typeof setInterval>>(1)
			},
		)

		await tracker.start()
		o(tracker.status).deepEquals({ version: "355.260710.0", notificationSuppressed: false })
		o(notifier.showOneShot.callCount).equals(1)

		await scheduledCheck!()
		await delay(1)
		o(notifier.showOneShot.callCount).equals(1)

		response = new Error("offline")
		await scheduledCheck!()
		await delay(1)
		o(tracker.status).deepEquals({ version: "355.260710.0", notificationSuppressed: false })

		await tracker.suppressNotifications("355.260710.0")
		o(suppressedVersion as string | null).equals("355.260710.0")
		o(tracker.status).deepEquals({ version: "355.260710.0", notificationSuppressed: true })

		response = releases("356.260715.0")
		await scheduledCheck!()
		await delay(1)
		o(tracker.status).deepEquals({ version: "356.260715.0", notificationSuppressed: false })
		o(notifier.showOneShot.callCount).equals(2)
		tracker.stop()
	})

	o.test("does not fetch when the packaged build flag is disabled", async function () {
		const fetchReleases = spy(async () => ({ ok: true, status: 200, json: async () => releases("355.260710.0") }))
		const tracker = new UpstreamDesktopReleaseTracker(
			downcast<DesktopConfig>({ getConst: async () => false }),
			downcast<DesktopNotifier>({}),
			downcast<App>({ getVersion: () => "354.260707.0" }),
			downcast<LazyLoaded<NativeImage>>({}),
			async () => {},
			fetchReleases,
		)

		await tracker.start()
		await tracker.refresh()
		o(fetchReleases.callCount).equals(0)
	})

	o.test("shares the startup check with a settings refresh", async function () {
		let resolveFetch: (() => void) | null = null
		const fetchReleases = spy(
			() =>
				new Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>((resolve) => {
					resolveFetch = () => resolve({ ok: true, status: 200, json: async () => releases("355.260710.0") })
				}),
		)
		const tracker = new UpstreamDesktopReleaseTracker(
			downcast<DesktopConfig>({
				getConst: async (key: string) => (key === "enableUpstreamDesktopReleaseTracking" ? true : 1),
				getVar: async () => null,
			}),
			downcast<DesktopNotifier>({ showOneShot: async () => {} }),
			downcast<App>({ getVersion: () => "354.260707.0" }),
			downcast<LazyLoaded<NativeImage>>({ getAsync: async () => downcast<NativeImage>({}) }),
			async () => {},
			fetchReleases,
			() => downcast<ReturnType<typeof setInterval>>(1),
		)

		const starting = tracker.start()
		const refreshing = tracker.refresh()
		await delay(1)
		o(fetchReleases.callCount).equals(1)
		resolveFetch!()
		await Promise.all([starting, refreshing])
		o(tracker.status).deepEquals({ version: "355.260710.0", notificationSuppressed: false })
	})
})
