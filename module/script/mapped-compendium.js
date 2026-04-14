import {DocumentMapping} from "./document-mapping.js";
import {TranslationResolver} from "./translation-resolver.js";
import {CompendiumRuntime} from "./compendium-runtime.js";

/**
 * Babele-managed view of a Foundry compendium.
 *
 * A MappedCompendium owns the pack metadata, the effective document mapping,
 * and the optional translation entries used to translate or extract compendium
 * documents. It may also delegate missing matches to configured reference
 * packs.
 */
export class MappedCompendium {

    static #warnedMissingReferences = new Set();
    static #warnedTranslationFailures = new Set();

    /**
     * @param {object} metadata Foundry pack metadata or equivalent virtual-pack metadata.
     * @param {object|null} translations Loaded Babele translation payload for the pack.
     */
    constructor(metadata, translations) {
        this.metadata = metadata;
        this.translations = [];
        this.translated = false;
        this.customMapping = translations?.mapping ?? null;
        this.mapping = new DocumentMapping(metadata.type, translations ? translations.mapping : null);

        if (translations) {
            if (translations.label) {
                foundry.utils.mergeObject(metadata, {label: translations.label});
            }

            this.translated = true;
            this.reference = null;

            if (translations.reference) {
                this.reference = Array.isArray(translations.reference) ? translations.reference : [translations.reference];
            }

            if (translations.entries) {
                if (Array.isArray(translations.entries)) {
                    translations.entries.forEach(t => {
                        this.translations[t.id] = t;
                    });
                } else {
                    this.translations = translations.entries;
                }
            }

            if (translations.folders) {
                this.folders = translations.folders;
            }

            if (translations.types) {
                this.types = translations.types;
            }
        }

        this.resolver = new TranslationResolver(this.translations);
    }

    /**
     * Determine whether this compendium can provide a translation for the
     * given document. This is narrower than the `translated` pack state: a
     * pack may be marked as translated and still have no matching entry for a
     * specific document.
     *
     * @param data
     * @param {string|null} [documentType]
     * @returns {boolean}
     */
    hasTranslation(data, documentType = this.metadata?.type ?? null) {
        if (!this.translated) {
            return false;
        }

        if (documentType && this.metadata?.type && this.metadata.type !== documentType) {
            return false;
        }

        if (this.types && !this.types.includes(data.type)) {
            return false;
        }

        return this.resolver.hasTranslationFor(data) || this.hasReferenceTranslations(data);
    }

    /**
     * Translate a compendium index in place and return it.
     *
     * @param {object[]} index
     * @returns {object[]}
     */
    translateIndex(index) {
        for (const entry of index) {
            const translationsOnly = !!entry?.translated;
            foundry.utils.mergeObject(entry, this.translate(entry, translationsOnly), {inplace: true});
        }

        return index;
    }

    /**
     * Return the raw translation entry matched for a document, or an empty
     * object when no entry exists.
     *
     * @param data
     * @returns {object}
     */
    translationsFor(data) {
        return this.resolver.translationFor(data) ?? {};
    }

    /**
     * Resolve the translation key used for a document.
     *
     * @param data
     * @returns {string|null}
     */
    translationKeyFor(data) {
        return this.resolver.resolutionFor(data).key;
    }

    /**
     * Determine whether a referenced translated pack can translate the same
     * document when this compendium has no direct entry.
     *
     * @param data
     * @returns {boolean}
     */
    hasReferenceTranslations(data) {
        return this.#hasReferenceTranslations(data);
    }

