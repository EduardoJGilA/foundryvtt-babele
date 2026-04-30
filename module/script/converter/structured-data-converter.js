import {FieldMapping} from "../mapping/field-mapping.js";
import {ConverterRegistry} from "./converter-registry.js";

/**
 * Built-in OO converter for nested structured data that is not a Foundry Document.
 *
 * It applies a local field mapping to one or many plain objects, without any
 * compendium/runtime lookup semantics.
 */
export class StructuredDataConverter {

    #resolveParams;

    /**
     * @param {object|function(object): object} [params]
     */
    constructor(params = {}) {
        this.#resolveParams = typeof params === "function" ? params : () => params;
    }

    prepare(_context) {
        return undefined;
    }

    translate(context) {
        const configured = this._context(context);
        const descriptor = this._descriptor(configured);
        const entries = this._entries(configured.value, descriptor);
        const translations = this._translations(configured.translation, descriptor, entries);
        const translated = entries.map((entry, index) => ({
            ...entry,
            value: this._translateValue(
                entry.value,
                translations[index],
                descriptor,
                configured,
                configured.runtime,
                entry.sourceKey,
            ),
        }));

        return this._output(translated, descriptor);
    }

    extract(context) {
        const configured = this._context(context);
        const descriptor = this._descriptor(configured);
        const entries = this._entries(configured.value, descriptor);
        const extracted = entries.map((entry) => this._extractValue(
            entry.value,
            descriptor,
            configured,
            configured.runtime,
            entry.sourceKey,
        ));

        return this._extractedOutput(extracted, entries, descriptor);
    }

    _context(context) {
        const defaultParams = this.#resolveParams(context) ?? {};
        const path = context.path ?? defaultParams.path ?? context.field;

        return {
            ...context,
            field: context.field ?? path,
            path,
            params: {
                ...defaultParams,
                ...(context.params ?? {}),
                converter: "structured",
            },
        };
    }

    _descriptor(context) {
        return {
            cardinality: context.params?.cardinality ?? "many",
            container: context.params?.container === "keyed" ? "keyed" : "array",
            mapping: context.params?.mapping ?? {},
            keys: this._identityKeys(context.params),
            valuePath: context.params?.valuePath ?? null,
            compact: context.params?.compact === true,
        };
    }

    _fields(mapping, context = {}) {
        const converterRegistry = context.contextCompendium?.documentMappings?.converterRegistry
            ?? new ConverterRegistry();
        return Object.entries(mapping ?? {}).map(([field, value]) => new FieldMapping(field, value, converterRegistry));
    }

    _entries(value, descriptor = {}) {
        if (descriptor.cardinality === "one") {
            return (typeof value === "undefined" || value === null) ? [] : [{sourceKey: null, value}];
        }

        if (!value) {
            return [];
        }

        if (descriptor.container === "keyed") {
            return Object.entries(value).map(([sourceKey, entryValue]) => ({
                sourceKey,
                value: entryValue,
            }));
        }

        return this._arrayValues(value).map((entryValue, index) => ({
            sourceKey: String(index),
            value: entryValue,
        }));
    }

    _arrayValues(value) {
        if (!value) {
            return [];
        }

        if (Array.isArray(value)) {
            return value;
        }

        return value.contents ?? Array.from(value);
    }

    _translations(translation, descriptor, entries) {
        if (!translation) {
            return entries.map(() => undefined);
        }

        if (descriptor.cardinality === "one") {
            return [translation];
        }

        if (descriptor.container === "keyed") {
            return entries.map((entry) => {
                for (const key of this._translationLookupKeys(entry, descriptor)) {
                    if (typeof translation[key] !== "undefined") {
                        return translation[key];
                    }
                }

                return translation[entry.sourceKey];
            });
        }

        if (Array.isArray(translation)) {
            return entries.map((_, index) => translation[index]);
        }

        if (descriptor.keys.length) {
            return entries.map((entry) => this._translationForKeys(translation, entry, descriptor));
        }

        return entries.map(() => undefined);
    }

    _fieldRuntime(runtime = {}, sourceKey = null) {
        if (sourceKey === null || typeof sourceKey === "undefined") {
            return runtime;
        }

        return {
            runtime,
            sourceKey,
        };
    }

    _translateValue(value, translation, descriptor, context = {}, runtime = {}, sourceKey = null) {
        if (typeof translation === "undefined" || translation === null || !value) {
            return value;
        }

        if (descriptor.valuePath && !this._isPlainObject(translation)) {
            return this._translateScalarValue(value, translation, descriptor.valuePath);
        }

        const fields = this._fields(descriptor.mapping, context);
        const fieldRuntime = this._fieldRuntime(runtime, sourceKey);
        const mapped = fields.reduce((out, field) => {
            field.prepare(value, translation, fieldRuntime);
            return foundry.utils.mergeObject(out, field.map(value, translation, fieldRuntime));
        }, {});

        return foundry.utils.mergeObject(value, mapped, {inplace: false});
    }

