/**
 * Immutable-ish snapshot of Babele derived state.
 *
 * This groups together the data rebuilt during initialization so the facade
 * can replace the whole runtime state coherently after a successful bootstrap.
 */
export class BabeleState {

    /**
     * @param {object} [options]
     * @param {object[]|null} [options.translations]
     * @param {foundry.utils.Collection|null} [options.packs]
     * @param {Array|object|null} [options.folders]
     * @param {import("./translation-registry.js").TranslationRegistry|null} [options.translationRegistry]
     * @param {object[]} [options.loadedGlobalMappings]
     */
    constructor({
        translations = null,
        packs = null,
        folders = null,
        translationRegistry = null,
        loadedGlobalMappings = [],
    } = {}) {
        this.translations = translations;
        this.packs = packs ?? new foundry.utils.Collection();
        this.folders = folders;
        this.translationRegistry = translationRegistry;
        this.loadedGlobalMappings = loadedGlobalMappings;
    }

    /**
     * Return an empty state object suitable for first construction or reset.
     *
     * @returns {BabeleState}
     */
    static empty() {
        return new BabeleState({
            translations: null,
            packs: new foundry.utils.Collection(),
            folders: null,
            translationRegistry: null,
            loadedGlobalMappings: [],
        });
    }
}