    /**
     * Extract the translatable payload for a document.
     *
     * @param data
     * @param {CompendiumRuntime|object} [runtime] Runtime context controlling
     * visible compendiums during extraction.
     * @returns {*}
     */
    extract(data, runtime = {}) {
        return this.mapping.extract(data, this.#activeRuntime(runtime));
    }

    /**
     * Extract a single mapped field from a document.
     *
     * @param {string} field
     * @param data
     * @param {CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime = {}) {
        return this.mapping.extractField(field, data, this.#activeRuntime(runtime));
    }

    /**
     * Translate a single mapped field for a document, falling back to the
     * original extracted field value on missing translations or converter
     * failures.
     *
     * @param {string} field
     * @param data
     * @param {CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, runtime = {}) {
        if (data == null) {
            return data;
        }

        const activeRuntime = this.#activeRuntime(runtime);

        if (!(this.hasTranslation(data) || this.mapping.isDynamic())) {
            return this.extractField(field, data, activeRuntime);
        }

        if (data.translated) {
            return this.extractField(field, data, activeRuntime);
        }

        try {
            const translated = this.mapping.translateField(field, data, this.translationsFor(data), activeRuntime);
            return typeof translated === "undefined" ? this.extractField(field, data, activeRuntime) : translated;
        } catch (error) {
            this.#logTranslationFailure(data, error, {field, phase: "translateField"});
            return this.extractField(field, data, activeRuntime);
        }
    }

    /**
     * Translate a document using this compendium mapping and translation
     * entries.
     *
     * When `translationsOnly` is truthy, the method returns only the translated
     * payload without merging it into the original document shape.
     *
     * @param data
     * @param {boolean} [translationsOnly]
     * @param {CompendiumRuntime|object} [runtime] Runtime context used for
     * pack visibility. Decorated compendiums may enrich it with additional
     * scoped entries before delegating here.
     * @returns {*}
     */
    translate(data, translationsOnly = false, runtime = {}) {
        if (data == null) {
            return data;
        }

        if (!(this.hasTranslation(data) || this.mapping.isDynamic())) {
            return data;
        }

        if (data.translated) {
            return data;
        }

        let translatedData = {};
        const activeRuntime = this.#activeRuntime(runtime);

        try {
            translatedData = this.mapping.map(data, this.translationsFor(data), activeRuntime);
            translatedData = this.#mergeReferenceTranslations(data, translatedData, activeRuntime);
        } catch (error) {
            this.#logTranslationFailure(data, error, {phase: "translate"});
            return translationsOnly ? {} : data;
        }

        if (translationsOnly) {
            return translatedData;
        }

        if (!this.#hasTranslatedData(translatedData)) {
            return data;
        }

        return foundry.utils.mergeObject(
            data,
            foundry.utils.mergeObject(
                translatedData,
                {
                    translated: true,
                    hasTranslation: this.hasTranslation(data),
                    originalName: data.name,
                    flags: {
                        babele: {
                            translated: true,
                            hasTranslation: this.hasTranslation(data),
                            originalName: data.name,
                        },
                    },
                },
                {inplace: false},
            ),
            {inplace: false},
        );
    }

    #mergeReferenceTranslations(data, translatedData, runtime = {}) {
        if (!this.reference) {
            return translatedData;
        }

        let mergedTranslations = translatedData;

        for (const ref of this.reference) {
            const referencePack = this.#resolveReferencePack(ref);
            if (referencePack?.hasTranslation(data)) {
                const fromReference = referencePack.translate(data, true, runtime);
                mergedTranslations = foundry.utils.mergeObject(fromReference, mergedTranslations);
            }
        }

        return mergedTranslations;
    }

    #hasReferenceTranslations(data) {
        if (!this.reference) {
            return false;
        }

        for (const ref of this.reference) {
            const referencePack = this.#resolveReferencePack(ref);
            if (referencePack?.hasTranslation(data)) {
                return true;
            }
        }

        return false;
    }

    #resolveReferencePack(ref) {
        const referencePack = game.babele?.packs?.get(ref);
        if (referencePack) {
            return referencePack;
        }

        const warningKey = `${this.metadata?.id ?? this.metadata?.name ?? "unknown"}::${ref}`;
        if (!MappedCompendium.#warnedMissingReferences.has(warningKey)) {
            MappedCompendium.#warnedMissingReferences.add(warningKey);
            console.warn(`Babele | invalid reference pack '${ref}' declared for '${this.metadata?.id ?? this.metadata?.name ?? "unknown"}'`);
        }

        return null;
    }

    #hasTranslatedData(translatedData) {
        return !!translatedData && Object.keys(translatedData).length > 0;
    }

    #normalizeRuntime(runtime = {}) {
        return CompendiumRuntime.from(runtime);
    }

    #activeRuntime(runtime = {}) {
        const activeRuntime = this.#normalizeRuntime(runtime);
        return activeRuntime.currentCompendium() === this
            ? activeRuntime
            : activeRuntime.child({currentCompendium: this});
    }

    #logTranslationFailure(data, error, context = {}) {
        const pack = this.metadata?.id ?? this.metadata?.name ?? "unknown";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${context.phase ?? "translate"}::${pack}::${context.field ?? "*"}::${data?._id ?? data?.name ?? "unknown"}::${errorMessage}`;

        if (MappedCompendium.#warnedTranslationFailures.has(warningKey)) {
            return;
        }

        MappedCompendium.#warnedTranslationFailures.add(warningKey);
        console.error(`Babele | translation failed for document in '${pack}'`, {
            pack,
            phase: context.phase ?? "translate",
            field: context.field ?? null,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            error: errorMessage,
        });
    }
}
