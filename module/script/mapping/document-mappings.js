import {defaultMappings} from "./default-mappings.js";
import {DocumentMappingHierarchy} from "./document-mapping-hierarchy.js";

/**
 * Aggregate of effective document-mapping layers.
 *
 * Layers are merged in this order:
 * 1. built-in defaults
 * 2. mappings registered through the public API
 * 3. mappings loaded from discovered mapping files
 *
 * The aggregate owns precedence and materializes `DocumentMappingHierarchy`
 * instances on demand for a specific document type and optional
 * compendium-local override.
 */
export class DocumentMappings {

    static DEFAULT_MAPPINGS = foundry.utils.deepClone?.(defaultMappings)
        ?? foundry.utils.mergeObject({}, defaultMappings, {inplace: false});

    /**
     * @param {object} [builtInMappings]
     * @param {object} [options]
     * @param {object[]} [options.registeredMappings]
     * @param {object[]} [options.loadedMappings]
     * @param {IdentityExtractorRegistry} [options.identityExtractors]
     * @param {ConverterRegistry} [options.converterRegistry]
     */
    constructor(builtInMappings = defaultMappings, {
        registeredMappings = [],
        loadedMappings = [],
        identityExtractors,
        converterRegistry,
    } = {}) {
        this.builtInMappings = this.#clone(builtInMappings);
        this.registeredMappings = registeredMappings.map((mapping) => this.#clone(mapping));
        this.loadedMappings = loadedMappings.map((mapping) => this.#clone(mapping));
        this.identityExtractors = this.#required(identityExtractors, "identityExtractors");
        this.converterRegistry = this.#required(converterRegistry, "converterRegistry");
        this.effectiveMappings = this.#rebuild();
    }

    /**
     * Return a detached aggregate enriched with one additional registered
     * mapping layer.
     *
     * @param {object} mapping
     * @returns {DocumentMappings}
     */
    withRegistered(mapping) {
        return new DocumentMappings(this.builtInMappings, {
            registeredMappings: [...this.registeredMappings, this.#clone(mapping)],
            loadedMappings: this.loadedMappings,
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
        });
    }

    /**
     * Return a detached aggregate with the provided loaded mapping layers.
     *
     * @param {object[]} mappings
     * @returns {DocumentMappings}
     */
    withLoaded(mappings = []) {
        return new DocumentMappings(this.builtInMappings, {
            registeredMappings: this.registeredMappings,
            loadedMappings: mappings.map((mapping) => this.#clone(mapping)),
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
        });
    }

    /**
     * Return the effective mappings as a detached object.
     *
     * @returns {object}
     */
    current() {
        return this.#clone(this.effectiveMappings);
    }

    /**
     * Determine whether the effective mapping layers define one exact
     * document-type mapping.
     *
     * This is intentionally an exact lookup: subtype mappings such as
     * `Item.weapon` do not imply support for some other unrelated type, while
     * root document types like `Item` or `ActiveEffect` are resolved by their
     * canonical mapping key.
     *
     * @param {string|null} documentType
     * @returns {boolean}
     */
    supports(documentType) {
        return typeof documentType === "string"
            && Object.prototype.hasOwnProperty.call(this.effectiveMappings, documentType);
    }

    /**
     * Materialize the effective mapping hierarchy for one document type,
     * optionally enriching it with a compendium-local mapping layer.
     *
     * @param {string} documentType
     * @param {object|null} [customMapping]
     * @returns {DocumentMappingHierarchy}
     */
    hierarchyFor(documentType, customMapping = null) {
        return new DocumentMappingHierarchy(documentType, customMapping, this.current(), {
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
        });
    }

    /**
     * Publish the current effective defaults through the legacy static hook.
     *
     * @returns {object}
     */
    publish() {
        DocumentMappings.DEFAULT_MAPPINGS = this.current();
        return DocumentMappings.DEFAULT_MAPPINGS;
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

    #required(value, dependency) {
        if (!value) {
            throw new Error(`DocumentMappings requires ${dependency}.`);
        }

        return value;
    }
}
