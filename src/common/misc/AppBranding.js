//@bundleInto:common-min

/** @typedef {"mail" | "calendar"} StockAppId */
/** @typedef {"prod" | "test" | "dev"} StockAppVariant */

const baseNames = Object.freeze({
	mail: "Ellie Mail",
	calendar: "Ellie Calendar",
})

/**
 * @param {unknown} app
 * @returns {StockAppId}
 */
export function getStockAppId(app) {
	return app === "calendar" ? "calendar" : "mail"
}

/**
 * @param {unknown} variant
 * @returns {StockAppVariant}
 */
export function getStockAppVariant(variant) {
	return variant === "test" || variant === "dev" ? variant : "prod"
}

/**
 * @param {unknown} app
 * @returns {string}
 */
export function getStockAppBaseName(app) {
	return baseNames[getStockAppId(app)]
}

/**
 * @param {unknown} app
 * @param {unknown} [variant]
 * @returns {string}
 */
export function getStockAppDisplayName(app, variant = "prod") {
	const baseName = getStockAppBaseName(app)
	switch (getStockAppVariant(variant)) {
		case "test":
			return `${baseName} Test`
		case "dev":
			return `${baseName} Dev`
		default:
			return baseName
	}
}

/**
 * @param {unknown} app
 * @param {unknown} [variant]
 * @returns {string}
 */
export function getStockLoginTitle(app, variant = "prod") {
	return `${getStockAppDisplayName(app, variant)} Login & Sign up`
}

/**
 * @param {unknown} app
 * @returns {string}
 */
export function getStockLaunchDescription(app) {
	if (getStockAppId(app) === "calendar") {
		return "Sign-up for Ellie Calendar: Get a free calendar account with quantum-safe encryption and best privacy for all your events, reminders and contacts."
	}

	return "Sign-up for Ellie Mail: Get a free email account with quantum-safe encryption and best privacy for all your emails, calendars and contacts."
}

/**
 * @param {unknown} app
 * @param {unknown} [variant]
 * @returns {string}
 */
export function getStockLogoAriaLabel(app, variant = "prod") {
	return `${getStockAppDisplayName(app, variant)} logo`
}

/**
 * @param {unknown} app
 * @param {unknown} [variant]
 * @returns {string}
 */
export function getStockDesktopSynopsis(app, variant = "prod") {
	return `${getStockAppDisplayName(app, variant)} Desktop Client`
}

/**
 * @param {unknown} app
 * @param {unknown} [variant]
 * @returns {string}
 */
export function getStockDesktopDescription(app, variant = "prod") {
	if (getStockAppId(app) === "calendar") {
		return `The desktop client for ${getStockAppDisplayName(app, variant)}, the secure calendar service.`
	}

	return `The desktop client for ${getStockAppDisplayName(app, variant)}, the secure e-mail service.`
}

/**
 * @param {unknown} stage
 * @returns {StockAppVariant}
 */
export function getStockAppVariantFromStage(stage) {
	switch (stage) {
		case "test":
			return "test"
		case "local":
		case "host":
			return "dev"
		default:
			return "prod"
	}
}

/**
 * @param {string | undefined} nameSuffix
 * @returns {StockAppVariant}
 */
export function getStockAppVariantFromNameSuffix(nameSuffix) {
	switch (nameSuffix) {
		case "-debug":
		case "-snapshot":
			return "dev"
		case "-test":
			return "test"
		default:
			return "prod"
	}
}
