import {FieldMapping} from "./field-mapping.js";
import {DocumentIdentity} from "../identity/document-identity.js";

/**
 * Effective mapping definition for one concrete document shape.
 *
 * A DocumentMapping does not resolve subtype inheritance. It represents the
 * already-materialized field and identity definition used to translate or
 * extract a specific document form.
 */
export class DocumentMapping {

    /**
     * @param {string} documentType
     * @param {object} [definition]
     * @param {object} [options]
     * @param {import("../identity/identity-extractor-registry.js").IdentityExtractorRegistry} options.identityExtractors
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     */
    constructor(documentType, definition = {}, {identityExtractors, converterRegistry} = {}) {
        this.documentType = documentType;
        this._identityExtractors = this._required(identityExtractors, "identityExtractors");
        this._converterRegistry = this._required(converterRegistry, "converterRegistry");

        const normalized = this._normalizedDefinition(definition);
        this.identityDefinition = normalized.identity;
        this.mapping = normalized.mapping;
        this.fields = Object.keys(this.mapping).map((key) => new FieldMapping(key, this.mapping[key], this._converterRegistry));
        this._identity = new DocumentIdentity(this.identityDefinition, this._identityExtractors);
    }

    /**
     * Return the effective document identity.
     *
     * @returns {DocumentIdentity}
     */
    identity() {
        return this._identity;
    }

    /**
     * Return ordered export key candidates for a document.
     *
     * @param {object} data
     * @returns {string[]}
     */
    exportKeyCandidates(data = {}) {
        return this.identity().exportCandidates(data);
    }

    /**
     * Return ordered lookup key candidates for a document.
     *
     * @param {object} data
     * @returns {string[]}
     */
    matchKeyCandidates(data = {}) {
        return this.identity().matchCandidates(data);
    }

    /**
     * Translate all mapped fields for a document.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    map(data, translations, runtime = {}) {
        return this.fields.reduce(
            (mapped, field) => foundry.utils.mergeObject(mapped, field.map(data, translations, runtime)),
            {},
        );
    }

    /**
     * Prepare all mapped fields before translation or extraction starts.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/document-translation-scope.js").DocumentTranslationScope|import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     */
    prepare(data, translations, runtime = {}) {
        for (const field of this.fields) {
            field.prepare(data, translations, runtime);
        }
    }

    /**
     * Translate one mapped field using the provided runtime visibility context.
     *
     * @param {string} field
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, translations, runtime = {}) {
        return this.fields.find((mappedField) => mappedField.field === field)?.translate(data, translations, runtime);
    }

    /**
     * Extract one mapped field using the provided runtime visibility context.
     *
     * @param {string} field
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime = {}) {
        return this.fields.find((mappedField) => mappedField.field === field)?.extract(data, runtime)?.[field];
    }

    /**
     * Extract all mapped fields for a document.
     *
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    extract(data, runtime = {}) {
        return this.fields.reduce((mapped, field) => {
            const extracted = field.extract(data, runtime);

            if (typeof extracted === "undefined") {
                return mapped;
            }

            const filtered = Object.fromEntries(
                Object.entries(extracted).filter(([, value]) => typeof value !== "undefined"),
            );

            if (Object.keys(filtered).length === 0) {
                return mapped;
            }

            return foundry.utils.mergeObject(mapped, filtered);
        }, {});
    }

    /**
     * A document mapping uses converters when at least one field is backed by
     * a registered converter.
     *
     * @returns {boolean}
     */
    usesConverters() {
        return this.fields.some((field) => field.usesConverter());
    }

    _normalizedDefinition(definition = {}) {
        const mapping = {...definition};
        const identity = mapping._identity ?? {};
        delete mapping._identity;

        return {mapping, identity};
    }

    _required(value, dependency) {
        if (!value) {
            throw new Error(`DocumentMapping requires ${dependency} for '${this.documentType ?? "unknown"}'.`);
        }

        return value;
    }
}
