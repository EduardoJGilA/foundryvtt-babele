/**
 * Synthetic package-scoped translations for compendium-directory folders.
 *
 * This object models one `[package-id]._packs-folders.json` payload. It is
 * intentionally separate from `MappedCompendium` because it does not
 * represent a Foundry compendium collection and owns no document mappings.
 */
export class PackFolderTranslations {

    constructor(collection, translations = null) {
        this.collection = collection;
        this.translation = this.#clone(translations);
        this.translated = !!translations;
    }

    translations() {
        return this.#clone(this.translation?.entries ?? {});
    }

    translationFor(name) {
        if (!name) {
            return null;
        }

        return this.translation?.entries?.[name] ?? null;
    }

    #clone(value) {
        return value == null ? value : foundry.utils.mergeObject({}, value);
    }
}
