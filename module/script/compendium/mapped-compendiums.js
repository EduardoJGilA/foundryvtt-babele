import {MappedCompendium} from "./mapped-compendium.js";

/**
 * Aggregate of Babele-managed compendiums.
 *
 * This object owns the registry of `MappedCompendium` instances materialized
 * for the current runtime state.
 */
export class MappedCompendiums {

    /**
     * @param {object} options
     * @param {import("./compendium-catalog.js").CompendiumCatalog} options.catalog
     * @param {import("../mapping/document-mappings.js").DocumentMappings} options.documentMappings
     * @param {import("../translation/compendium-translations.js").CompendiumTranslations|null} [options.translations]
     * @param {import("../translation/translation-entries.js").TranslationStrategy[]} [options.translationStrategies]
     * @param {foundry.utils.Collection} [options.packs]
     */
    constructor({
        catalog,
        documentMappings,
        translations = null,
        translationStrategies = [],
        packs = null,
    }) {
        this.catalog = catalog;
        this.documentMappings = documentMappings;
        this.translations = translations;
        this.translationStrategies = [...translationStrategies];
        this.packs = packs ?? new foundry.utils.Collection();
    }

    /**
     * Materialize all managed compendiums visible in the current Foundry data
     * @returns {Promise<MappedCompendiums>}
     */
    async load() {
        this.#materialize();
        return this;
    }

    /**
     * Return the managed compendium for a collection id.
     *
     * @param {string} pack
     * @returns {MappedCompendium|null}
     */
    get(pack) {
        return this.packs.get(pack) ?? null;
    }

    /**
     * Return the translated managed compendium for a collection id, if one is
     * currently available.
     *
     * @param {string} pack
     * @returns {MappedCompendium|null}
     */
    translated(pack) {
        const compendium = this.get(pack);
        return compendium?.translated ? compendium : null;
    }

    /**
     * Translate one compendium index in place when the target collection is
     * translated.
     *
     * @param {*} index
     * @param {string} pack
     * @returns {*}
     */
    translateIndex(index, pack) {
        return this.translated(pack)?.translateIndex(index) ?? index;
    }

    /**
     * Translate one document payload for the requested collection.
     *
     * @param {string} pack
     * @param {*} data
     * @param {*} [translationsOnly]
     * @returns {*}
     */
    translate(pack, data, translationsOnly) {
        return this.translated(pack)?.translate(data, translationsOnly) ?? data;
    }

    /**
     * Translate one field for the requested collection.
     *
     * @param {string} pack
     * @param {string} field
     * @param {*} data
     * @returns {*}
     */
    translateField(pack, field, data) {
        return this.get(pack)?.translateField(field, data) ?? null;
    }

    /**
     * Extract the exportable translation payload for one document in the
     * requested collection.
     *
     * @param {string} pack
     * @param {*} data
     * @param {object} [options]
     * @returns {*}
     */
    extract(pack, data, options = {}) {
        return this.get(pack)?.extract(data, options);
    }

    /**
     * Extract one field for export from the requested collection.
     *
     * @param {string} pack
     * @param {string} field
     * @param {*} data
     * @returns {*}
     */
    extractField(pack, field, data) {
        return this.get(pack)?.extractField(field, data);
    }

    values() {
        return this.packs.values();
    }

    matching(predicate) {
        return [...this.values()].filter(predicate);
    }

    /**
     * Clear runtime caches owned by all mapped compendiums.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    invalidateCaches(reason = "manual") {
        for (const compendium of this.values()) {
            compendium.invalidateCaches?.(reason);
        }
    }

    /**
     * Return cache diagnostics for all managed compendiums.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        const packs = [...this.values()].map((compendium) => compendium.cacheDiagnostics?.() ?? null).filter(Boolean);

        return {
            boundary: "mapped-compendiums",
            packCount: packs.length,
            translatedPackCount: packs.filter((pack) => pack.translated).length,
            indexTranslationEntries: packs.reduce((total, pack) => total + (pack.indexTranslationEntries ?? 0), 0),
            packs,
        };
    }

    #materialize() {
        this.packs = new foundry.utils.Collection();

        for (const metadata of this.catalog.supportedPacks()) {
            this.#register(metadata, this.translations?.for?.(this.catalog.collectionOf(metadata)) ?? null);
        }

    }

    #register(metadata, translation = null) {
        if (!this.catalog.supported(metadata)) {
            return null;
        }

        const collection = this.catalog.collectionOf(metadata);
        const compendium = new MappedCompendium(metadata, translation, {
            translationStrategies: this.translationStrategies,
            documentMappings: this.documentMappings,
        });
        this.packs.set(collection, compendium);
        return compendium;
    }

}
