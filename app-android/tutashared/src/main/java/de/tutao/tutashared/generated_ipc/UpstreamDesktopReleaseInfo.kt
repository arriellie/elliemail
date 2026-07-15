/* generated file, don't edit. */


package de.tutao.tutashared.ipc

import kotlinx.serialization.*
import kotlinx.serialization.json.*


/**
 * A newer upstream Tuta desktop release detected by an Ellie custom build.
 */
@Serializable
data class UpstreamDesktopReleaseInfo(
	val version: String,
	val notificationSuppressed: Boolean,
)
