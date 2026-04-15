const warnedConverterFailures = new Set();
const warnedMissingConverters = new Set();
const warnedMissingPaths = new Set();
const warnedInvalidStaticTranslations = new Set();

function missingPathWarningsEnabled() {
    try {
        return game.settings.get("babele", "warnMissingPaths") === true;
    } catch {
        return false;
    }
}

/**
 * Maps, translates and extracts a single field declared by a document mapping.
 *
 * FieldMapping acts as the stable context for one mapped field while delegating
 * the variable behavior to an internal field converter:
 * - static mappings use a default converter that reads and writes a value at the configured path
 * - converter mappings use an adapter around a named registered converter
 *
 * The constructor selects the appropriate field converter from the mapping shape:
 * a string path creates the default field converter, while an object mapping
 * creates an adapter around the named registered converter.
 *
 * Example:
 * new FieldMapping("desc", "data.description.value")
 */
export class FieldMapping {

    #converter;

    /**
     * @param {string} field Translation field key.
     * @param {string|object} mapping Field mapping definition.
     */
    constructor(field, mapping) {
        this.field = field;
        this.mapping = mapping;
        if (typeof mapping === "object") {
            this.path = mapping["path"];
            this.#converter = new RegisteredFieldConverter(mapping["converter"]);
        } else {
            this.path = mapping;
            this.#converter = new DefaultFieldConverter();
        }
    }

    /**
     * Translates this field and expands the translated value back to its full path.
     *
     * Returns an empty object when no translation should be applied. This includes
     * missing translations, missing source paths for static fields, invalid static
     * payloads and converter failures, all of which fail open.
     *
     * @param {object} data Original document source data.
     * @param {object} translations Static translations available for the current document.
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object} An object with the expanded field path and translated value, or an empty object.
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
     * Resolves the translated value for this field.
     *
     * Static fields validate that the source path exists when a translation is
     * provided and reject structural or primitive type mismatches. Dynamic
     * fields delegate to their converter and fail open on missing converters or
     * converter errors.
     *
     * @param {object} data Original document source data.
     * @param {object} translations Static translations available for the current document.
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*} The translated field value, or `undefined` when no value should be merged.
     */
    translate(data, translations, runtime = {}) {
        return this.#converter.translate(this, data, translations, runtime);
    }

    /**
     * Extracts the value corresponding to the field path configured within the passed data.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extractValue(data);
     * console.log(value) // -> "bla bla"
     *
     * Returns `undefined` both when the path is missing and when the path exists
     * but currently stores `undefined`.
     *
     * @param {object} data Original document source data.
     * @returns {*} The value currently stored at the configured path.
     */
    extractValue(data) {
        return this._resolvedPathValue(data).value;
    }


    /**
     * Extracts the current field value in translation-file shape.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extract(data);
     * console.log(value) // -> { "desc": "bla bla" }
     *
     * Static fields always return `{[field]: value}` even when the path is
     * currently missing. Dynamic fields may return `undefined` when extraction
     * is unsupported, the converter is missing or the converter fails.
     *
     * @param {object} data Original document source data.
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object|undefined} The extracted translation fragment, or `undefined` when skipped.
     */
    extract(data, runtime = {}) {
        return this.#converter.extract(this, data, runtime);
    }

    /**
     * Resolves the configured path against the provided document source data.
     *
     * Unlike `extractValue`, this preserves whether the path exists at all so
     * static translation can distinguish a missing branch from an explicit
     * `undefined` value.
     *
     * @param {object} data
     * @returns {{exists: boolean, value: *}}
     * @private
     */
    _resolvedPathValue(data) {
        let current = data;

        for (const key of this.path.split('.')) {
            if (!this._hasOwn(current, key)) {
                return {exists: false, value: undefined};
            }

            current = current[key];
        }

        return {exists: true, value: current};
    }

