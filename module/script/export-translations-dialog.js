function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Lightweight ApplicationV2-based export dialog.
 *
 * The dialog is implemented through Foundry's DialogV2 helper so the export
 * flow can use the current form and window APIs without introducing a larger
 * custom ApplicationV2 surface than needed.
 */
export class ExportTranslationsDialog {

    static async create(pack, options = {}) {
        const context = this.#contextFor(pack, options);
        const content = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/export-translations-dialog.html",
            context,
        );

        return foundry.applications.api.DialogV2.input({
            window: {
                title: `${pack.metadata.label}: ${game.i18n.localize("BABELE.ExportTranslationTitle")}`,
            },
            position: {
                width: 520,
            },
            content,
            ok: {
                label: game.i18n.localize("BABELE.ExportTranslationBtn"),
                icon: "fas fa-download",
                callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
            },
            rejectClose: false,
            modal: true,
        });
    }

    static #contextFor(_pack, {
        hasTranslations = false,
        format = "compatible",
        selection = "all",
        counts = {all: 0, present: 0, missing: 0},
    } = {}) {
        return {
            hasTranslations,
            format,
            selection,
            counts,
            isCompatible: format === "compatible",
            isLegacy: format === "legacy",
            isAll: selection === "all",
            isPresent: selection === "present",
            isMissing: selection === "missing",
            hasPresentEntries: counts.present > 0,
            hasMissingEntries: counts.missing > 0,
            texts: {
                notes: localizeWithFallback(
                    "BABELE.ExportTranslationNotes",
                    "Choose the export format and which entries to include in the generated translation file.",
                ),
                format: localizeWithFallback("BABELE.ExportTranslationFormat", "Format"),
                formatLegacy: localizeWithFallback("BABELE.ExportTranslationFormatLegacy", "Legacy"),
                formatCompatible: localizeWithFallback("BABELE.ExportTranslationFormatCompatible", "Compatible"),
                compatibleHint: localizeWithFallback(
                    "BABELE.ExportTranslationFormatCompatibleHint",
                    "Recommended. Exports the canonical object-based format, better suited for modern translation workflows.",
                ),
                legacyDeprecation: localizeWithFallback(
                    "BABELE.ExportTranslationFormatLegacyDeprecated",
                    "Deprecated. Will be removed in a future major version.",
                ),
                translationFileDetected: localizeWithFallback(
                    "BABELE.ExportTranslationFileDetected",
                    "Associated Translation File Found",
                ),
                translationFileDetectedHint: localizeWithFallback(
                    "BABELE.ExportTranslationFileDetectedHint",
                    "Babele found a translation file matching this compendium. You can therefore choose whether to export all entries, only those already present in that file, or only the missing ones.",
                ),
                selection: localizeWithFallback("BABELE.ExportTranslationSelection", "Entries"),
                selectionHint: localizeWithFallback(
                    "BABELE.ExportTranslationSelectionHint",
                    "Choose whether to export all entries, only entries present in the translation file, or only entries missing from it.",
                ),
                selectionAll: localizeWithFallback("BABELE.ExportTranslationSelectionAll", "All Entries"),
                selectionPresent: localizeWithFallback("BABELE.ExportTranslationSelectionPresent", "Entries Present in Translation File"),
                selectionMissing: localizeWithFallback("BABELE.ExportTranslationSelectionMissing", "Entries Missing from Translation File"),
                noTranslations: localizeWithFallback(
                    "BABELE.ExportTranslationNoTranslations",
                    "No loaded translations were found for this compendium. Export will include source-language entries only.",
                ),
            },
        };
    }
}
