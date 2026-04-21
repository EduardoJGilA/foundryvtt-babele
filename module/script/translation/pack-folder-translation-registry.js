import {PackFolderTranslations} from "./pack-folder-translations.js";

/**
 * Registry of synthetic package-scoped `_packs-folders` translations.
 */
export class PackFolderTranslationRegistry {

    static FOLDER_TRANSLATION_NAME = "_packs-folders";

    constructor({
        translations = null,
        packs = null,
    } = {}) {
        this.translations = translations;
        this.packs = packs ?? new foundry.utils.Collection();
    }

    async load() {
        this.#materialize();
        return this;
    }

    get(collection) {
        return this.packs.get(collection) ?? null;
    }

    values() {
        return this.packs.values();
    }

    matching(predicate) {
        return [...this.values()].filter(predicate);
    }

    #materialize() {
        this.packs = new foundry.utils.Collection();

        for (const translation of this.translations?.values?.() ?? []) {
            if (!this.#isFolderTranslationCollection(translation.collection)) {
                continue;
            }

            this.packs.set(
                translation.collection,
                new PackFolderTranslations(translation.collection, translation),
            );
        }
    }

    #isFolderTranslationCollection(collection) {
        return String(collection ?? "").endsWith(`.${PackFolderTranslationRegistry.FOLDER_TRANSLATION_NAME}`);
    }
}