    /**
     * Safe `hasOwnProperty` check for traversed source values.
     *
     * @param {*} target
     * @param {string} key
     * @returns {boolean}
     * @private
     */
    _hasOwn(target, key) {
        if (target === null || typeof target === "undefined") {
            return false;
        }

        const targetType = typeof target;
        if (targetType !== "object" && targetType !== "function") {
            return false;
        }

        return Object.prototype.hasOwnProperty.call(target, key);
    }


    /**
     * If this field mapping is based on a converter.
     *
     * @returns {boolean} true if is based on a converter.
     */
    isDynamic() {
        return this.#converter.isDynamic();
    }
}

/**
 * Default converter for plain path-based field mappings.
 *
 * Static mappings validate the source path and translated payload before
 * returning the translated value to merge.
 */
class DefaultFieldConverter {

    /**
     * @param {object} data
     * @param {object} translations
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translate(fieldMapping, data, translations, runtime = {}) {
        const translatedValue = translations[fieldMapping.field];
        const original = fieldMapping._resolvedPathValue(data);
        if (!original.exists) {
            if (fieldMapping._hasOwn(translations, fieldMapping.field)) {
                this._logMissingPath(fieldMapping, "translate", data, runtime);
            }
            return undefined;
        }

        const originalValue = original.value;
        if (typeof originalValue === "undefined" || originalValue === null) {
            return originalValue;
        }

        const invalidReason = this._invalidStaticTranslation(originalValue, translatedValue);
        if (invalidReason) {
            this._logInvalidStaticTranslation(fieldMapping, data, originalValue, translatedValue, invalidReason, runtime);
            return undefined;
        }

        return translatedValue;
    }

    /**
     * @param {object} data
     * @returns {object}
     */
    extract(fieldMapping, data) {
        return {[fieldMapping.field]: fieldMapping.extractValue(data)};
    }

    /**
     * @returns {false}
     */
    isDynamic() {
        return false;
    }

    _logMissingPath(fieldMapping, phase, data, runtime = {}) {
        if (!missingPathWarningsEnabled()) {
            return;
        }

        const pack = this._pack(runtime);
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${fieldMapping.path}`;

        if (warnedMissingPaths.has(warningKey)) {
            return;
        }

        warnedMissingPaths.add(warningKey);
        console.warn(`Babele | missing source path for field '${fieldMapping.field}', field skipped during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
        });
    }

    _invalidStaticTranslation(originalValue, translatedValue) {
        if (Array.isArray(translatedValue) || this._isPlainObject(translatedValue)) {
            return "structural";
        }

        if (!this._isPrimitiveTypeGuarded(originalValue)) {
            return null;
        }

        if (typeof translatedValue === "undefined" || translatedValue === null) {
            return null;
        }

        return typeof originalValue === typeof translatedValue ? null : "type_mismatch";
    }

    _isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    _isPrimitiveTypeGuarded(value) {
        const type = typeof value;
        return type === "string" || type === "number" || type === "boolean";
    }

    _valueType(value) {
        if (Array.isArray(value)) {
            return "array";
        }

        if (value === null) {
            return "null";
        }

        return typeof value;
    }

    _logInvalidStaticTranslation(fieldMapping, data, originalValue, translatedValue, reason, runtime = {}) {
        const pack = this._pack(runtime);
        const originalType = this._valueType(originalValue);
        const translatedType = this._valueType(translatedValue);
        const warningKey = `${pack}::${fieldMapping.field}::${fieldMapping.path}::${reason}::${originalType}::${translatedType}`;

        if (warnedInvalidStaticTranslations.has(warningKey)) {
            return;
        }

        warnedInvalidStaticTranslations.add(warningKey);
        console.warn(`Babele | invalid translation payload for static field '${fieldMapping.field}', field skipped`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            reason,
            originalType,
            translatedType,
        });
    }

    _pack(runtime = {}) {
        const compendium = runtime?.currentCompendium?.() ?? null;
        return compendium?.metadata?.id ?? compendium?.metadata?.name ?? "unknown";
    }
}

