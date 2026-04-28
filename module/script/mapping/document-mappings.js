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
     * Return the ordered mapping layers that compose the effective mapping
     * state.
     *
     * @returns {{kind: string, label: string, precedence: number, mapping: object}[]}
     */
    layers() {
        return this.#layers().map((layer) => ({
            ...layer,
            mapping: this.#clone(layer.mapping),
        }));
    }

    /**
     * Return a diagnostic view of the effective mapping for one document type
     * and optional document instance.
     *
     * The report reflects the actual hierarchy semantics: base document-type
     * layers are merged first, subtype layers overlay the effective base, and
     * compendium-local mappings overlay their matching branch.
     *
     * @param {string} documentType
     * @param {object} [options]
     * @param {object} [options.data]
     * @param {object|null} [options.customMapping]
     * @returns {object}
     */
    inspect(documentType, {
        data = {},
        customMapping = null,
    } = {}) {
        const subtype = data?.type ?? null;
        const hierarchy = this.hierarchyFor(documentType, customMapping);
        const mapping = hierarchy.mappingFor(data);

        return {
            documentType,
            subtype,
            keys: {
                base: documentType,
                subtype: subtype ? `${documentType}.${subtype}` : null,
            },
            precedence: [
                "built-in",
                "registered",
                "loaded",
                "compendium-local",
                "subtype",
            ],
            layers: this.#contributions(documentType, subtype, customMapping),
            effective: {
                mapping: this.#clone(mapping.mapping),
                identity: this.#clone(mapping.identityDefinition),
            },
        };
    }

    /**
     * Return a snapshot of mapping cache boundaries.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        return {
            boundary: "document-mappings",
            strategy: "immutable-rebuild",
            builtInLayerCount: 1,
            registeredLayerCount: this.registeredMappings.length,
            loadedLayerCount: this.loadedMappings.length,
            effectiveDocumentTypes: Object.keys(this.effectiveMappings).length,
        };
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

    #layers() {
        return [
            {
                kind: "built-in",
                label: "built-in defaults",
                precedence: 0,
                mapping: this.builtInMappings,
            },
            ...this.registeredMappings.map((mapping, index) => ({
                kind: "registered",
                label: `registered mapping ${index + 1}`,
                precedence: 10 + index,
                mapping,
            })),
            ...this.loadedMappings.map((mapping, index) => ({
                kind: "loaded",
                label: `loaded mapping ${index + 1}`,
                precedence: 20 + index,
                mapping,
            })),
        ];
    }

    #contributions(documentType, subtype = null, customMapping = null) {
        const contributions = this.#layers().flatMap((layer) => this.#layerContributions(layer, documentType, subtype));

        if (customMapping) {
            contributions.push(...this.#customContributions(documentType, subtype, customMapping));
        }

        return contributions;
    }

    #layerContributions(layer, documentType, subtype = null) {
        return [
            this.#contribution(layer, "base", documentType),
            subtype ? this.#contribution(layer, "subtype", `${documentType}.${subtype}`) : null,
        ].filter(Boolean);
    }

    #contribution(layer, branch, key) {
        const definition = layer.mapping?.[key];
        if (!definition) {
            return null;
        }

        return {
            kind: layer.kind,
            label: layer.label,
            precedence: layer.precedence,
            branch,
            key,
            definition: this.#definitionSnapshot(definition),
        };
    }

    #customContributions(documentType, subtype = null, customMapping = {}) {
        const base = {};
        const subtypeDefinitions = {};
        const subtypePrefix = `${documentType}.`;

        for (const [key, value] of Object.entries(customMapping)) {
            if (key.startsWith(subtypePrefix)) {
                const customSubtype = key.slice(subtypePrefix.length);
                subtypeDefinitions[customSubtype] = value;
                continue;
            }

            base[key] = value;
        }

        const contributions = [];
        if (Object.keys(base).length > 0) {
            contributions.push({
                kind: "compendium-local",
                label: "compendium-local mapping",
                precedence: 30,
                branch: "base",
                key: documentType,
                definition: this.#definitionSnapshot(base),
            });
        }

        if (subtype && subtypeDefinitions[subtype]) {
            contributions.push({
                kind: "compendium-local",
                label: "compendium-local subtype mapping",
                precedence: 31,
                branch: "subtype",
                key: `${documentType}.${subtype}`,
                definition: this.#definitionSnapshot(subtypeDefinitions[subtype]),
            });
        }

        return contributions;
    }

    #definitionSnapshot(definition = {}) {
        const normalized = this.#normalizedDefinition(definition);

        return {
            mapping: this.#clone(normalized.mapping),
            identity: this.#clone(normalized.identity),
        };
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

    #normalizedDefinition(definition = {}) {
        if (definition?.mapping || definition?.identity) {
            return {
                mapping: {...(definition.mapping ?? {})},
                identity: {...(definition.identity ?? {})},
            };
        }

        const mapping = {...(definition ?? {})};
        const identity = mapping._identity ?? {};
        delete mapping._identity;

        return {mapping, identity};
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
