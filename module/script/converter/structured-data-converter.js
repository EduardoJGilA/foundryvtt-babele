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
            key: context.params?.key ?? null,
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
            return entries.map((entry) => translation[entry.sourceKey]);
        }

        if (Array.isArray(translation)) {
            return entries.map((_, index) => translation[index]);
        }

        if (descriptor.key) {
            return entries.map((entry) => translation[entry.value?.[descriptor.key]]);
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
        if (!translation || !value) {
            return value;
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

                out[entry.sourceKey] = value;
                return out;
            }, {});
        }

        if (descriptor.key) {
            return entries.reduce((out, entry, index) => {
                const key = entry.value?.[descriptor.key];
                if (key) {
                    out[key] = extracted[index];
                }
                return out;
            }, {});
        }

        return descriptor.compact ? extracted.filter((value) => Object.keys(value ?? {}).length > 0) : extracted;
    }
}
