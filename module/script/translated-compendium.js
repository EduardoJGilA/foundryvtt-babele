import {CompendiumMapping} from "./compendium-mapping.js";

/**
 *
 */
export class TranslatedCompendium {
    static #warnedMissingReferences = new Set();
    static #warnedTranslationFailures = new Set();

    constructor(metadata, translations) {
        this.metadata = metadata;
        this.translations = [];
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
    }

    /**
     *
     * @param data
     * @returns {boolean|*|{translated}}
     */
    hasTranslation(data) {
        if(this.types && !this.types.includes(data.type)) {
            return false;
        }
        return !!this.translationKeyFor(data) || this.hasReferenceTranslations(data);
    }

    /**
     *
     * @param data
     * @returns {*|{}}
     */
    translationsFor(data) {
        const key = this.translationKeyFor(data);
        return key ? this.translations[key] : {}
    }

    /**
     * Resolve the translation key used for a document.
     *
     * @param data
     * @returns {string|null}
     */
    translationKeyFor(data) {
        /**
         * The compendium item id. Using both the core sourceId and the _stats compendiumSource to support prior v13
         * @type {string | undefined}
         */
        const itemId = foundry.utils.parseUuid(data.flags?.core?.sourceId || data._stats?.compendiumSource)?.id;

        for (const key of [data._id, data.name, itemId]) {
            if (key && this.translations[key]) {
                return key;
            }
        }

        return null;
    }

    /**
     *
     * @param data
     * @returns {boolean|boolean|*|{translated}}
     */
    hasReferenceTranslations(data) {
        if (this.reference) {
            for (let ref of this.reference) {
                const referencePack = this.#resolveReferencePack(ref);
                if (referencePack?.translated && referencePack.hasTranslation(data)) {
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
     * @returns {*}
     */
    extract(data, options = {}) {
        return this.mapping.extract(data, options);
    }

    /**
     * Delegate extractField to the compendium mapping relative method.
     *
     * @see CompendiumMapping.extractField()
     * @param data
     * @returns {*}
     */
    extractField(field, data) {
        return this.mapping.extractField(field, data);
    }


    /**
     *
     * @param field
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
     *
     * @param data
     * @param translationsOnly
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
                    if (referencePack?.translated && referencePack.hasTranslation(data)) {
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
