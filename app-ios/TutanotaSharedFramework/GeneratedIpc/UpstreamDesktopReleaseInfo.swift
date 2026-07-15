/* generated file, don't edit. */


/**
 * A newer upstream Tuta desktop release detected by an Ellie custom build.
 */
public struct UpstreamDesktopReleaseInfo : Codable, Sendable {
	public init(
		version: String,
		notificationSuppressed: Bool
	) {
		self.version = version
		self.notificationSuppressed = notificationSuppressed
	}
	public let version: String
	public let notificationSuppressed: Bool
}
