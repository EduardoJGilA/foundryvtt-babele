/**
 * Loaded translation payload for one compendium collection.
 *
 * Multiple source files may contribute to the same collection; this object
 * owns the merge semantics for that payload instead of leaving them inside
 * bootstrap procedural code.
 */
export class CompendiumTranslation {

    constructor(collection, payload = null) {
        this.collection = collection;
        this.label = undefined;
        this.entries = undefined;
        this.mapping = undefined;
        this.folders = undefined;
        this.reference = undefined;
        this.types = undefined;
        this.#loaded = false;

        if (payload) {
            this.merge(payload);
        }
    }

    #loaded;

    merge(payload = {}) {
        if (!payload) {
            return this;
        }

        if (!this.#loaded) {
            this.label = payload.label;
            this.entries = payload.entries ? {...payload.entries} : undefined;
            this.mapping = payload.mapping ? {...payload.mapping} : undefined;
            this.folders = payload.folders ? {...payload.folders} : undefined;
            this.reference = Array.isArray(payload.reference) ? [...payload.reference] : payload.reference;
            this.types = Array.isArray(payload.types) ? [...payload.types] : payload.types;
            this.#loaded = true;
            return this;
        }

        this.label = payload.label ?? this.label;

        if (payload.entries) {
            this.entries = {
                ...(this.entries ?? {}),
                ...payload.entries,
            };
        }

        if (payload.mapping) {
            this.mapping = {
                ...(this.mapping ?? {}),
                ...payload.mapping,
            };
        }

        if (payload.folders) {
            this.folders = {
                ...(this.folders ?? {}),
                ...payload.folders,
            };
        }

        return this;
    }

    loaded() {
        return this.#loaded;
    }
}