    _extractValue(value, descriptor, context = {}, runtime = {}, sourceKey = null) {
        if (descriptor.valuePath) {
            return foundry.utils.getProperty(value, descriptor.valuePath);
        }

        const fields = this._fields(descriptor.mapping, context);
        const fieldRuntime = this._fieldRuntime(runtime, sourceKey);
        return fields.reduce((out, field) => {
            const extracted = field.extract(value, fieldRuntime);
            if (typeof extracted === "undefined") {
                return out;
            }

            const filtered = Object.fromEntries(
                Object.entries(extracted).filter(([, extractedValue]) => typeof extractedValue !== "undefined"),
            );

            if (Object.keys(filtered).length === 0) {
                return out;
            }

            return foundry.utils.mergeObject(out, filtered);
        }, {});
    }

    _output(entries, descriptor) {
        if (descriptor.cardinality === "one") {
            return entries[0]?.value ?? null;
        }

        if (descriptor.container === "keyed") {
            return entries.reduce((out, entry) => {
                out[entry.sourceKey] = entry.value;
                return out;
            }, {});
        }

        return entries.map((entry) => entry.value);
    }

    _extractedOutput(extracted, entries, descriptor) {
        if (descriptor.cardinality === "one") {
            return extracted[0];
        }

        if (descriptor.container === "keyed") {
            return entries.reduce((out, entry, index) => {
                const value = extracted[index] ?? {};
                if (descriptor.compact && Object.keys(value).length === 0) {
                    return out;
                }

                out[this._extractedEntryKey(entry, descriptor, out)] = value;
                return out;
            }, {});
        }

        if (descriptor.keys.length) {
            return entries.reduce((out, entry, index) => {
                const key = this._translationLookupKey(entry, descriptor);
                if (key) {
                    out[key] = extracted[index];
                }
                return out;
            }, {});
        }

        return descriptor.compact ? extracted.filter((value) => Object.keys(value ?? {}).length > 0) : extracted;
    }

    /**
     * Resolve the translator-facing lookup key for one entry.
     *
     * Keyed containers default to `sourceKey`, but when `key` or `keys` is
     * configured they can match by properties inside each value object instead.
     *
     * @param {{sourceKey: string|null, value: *}} entry
     * @param {{keys: string[]}} descriptor
     * @returns {string|null}
     */
    _translationLookupKey(entry, descriptor) {
        if (!descriptor.keys.length) {
            return entry.sourceKey;
        }

        return this._translationLookupKeys(entry, descriptor)[0] ?? null;
    }

    /**
     * Resolve the extracted output key for one keyed entry.
     *
     * When `key` or `keys` is configured Babele exports keyed collections using that
     * property so the extracted payload matches the expected translation
     * template. If the property is missing or collides with an existing key,
     * extraction falls back to the original `sourceKey`.
     *
     * @param {{sourceKey: string|null, value: *}} entry
     * @param {{keys: string[]}} descriptor
     * @param {object} output
     * @returns {string}
     */
    _extractedEntryKey(entry, descriptor, output = {}) {
        for (const preferred of this._translationLookupKeys(entry, descriptor)) {
            if (!Object.hasOwn(output, preferred)) {
                return preferred;
            }
        }

        return entry.sourceKey;
    }

    /**
     * Read and normalize a translator-facing key from a nested object.
     *
     * @param {*} value
     * @param {string} path
     * @returns {string|null}
     */
    _normalizedEntryKey(value, path) {
        const key = foundry.utils.getProperty(value, path);
        if (key === null || typeof key === "undefined") {
            return null;
        }

        return String(key);
    }

    _identityKeys(params = {}) {
        if (Array.isArray(params?.keys)) {
            return [...new Set(params.keys.filter((key) => typeof key === "string" && key.length))];
        }

        return typeof params?.key === "string" && params.key.length ? [params.key] : [];
    }

    _translationForKeys(translation, entry, descriptor) {
        for (const key of this._translationLookupKeys(entry, descriptor)) {
            if (typeof translation[key] !== "undefined") {
                return translation[key];
            }
        }

        return undefined;
    }

    _translationLookupKeys(entry, descriptor) {
        return descriptor.keys
            .map((key) => this._normalizedEntryKey(entry.value, key))
            .filter((key, index, keys) => key !== null && keys.indexOf(key) === index);
    }

    _translateScalarValue(value, translation, valuePath) {
        return foundry.utils.mergeObject(value, this._objectAtPath(valuePath, translation), {inplace: false});
    }

    _objectAtPath(path, value) {
        const keys = String(path ?? "").split(".").filter((key) => key.length);
        if (!keys.length) {
            return value;
        }

        return keys.reduceRight((out, key) => ({[key]: out}), value);
    }

    _isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
}
