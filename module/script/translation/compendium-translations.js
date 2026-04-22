import {CompendiumTranslation} from "./compendium-translation.js";

/**
 * Loaded translation payloads indexed by compendium collection.
 *
 * This object is the plural aggregate over `CompendiumTranslation`:
 * it keeps deterministic lookup by collection while still allowing iteration
 * in insertion order when callers need the whole loaded set.
 */
export class CompendiumTranslations {

    #byCollection;

    constructor({
        translations = [],
    } = {}) {
        this.#byCollection = new Map();

        for (const translation of translations) {
            this.add(translation);
        }
    }

    add(translation) {
        if (!translation) {
            return this;
        }

        const payload = translation instanceof CompendiumTranslation
            ? translation
            : new CompendiumTranslation(translation.collection, translation);

        this.#byCollection.set(payload.collection, payload);
        return this;
    }

    for(collection) {
        return this.#byCollection.get(collection) ?? null;
    }

    has(collection) {
        return this.#byCollection.has(collection);
    }

    values() {
        return [...this.#byCollection.values()];
    }

    empty() {
        return this.#byCollection.size === 0;
    }

    get size() {
        return this.#byCollection.size;
    }

    [Symbol.iterator]() {
        return this.#byCollection.values();
    }
}
