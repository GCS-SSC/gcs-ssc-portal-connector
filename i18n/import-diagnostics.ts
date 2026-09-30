import { defineGcsExtensionMessages } from '@gcs-ssc/extensions'
export const importDiagnosticsMessages = defineGcsExtensionMessages({
  en: {
    importMalformedSubmission: 'The submitted Portal evidence is incomplete or its identity does not match. Review the original submission before retrying.',
    importInvalidAnswers: 'The frozen submitted form contains invalid answers. Review the original submission; it has not been acknowledged.',
    importUnsupportedSource: 'This form was not published by the GCS connector. Use a form published from this agency’s GCS Portal workspace.',
    importUnverifiedOrganization: 'Verify this Portal organization against a GCS Proponent in this agency, then retry the import.',
    importEvidenceConflict: 'The submission differs from its retained original evidence. Review the conflicting source; no new record was created.',
    importOpportunityMapping: 'This application is not mapped to a GCS Funding Opportunity in this agency. Publish its forms from the GCS Opportunity.',
    importHostUnavailable: 'This GCS version does not support atomic Intake imports. Update the host before retrying.',
    importMissingGroup: 'Select an Intake imports group in Portal delivery, then retry the application.',
    importOpportunityUnavailable: 'The GCS Funding Opportunity is unavailable, closed or outside its intake dates. Review its status and dates before retrying.',
    importRecipientUnavailable: 'The mapped GCS Proponent is unavailable or cannot be read with the current access. Review verification and access before retrying.',
    importGroupUnavailable: 'The configured intake group is unavailable in this agency or has no active member. Select an eligible Intake imports group and retry.',
    importIntakeConflict: 'The known Intake reference does not match this application. Review its source identity before retrying.',
    importSourceConflict: 'This Portal source identity already belongs to a different Intake or original export. Review the conflicting submission.',
    importApplicationIdConflict: 'The generated application number is already used by another Intake. Resolve the conflicting application identity before retrying.',
    importDraftUnavailable: 'This agency has no available Draft status for Intakes. Configure its Draft status before retrying.'
  },
  fr: {
    importMalformedSubmission: 'Les preuves soumises au portail sont incomplètes ou leur identité ne correspond pas. Examinez la soumission originale avant de réessayer.',
    importInvalidAnswers: 'Le formulaire soumis et figé contient des réponses invalides. Examinez la soumission originale; elle n’a pas été acquittée.',
    importUnsupportedSource: 'Ce formulaire n’a pas été publié par le connecteur GCS. Utilisez un formulaire publié depuis l’espace Portail GCS de cet organisme gouvernemental.',
    importUnverifiedOrganization: 'Vérifiez cet organisme du portail auprès d’un promoteur GCS de cet organisme gouvernemental, puis réessayez l’importation.',
    importEvidenceConflict: 'La soumission diffère de ses preuves originales conservées. Examinez la source en conflit; aucun nouveau dossier n’a été créé.',
    importOpportunityMapping: 'Cette demande n’est pas liée à une occasion de financement GCS de cet organisme gouvernemental. Publiez ses formulaires depuis l’occasion GCS.',
    importHostUnavailable: 'Cette version de GCS ne permet pas l’importation atomique des demandes reçues. Mettez à jour GCS avant de réessayer.',
    importMissingGroup: 'Sélectionnez un groupe d’importation des demandes dans Livraison au portail, puis réessayez la demande.',
    importOpportunityUnavailable: 'L’occasion de financement GCS est indisponible, fermée ou hors de ses dates de réception. Examinez son statut et ses dates avant de réessayer.',
    importRecipientUnavailable: 'Le promoteur GCS lié est indisponible ou inaccessible avec les droits actuels. Examinez la vérification et les droits avant de réessayer.',
    importGroupUnavailable: 'Le groupe de réception configuré est indisponible dans cet organisme gouvernemental ou n’a aucun membre actif. Sélectionnez un groupe admissible et réessayez.',
    importIntakeConflict: 'La référence de la demande reçue ne correspond pas à cette demande. Examinez son identité source avant de réessayer.',
    importSourceConflict: 'Cette identité source du portail appartient déjà à une autre demande reçue ou à une autre exportation originale. Examinez la soumission en conflit.',
    importApplicationIdConflict: 'Le numéro de demande généré est déjà utilisé par une autre demande reçue. Résolvez le conflit d’identité avant de réessayer.',
    importDraftUnavailable: 'Cet organisme gouvernemental n’a aucun statut Ébauche disponible pour les demandes reçues. Configurez ce statut avant de réessayer.'
  }
})
