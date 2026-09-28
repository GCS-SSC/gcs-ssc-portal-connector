import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { createGcsExtensionUserError } from '@gcs-ssc/extensions/server'
import { messages } from '../i18n/messages.ts'

type IntakeErrorKey =
  | 'intakeInvalidInput' | 'intakeUnavailable' | 'intakeInvalidStream' | 'intakeOtherStream'
  | 'intakeWithdrawToEdit' | 'intakeWithdrawToEditForm' | 'intakeStreamImmutable'
  | 'intakeSaveFormFirst' | 'intakeLatestForm' | 'intakeLatestAttachment'
  | 'intakeTranslationsIncomplete' | 'intakeWithdrawToDelete' | 'intakeDifferentForm'
  | 'intakeFormRevisionRequired'

export const intakeError = (key: IntakeErrorKey, statusCode = 409) => createGcsExtensionUserError({
  code: `GCS_PORTAL_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
  statusCode,
  message: {
    en: translateGcsExtensionMessage(messages, 'en', key),
    fr: translateGcsExtensionMessage(messages, 'fr', key)
  }
})
