import {defaultMappings} from "./default-mappings.js";
import {DocumentMapping} from "./document-mapping.js";
import {mergeIdentityDefinition} from "../identity/document-identity.js";

/**
 * Effective mapping hierarchy for one document type family.
 *
 * It resolves inheritance-like layers such as `Item` -> `Item.weapon`,
 * materializing concrete `DocumentMapping` instances on demand while keeping
 * the resolution rules out of `DocumentMapping` itself.
 */
export class DocumentMappingHierarchy {

    /**
     * @param {string} documentType
     * @param {object|null} [customMapping]
     * @param {object} [allMappings]
     * @param {object} [options]
     * @param {import("../identity/identity-extractor-registry.js").IdentityExtractorRegistry} options.identityExtractors
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     */
    constructor(documentType, customMapping = null, allMappings = defaultMappings, {identityExtractors, converterRegistry} = {}) {
        this.documentType = documentType;
        this._allMappings = allMappings ?? defaultMappings;
        this._identityExtractors = this._required(identityExtractors, "identityExtractors");
        this._converterRegistry = this._required(converterRegistry, "converterRegistry");

        const customDefinitions = this._customDefinitions(customMapping);
        this._subtypeCustomDefinitions = customDefinitions.subtypes;
        this._baseMapping = this._mapping(this._mergedDefinition(
            this._definitionFor(documentType),
            customDefinitions.base,
        ));
        this._subtypeMappings = new Map();
    }

    /**
     * Return the base mapping of the hierarchy.
     *
     * @returns {DocumentMapping}
     */
    base() {
        return this._baseMapping;
    }

    /**
     * Return the effective mapping for one document instance.
     *
     * @param {object} [data]
     * @returns {DocumentMapping}
     */
    mappingFor(data = {}) {
        const subtype = data?.type;

        if (!subtype) {
            return this.base();
        }

        if (this._subtypeMappings.has(subtype)) {
            return this._subtypeMappings.get(subtype);
        }

        const subtypeKey = `${this.documentType}.${subtype}`;
        const subtypeDefinition = this._mergedDefinition(
            this._definitionFor(subtypeKey),
            this._subtypeCustomDefinitions[subtype] ?? null,
        );

        if (this._emptyDefinition(subtypeDefinition)) {
            this._subtypeMappings.set(subtype, this.base());
            return this.base();
        }

        const mapping = this._mapping(this._mergedDefinition(this._definitionOf(this.base()), subtypeDefinition));
        this._subtypeMappings.set(subtype, mapping);
        return mapping;
    }

    _mapping(definition) {
        return new DocumentMapping(this.documentType, this._definitionObject(definition), {
            identityExtractors: this._identityExtractors,
            converterRegistry: this._converterRegistry,
        });
    }

    _definitionOf(mapping) {
        return {
            ...mapping.mapping,
            _identity: mapping.identityDefinition,
        };
    }

    _definitionFor(key) {
        return this._normalizedDefinition(this._allMappings[key] ?? {});
    }

    _definitionObject(definition = this._normalizedDefinition({})) {
        return {
            ...definition.mapping,
            _identity: definition.identity,
        };
    }

    _customDefinitions(customMapping = null) {
        const subtypes = {};
        let base = this._normalizedDefinition({});

        if (!customMapping) {
            return {base, subtypes};
        }

        const subtypePrefix = `${this.documentType}.`;
        for (const [key, value] of Object.entries(customMapping)) {
            if (key.startsWith(subtypePrefix)) {
                const subtype = key.slice(subtypePrefix.length);
                subtypes[subtype] = this._mergedDefinition(
                    subtypes[subtype] ?? this._normalizedDefinition({}),
                    this._normalizedDefinition(value),
                );
                continue;
            }

            base = this._mergedDefinition(
                base,
                this._normalizedDefinition({[key]: value}),
            );
        }

        return {base, subtypes};
    }

    _mergedDefinition(base = this._normalizedDefinition({}), override = this._normalizedDefinition({})) {
        const effectiveBase = this._normalizedDefinition(base);
        const effectiveOverride = this._normalizedDefinition(override);

        return {
            mapping: foundry.utils.mergeObject(effectiveBase.mapping ?? {}, effectiveOverride.mapping ?? {}, {inplace: false}),
            identity: mergeIdentityDefinition(effectiveBase.identity ?? {}, effectiveOverride.identity ?? {}),
        };
    }

    _normalizedDefinition(definition = {}) {
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

    _emptyDefinition(definition = this._normalizedDefinition({})) {
        return Object.keys(definition.mapping ?? {}).length === 0
            && Object.keys(definition.identity ?? {}).length === 0;
    }

    _required(value, dependency) {
        if (!value) {
            throw new Error(`DocumentMappingHierarchy requires ${dependency} for '${this.documentType ?? "unknown"}'.`);
        }

        return value;
    }
}
