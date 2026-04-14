import Babel from "./babele.js";

/**
 * Class to map, translate or extract value for a single field defined by a mapping.
 *
 * ex: new FieldMapping("desc", "data.description.value")
 */
export class FieldMapping {
    static #warnedConverterFailures = new Set();

    constructor(field, mapping) {
        this.field = field;
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

    #contextCompendium(runtime = {}) {
        return runtime?.currentCompendium?.() ?? null;
    }

    /**
     * Extract the
     *
     * @param data the original entity data to translate
     * @param translations the static available translations for the entity
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {{}} an object with expanded field path and a translated value.
     */
    map(data, translations, runtime = {}) {
        const map = {};
        const value = this.translate(data, translations, runtime);
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
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translate(data, translations, runtime = {}) {
        const originalValue = this.extractValue(data);
        if (typeof originalValue === "undefined" || originalValue === null)
            return originalValue;
        const contextCompendium = this.#contextCompendium(runtime);
        if (this.converter) {
            try {
                return this.converter(originalValue, translations[this.field], data, contextCompendium, translations, runtime)
            } catch (error) {
                this.#logConverterFailure("translate", data, error, runtime);
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
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extract(data, runtime = {}) {
        const value = this.extractValue(data);

        if (!this.converter) {
            return {[this.field]: value};
        }

        if (typeof this.converter.extract !== "function") {
            runtime.onSkippedDynamicField?.({
                field: this.field,
                path: this.path,
                mapping: this.mapping,
                reason: "missing_converter_extract",
            });
            return undefined;
        }

        let extracted;
        const contextCompendium = this.#contextCompendium(runtime);
        try {
            // Dynamic converter extraction receives field metadata plus the
            // current runtime so embedded lookups can stay within scope.
            extracted = this.converter.extract(value, data, contextCompendium, {
                field: this.field,
                path: this.path,
                mapping: this.mapping,
                runtime,
            });
        } catch (error) {
            this.#logConverterFailure("extract", data, error, runtime);
            return undefined;
        }

        if (typeof extracted === "undefined") {
            return undefined;
        }

        return {[this.field]: extracted};
    }

    #logConverterFailure(phase, data, error, runtime = {}) {
        const contextCompendium = this.#contextCompendium(runtime);
        const pack = contextCompendium?.metadata?.id ?? contextCompendium?.metadata?.name ?? "unknown";
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
