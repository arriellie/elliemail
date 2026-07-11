import { asyncFind, lazyAsync, lazyMemoized } from "../../../../platform-kit/utils"
import type { MailboxDetail } from "../../../common/mailFunctionality/MailboxModel.js"
import { EnvProvider } from "../../../../platform-kit/app-env"
import { getSearchableMailBodyText } from "../../../common/api/common/CommonMailUtils"
import { MailFacade } from "../../../common/api/worker/facades/lazy/MailFacade.js"
import { LoginController } from "../../../common/api/main/LoginController.js"
import { getMailHeaders } from "./MailUtils.js"
import { MailModel } from "./MailModel"
import { InboxRule, Mail, MailDetails, MailSet } from "@tutao/entities/tutanota"
import { InboxRuleConditionType } from "../../../../entities/tutanota/Utils"
import { elementIdPart } from "../../../../platform-kit/meta"
import { _checkContainsRuleCondition, _checkEmailAddresses, _shouldApplyRule, InboxRuleHandler } from "./InboxRuleHandler"

EnvProvider.assertMainOrNode()

export class LegacyInboxRuleHandler implements InboxRuleHandler<InboxRule> {
	constructor(
		private readonly mailFacade: MailFacade,
		private readonly logins: LoginController,
		private readonly mailModel: MailModel,
	) {}

	async findMatchingInboxRule(
		mail: Readonly<Mail>,
		sourceFolder: MailSet,
		ignoreProcessingState = false,
		mailDetails?: MailDetails,
	): Promise<InboxRule | null> {
		if (!this.logins.getUserController().isPaidAccount() || !_shouldApplyRule(mail, sourceFolder, ignoreProcessingState)) {
			return null
		}
		return await _findMatchingRule(this.mailFacade, mail, this.logins.getUserController().props.inboxRules, mailDetails)
	}

	async getMoveActionValue(inboxRule: InboxRule, mailboxDetail: MailboxDetail): Promise<MailSet | null> {
		const folders = await this.mailModel.getMailboxFoldersForId(mailboxDetail.mailbox.mailSets._id)
		return folders.getFolderById(elementIdPart(inboxRule.targetFolder))
	}

	getExcludeSpamActionValue(inboxRule: InboxRule): boolean {
		return inboxRule.excludeFromSpamFilter ?? false
	}

	async getLabelActionValue(_inboxRule: InboxRule, _mailboxDetail: MailboxDetail): Promise<MailSet[]> {
		return []
	}

	getReadActionValue(_inboxRule: InboxRule): boolean {
		return false
	}
}

/**
 * Finds the first matching inbox rule for the mail and returns it.
 * export only for testing
 */
export async function _findMatchingRule(mailFacade: MailFacade, mail: Mail, rules: InboxRule[], mailDetails?: MailDetails): Promise<InboxRule | null> {
	const loadDetails = lazyMemoized(async () => mailDetails ?? (await mailFacade.loadMailDetailsBlob(mail)))
	return asyncFind(rules, (rule) => checkInboxRule(mail, rule, loadDetails))
}

async function checkInboxRule(mail: Mail, inboxRule: InboxRule, loadDetails: lazyAsync<MailDetails>): Promise<boolean> {
	const ruleType = inboxRule.type
	const ruleValue = inboxRule.value

	try {
		if (ruleType === InboxRuleConditionType.FROM_EQUALS) {
			let mailAddresses = [mail.sender.address]

			if (mail.differentEnvelopeSender) {
				mailAddresses.push(mail.differentEnvelopeSender)
			}

			return _checkEmailAddresses(mailAddresses, ruleValue)
		} else if (ruleType === InboxRuleConditionType.RECIPIENT_TO_EQUALS) {
			const toRecipients = (await loadDetails()).recipients.toRecipients
			return _checkEmailAddresses(
				toRecipients.map((m) => m.address),
				ruleValue,
			)
		} else if (ruleType === InboxRuleConditionType.RECIPIENT_CC_EQUALS) {
			const ccRecipients = (await loadDetails()).recipients.ccRecipients
			return _checkEmailAddresses(
				ccRecipients.map((m) => m.address),
				ruleValue,
			)
		} else if (ruleType === InboxRuleConditionType.RECIPIENT_BCC_EQUALS) {
			const bccRecipients = (await loadDetails()).recipients.bccRecipients
			return _checkEmailAddresses(
				bccRecipients.map((m) => m.address),
				ruleValue,
			)
		} else if (ruleType === InboxRuleConditionType.SUBJECT_CONTAINS) {
			return _checkContainsRuleCondition(mail.subject, ruleValue)
		} else if (ruleType === InboxRuleConditionType.MAIL_HEADER_CONTAINS) {
			const details = await loadDetails()
			if (details.headers != null) {
				return _checkContainsRuleCondition(getMailHeaders(details.headers), ruleValue)
			} else {
				return false
			}
		} else if (ruleType === InboxRuleConditionType.MAIL_BODY_CONTAINS) {
			const { body } = await loadDetails()
			return _checkContainsRuleCondition(getSearchableMailBodyText(body), ruleValue)
		} else {
			console.warn("Unknown rule type: ", ruleType)
			return false
		}
	} catch (e) {
		console.error("Error processing inbox rule:", e.message)
		return false
	}
}
