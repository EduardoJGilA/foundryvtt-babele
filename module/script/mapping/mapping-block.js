import {FieldMapping} from "./field-mapping.js";

/**
 * A reusable mapping block made of field mappings.
 *
 * MappingBlock owns the common behavior shared by document mappings and
 * structured-data mappings: build field mappings, prepare dynamic converters,
 * translate, extract, and inspect converter usage. It intentionally does not
 * own document identity or collection traversal.
 */
export class MappingBlock {

    /**
     * @param {object} [mapping]
     * @param {object} [options]
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     * @param {string} [options.owner]
     */
    constructor(mapping = {}, {converterRegistry, owner = "mapping block"} = {}) {
        this.mapping = mapping ?? {};
        this.owner = owner;
        this.converterRegistry = this.#required(converterRegistry, "converterRegistry");
        this.fields = Object.entries(this.mapping).map(
            ([field, definition]) => new FieldMapping(field, definition, this.converterRegistry),
        );
    }

    /**
     * Prepare all mapped fields before translation starts.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     */
    prepare(data, translations, runtime = {}) {
        for (const field of this.fields) {
            field.prepare(data, translations, runtime);
        }
    }

    /**
     * Translate all mapped fields and return a mergeable payload.
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
     * Translate one mapped field.
     *
     * @param {string} field
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, translations, runtime = {}) {
        return this.#field(field)?.translate(data, translations, runtime);
    }

    /**
     * Extract one mapped field.
     *
     * @param {string} field
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime = {}) {
        return this.#field(field)?.extract(data, runtime)?.[field];
    }

    /**
     * Extract all mapped fields in translation-file shape.
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

            const filtered = this.#withoutUndefined(extracted);
            if (Object.keys(filtered).length === 0) {
                return mapped;
            }

            return foundry.utils.mergeObject(mapped, filtered);
        }, {});
    }

    /**
     * Whether at least one field uses a named converter.
     *
     * @returns {boolean}
     */
    usesConverters() {
        return this.fields.some((field) => field.usesConverter());
    }

    #field(field) {
        return this.fields.find((mappedField) => mappedField.field === field);
    }

    #withoutUndefined(extracted) {
        return Object.fromEntries(
            Object.entries(extracted).filter(([, value]) => typeof value !== "undefined"),
        );
    }

    #required(value, dependency) {
        if (!value) {
            throw new Error(`MappingBlock requires ${dependency} for '${this.owner}'.`);
        }

        return value;
    }
}