/**
 * Adapter around a registered converter-backed field mapping.
 *
 * Registered converters keep the public Babele converter contract unchanged,
 * while this adapter exposes the uniform internal field-converter API used by
 * FieldMapping.
 */
class RegisteredFieldConverter {

    constructor(converterName) {
        this.converterName = converterName ?? null;
        this.converter = game.babele.converters[this.converterName];
    }

    /**
     * @param {object} data
     * @param {object} translations
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translate(fieldMapping, data, translations, runtime = {}) {
        if (!this.converter) {
            this._logMissingConverter(fieldMapping, "translate", data, runtime);
            return undefined;
        }

        const originalValue = fieldMapping.extractValue(data);
        if (typeof originalValue === "undefined" || originalValue === null) {
            return originalValue;
        }

        try {
            return this.converter(
                originalValue,
                translations[fieldMapping.field],
                data,
                this._contextCompendium(runtime),
                translations,
                runtime,
            );
        } catch (error) {
            this._logConverterFailure(fieldMapping, "translate", data, error, runtime);
            return undefined;
        }
    }

    /**
     * @param {object} data
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object|undefined}
     */
    extract(fieldMapping, data, runtime = {}) {
        if (!this.converter) {
            this._skipDynamicField(fieldMapping, runtime, "missing_converter");
            this._logMissingConverter(fieldMapping, "extract", data, runtime);
            return undefined;
        }

        if (typeof this.converter.extract !== "function") {
            this._skipDynamicField(fieldMapping, runtime, "missing_converter_extract");
            return undefined;
        }

        try {
            // Dynamic converter extraction receives field metadata plus the
            // current runtime so embedded lookups can stay within scope.
            const extracted = this.converter.extract(
                fieldMapping.extractValue(data),
                data,
                this._contextCompendium(runtime),
                {
                    field: fieldMapping.field,
                    path: fieldMapping.path,
                    mapping: fieldMapping.mapping,
                    runtime,
                },
            );

            if (typeof extracted === "undefined") {
                return undefined;
            }

            return {[fieldMapping.field]: extracted};
        } catch (error) {
            this._logConverterFailure(fieldMapping, "extract", data, error, runtime);
            return undefined;
        }
    }

    /**
     * @returns {true}
     */
    isDynamic() {
        return true;
    }

    _contextCompendium(runtime = {}) {
        return runtime?.currentCompendium?.() ?? null;
    }

    _logConverterFailure(fieldMapping, phase, data, error, runtime = {}) {
        const pack = this._pack(runtime);
        const converter = this.converterName ?? "anonymous";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${converter}::${errorMessage}`;

        if (warnedConverterFailures.has(warningKey)) {
            return;
        }

        warnedConverterFailures.add(warningKey);
        console.error(`Babele | converter '${converter}' failed during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            converter,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            error: errorMessage,
        });
    }

    _logMissingConverter(fieldMapping, phase, data, runtime = {}) {
        const pack = this._pack(runtime);
        const converter = this.converterName ?? "anonymous";
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${converter}`;

        if (warnedMissingConverters.has(warningKey)) {
            return;
        }

        warnedMissingConverters.add(warningKey);
        console.warn(`Babele | missing converter '${converter}' for dynamic field '${fieldMapping.field}', field skipped during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            converter,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
        });
    }

    _skipDynamicField(fieldMapping, runtime = {}, reason) {
        runtime.onSkippedDynamicField?.({
            field: fieldMapping.field,
            path: fieldMapping.path,
            mapping: fieldMapping.mapping,
            reason,
        });
    }

    _pack(runtime = {}) {
        const compendium = this._contextCompendium(runtime);
        return compendium?.metadata?.id ?? compendium?.metadata?.name ?? "unknown";
    }
}
