import { tutanotaTypeRefs } from "@tutao/typerefs"
import { htmlToText } from "./utils/IndexUtils.js"

export interface MailAddressAndName {
	name: string
	address: string
}

export function getDisplayedSender(mail: tutanotaTypeRefs.Mail): MailAddressAndName {
	const realSender = mail.sender
	return { address: realSender.address, name: realSender.name }
}

export function getMailBodyText(body: tutanotaTypeRefs.Body): string {
	return body.compressedText ?? body.text ?? ""
}

export function getSearchableMailBodyText(body: tutanotaTypeRefs.Body): string {
	return htmlToText(getMailBodyText(body)).replace(/\s+/g, " ").trim()
}
