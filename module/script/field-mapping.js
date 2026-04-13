import Babel from "./babele.js";

/**
 * Class to map, translate or extract value for a single field defined by a mapping.
 *
 * ex: new FieldMapping("desc", "data.description.value", tc)
 */
export class FieldMapping {
    static #warnedConverterFailures = new Set();

    constructor(field, mapping, tc) {
        this.field = field;
        this.tc = tc;
        this.mapping = mapping;
        if (typeof mapping === "object") {
            this.path = mapping["path"];
            this.converterName = mapping["converter"];
            this.converter = game.babele.converters[this.converterName];
            this.dynamic = true;
        } else {
            this.path = mapping;
            this.converterName = null;
            this.converter = null;
            this.dynamic = false;
        }
    }

    /**
     * Extract the
     *
     * @param data the original entity data to translate
     * @param translations the static available translations for the entity
     * @returns {{}} an object with expanded field path and a translated value.
     */
    map(data, translations) {
        const map = {};
        const value = this.translate(data, translations);
        if (typeof value !== "undefined" && value !== null) {
            this.path.split('.').reduce((a, f, i, r) => {
                a[f] = (i < r.length - 1) ? {} : value;
                return a[f];
            }, map);
        }
        return map;
    }

    /**
     *
     * @param data
     * @param translations
     * @returns {*}
     */
    translate(data, translations) {
        const originalValue = this.extractValue(data);
        if (typeof originalValue === "undefined" || originalValue === null)
            return originalValue;
        if (this.converter) {
            try {
                return this.converter(originalValue, translations[this.field], data, this.tc, translations)
            } catch (error) {
                this.#logConverterFailure("translate", data, error);
                return undefined;
            }
        } else {
            return translations[this.field];
        }
    }

    /**
     * Extracts the value corresponding to the field path configured within the passed data.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extractValue(data);
     * console.log(value) // -> "bla bla"
     *
     * @param data
     * @returns {*}
     */
    extractValue(data) {
        return this.path.split('.').reduce((o, k) => {
            return o && o[k];
        }, data);
    }


    /**
     * Extract the value corresponding to the field path in object format.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extractValue(data);
     * console.log(value) // -> { "desc": "bla bla" }
     *
     * @param data
     * @returns {*}
     */
    extract(data, options = {}) {
        const value = this.extractValue(data);

        if (!this.converter) {
            return {[this.field]: value};
        }

        if (typeof this.converter.extract !== "function") {
            options.onSkippedDynamicField?.({
                field: this.field,
                path: this.path,
                mapping: this.mapping,
                reason: "missing_converter_extract",
            });
            return undefined;
        }

        let extracted;
        try {
            extracted = this.converter.extract(value, data, this.tc, {
                field: this.field,
                path: this.path,
                mapping: this.mapping,
                options,
            });
        } catch (error) {
            this.#logConverterFailure("extract", data, error);
            return undefined;
        }

        if (typeof extracted === "undefined") {
            return undefined;
        }

        return {[this.field]: extracted};
    }

    #logConverterFailure(phase, data, error) {
        const pack = this.tc?.metadata?.id ?? this.tc?.metadata?.name ?? "unknown";
        const converter = this.converterName ?? "anonymous";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${phase}::${pack}::${this.field}::${converter}::${errorMessage}`;

        if (FieldMapping.#warnedConverterFailures.has(warningKey)) {
            return;
        }

        FieldMapping.#warnedConverterFailures.add(warningKey);
        console.error(`Babele | converter '${converter}' failed during ${phase}`, {
            pack,
            field: this.field,
            path: this.path,
            converter,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            error: errorMessage,
        });
    }

    /**
     * If this field mapping is based on a converter.
     *
     * @returns {boolean} true if is based on a converter.
     */
    isDynamic() {
        return this.dynamic;
    }
}
