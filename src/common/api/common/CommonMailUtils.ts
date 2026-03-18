import { Body, Mail } from "../entities/tutanota/TypeRefs.js"
import { htmlToText } from "./utils/IndexUtils.js"

export interface MailAddressAndName {
	name: string
	address: string
}

export function getDisplayedSender(mail: Mail): MailAddressAndName {
	const realSender = mail.sender
	return { address: realSender.address, name: realSender.name }
}

export function getMailBodyText(body: Body): string {
	return body.compressedText ?? body.text ?? ""
}

export function getSearchableMailBodyText(body: Body): string {
	return htmlToText(getMailBodyText(body))
}
