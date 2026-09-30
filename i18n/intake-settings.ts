import { defineGcsExtensionMessages } from '@gcs-ssc/extensions'

export const intakeSettingsMessages = defineGcsExtensionMessages({
  en: {
    title: 'Funding application imports',
    groupLabel: 'Intake group',
    groupHint: 'Funding applications received from the Portal are assigned to this agency group. Select a group before importing applications.',
    none: 'No group selected',
    prerequisite: 'Select an intake group to enable funding application imports. Claims, forecasts and other reports can still synchronize.',
    unavailable: 'The selected group is unavailable. Choose another active group in this agency.',
    loadFailed: 'Intake settings could not be loaded.',
    saveFailed: 'Intake settings could not be saved.',
    saved: 'Intake settings saved.',
    retry: 'Retry',
    save: 'Save intake settings'
  },
  fr: {
    title: 'Importation des demandes de financement',
    groupLabel: 'Groupe de réception des demandes',
    groupHint: 'Les demandes de financement reçues du portail sont attribuées à ce groupe de l’organisme gouvernemental. Sélectionnez un groupe avant d’importer les demandes.',
    none: 'Aucun groupe sélectionné',
    prerequisite: 'Sélectionnez un groupe de réception pour activer l’importation des demandes de financement. Les réclamations, les prévisions et les autres rapports peuvent continuer à se synchroniser.',
    unavailable: 'Le groupe sélectionné n’est pas disponible. Choisissez un autre groupe actif de cet organisme gouvernemental.',
    loadFailed: 'Impossible de charger les paramètres de réception.',
    saveFailed: 'Impossible d’enregistrer les paramètres de réception.',
    saved: 'Paramètres de réception enregistrés.',
    retry: 'Réessayer',
    save: 'Enregistrer les paramètres de réception'
  }
})
