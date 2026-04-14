/**
 * Tracks the mapping layers that contribute to the effective Babele defaults.
 *
 * Layers are merged in this order:
 * 1. built-in defaults
 * 2. mappings registered through the public API
 * 3. mappings loaded from discovered mapping files
 */
export class BabeleMappings {

    /**
     * @param {object} builtInMappings
     */
    constructor(builtInMappings = {}) {
        this.builtInMappings = foundry.utils.deepClone?.(builtInMappings)
            ?? foundry.utils.mergeObject({}, builtInMappings, {inplace: false});
        this.registeredMappings = [];
        this.loadedMappings = [];
        this.effectiveMappings = this.#rebuild();
    }

    /**
     * Register a mapping layer contributed through the public API.
     *
     * @param {object} mapping
     * @returns {object} the effective mappings after the merge
     */
    register(mapping) {
        this.registeredMappings.push(this.#clone(mapping));
        this.effectiveMappings = this.#rebuild();
        return this.current();
    }

    /**
     * Replace the set of mapping layers loaded from discovered mapping files.
     *
     * @param {object[]} mappings
     * @returns {object} the effective mappings after the merge
     */
    replaceLoaded(mappings = []) {
        this.loadedMappings = mappings.map((mapping) => this.#clone(mapping));
        this.effectiveMappings = this.#rebuild();
        return this.current();
    }

    /**
     * Return the effective mappings as a detached object.
     *
     * @returns {object}
     */
    current() {
        return this.#clone(this.effectiveMappings);
    }

    #rebuild() {
        const effective = this.#clone(this.builtInMappings);

        for (const mapping of this.registeredMappings) {
            this.#mergeLayer(effective, mapping);
        }

        for (const mapping of this.loadedMappings) {
            this.#mergeLayer(effective, mapping);
        }

        return effective;
    }

    #mergeLayer(target, mapping) {
        for (const [key, value] of Object.entries(mapping ?? {})) {
            if (target[key]) {
                target[key] = foundry.utils.mergeObject(target[key], value);
            } else {
                target[key] = this.#clone(value);
            }
        }
    }

    #clone(value) {
        return foundry.utils.deepClone?.(value)
            ?? foundry.utils.mergeObject({}, value ?? {}, {inplace: false});
    }
}
