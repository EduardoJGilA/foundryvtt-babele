import {CompendiumMapping} from "./compendium-mapping.js";
import {TranslationResolver} from "./translation-resolver.js";

/**
 * Runtime representation of a translated compendium pack.
 *
 * A translated compendium couples pack metadata, the effective field mapping,
 * and the translation entry set used to translate or extract compendium
 * Documents. It may also delegate missing matches to reference packs.
 */
export class TranslatedCompendium {

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
        this.mapping = new CompendiumMapping(metadata.type, translations ? translations.mapping : null, this);
        if (translations) {
            if(translations.label) {
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

            if(translations.types) {
                this.types = translations.types;
            }
        }

        this.resolver = new TranslationResolver(this.translations);
    }

    /**
     * Determine whether this translated compendium can provide a translation for
     * the given document. This is narrower than the `translated` pack state:
     * a pack may be marked as translated and still have no matching entry for a
     * specific document.
     *
     *
     * @param data
     * @param {string|null} [documentType]
     * @returns {boolean|*|{translated}}
     */
    hasTranslation(data, documentType = this.metadata?.type ?? null) {
        if (!this.translated) {
            return false;
        }

        if (documentType && this.metadata?.type && this.metadata.type !== documentType) {
            return false;
        }

        if(this.types && !this.types.includes(data.type)) {
            return false;
        }
        return this.resolver.hasTranslationFor(data) || this.hasReferenceTranslations(data);
    }

    /**
     * Return the raw translation entry matched for a document, or an empty object
     * when no entry exists.
     *
     *
     * @param data
     * @returns {object}
     */
    translationsFor(data) {
        return this.resolver.translationFor(data) ?? {}
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
     * document when this pack has no direct entry.
     *
     *
     * @param data
     * @returns {boolean}
     */
    hasReferenceTranslations(data) {
        if (this.reference) {
            for (let ref of this.reference) {
                const referencePack = this.#resolveReferencePack(ref);
                if (referencePack?.hasTranslation(data)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Delegate extract to the compendium mapping relative method.
     *
     * @see CompendiumMapping.extract()
     * @param data
     * @param {object} [options]
     * @returns {*}
     */
    extract(data, options = {}) {
        return this.mapping.extract(data, options);
    }

    /**
     * Delegate extractField to the compendium mapping relative method.
     *
     * @see CompendiumMapping.extractField()
     * @param {string} field
     * @param data
     * @returns {*}
     */
    extractField(field, data) {
        return this.mapping.extractField(field, data);
    }


    /**
     * Translate a single mapped field for a document, falling back to the
     * original extracted field value on missing translations or converter
     * failures.
     *
     * @param {string} field
     * @param data
     * @returns {*}
     */
    translateField(field, data) {
        if (data == null) {
            return data;
        }

        if (data.translated) {
            return this.mapping.extractField(field, data);
        }

        try {
            const translated = this.mapping.translateField(field, data, this.translationsFor(data));
            return typeof translated === "undefined" ? this.mapping.extractField(field, data) : translated;
        } catch (error) {
            this.#logTranslationFailure(data, error, {field, phase: "translateField"});
            return this.mapping.extractField(field, data);
        }
    }

    /**
     * Translate a document using this compendium mapping and translation entries.
     *
     * When `translationsOnly` is truthy, the method returns only the translated
     * payload without merging it into the original document shape.
     *
     *
     * @param data
     * @param {boolean} [translationsOnly]
     * @returns {{translated}|*}
     */
    translate(data, translationsOnly) {

        if (data == null) {
            return data;
        }

        if (data.translated) {
            return data;
        }

        let translatedData = {};

        try {
            translatedData = this.mapping.map(data, this.translationsFor(data));

            if (this.reference) {
                for (let ref of this.reference) {
                    const referencePack = this.#resolveReferencePack(ref);
                    if (referencePack?.hasTranslation(data)) {
                        let fromReference = referencePack.translate(data, true);
                        translatedData = foundry.utils.mergeObject(fromReference, translatedData);
                    }
                }
            }
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
                translatedData, {
                    translated: true,
                    hasTranslation: this.hasTranslation(data),
                    originalName: data.name,
                    flags: {
                        babele: {
                            translated: true,
                            hasTranslation: this.hasTranslation(data),
                            originalName: data.name
                        }
                    }
                },
                {inplace: false}
            ),
            {inplace: false}
        );
    }

    #resolveReferencePack(ref) {
        const referencePack = game.babele?.packs?.get(ref);
        if (referencePack) {
            return referencePack;
        }

        const warningKey = `${this.metadata?.id ?? this.metadata?.name ?? "unknown"}::${ref}`;
        if (!TranslatedCompendium.#warnedMissingReferences.has(warningKey)) {
            TranslatedCompendium.#warnedMissingReferences.add(warningKey);
            console.warn(`Babele | invalid reference pack '${ref}' declared for '${this.metadata?.id ?? this.metadata?.name ?? "unknown"}'`);
        }

        return null;
    }

    #hasTranslatedData(translatedData) {
        return !!translatedData && Object.keys(translatedData).length > 0;
    }

    #logTranslationFailure(data, error, context = {}) {
        const pack = this.metadata?.id ?? this.metadata?.name ?? "unknown";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${context.phase ?? "translate"}::${pack}::${context.field ?? "*"}::${data?._id ?? data?.name ?? "unknown"}::${errorMessage}`;

        if (TranslatedCompendium.#warnedTranslationFailures.has(warningKey)) {
            return;
        }

        TranslatedCompendium.#warnedTranslationFailures.add(warningKey);
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
