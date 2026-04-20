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
        const values = this._values(configured.value, descriptor.cardinality);
        const translations = this._translations(configured.translation, descriptor, values);
        const translated = values.map((value, index) => this._translateValue(
            value,
            translations[index],
            descriptor,
            configured,
            configured.runtime,
        ));

        return this._output(translated, descriptor);
    }

    extract(context) {
        const configured = this._context(context);
        const descriptor = this._descriptor(configured);
        const values = this._values(configured.value, descriptor.cardinality);
        const extracted = values.map((value) => this._extractValue(value, descriptor, configured, configured.runtime));

        return this._extractedOutput(extracted, values, descriptor);
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

    _values(value, cardinality = "many") {
        if (cardinality === "one") {
            return (typeof value === "undefined" || value === null) ? [] : [value];
        }

        if (!value) {
            return [];
        }

        if (Array.isArray(value)) {
            return value;
        }

        return value.contents ?? Array.from(value);
    }

    _translations(translation, descriptor, values) {
        if (!translation) {
            return values.map(() => undefined);
        }

        if (descriptor.cardinality === "one") {
            return [translation];
        }

        if (Array.isArray(translation)) {
            return values.map((_, index) => translation[index]);
        }

        if (descriptor.key) {
            return values.map((value) => translation[value?.[descriptor.key]]);
        }

        return values.map(() => undefined);
    }

    _translateValue(value, translation, descriptor, context = {}, runtime = {}) {
        if (!translation || !value) {
            return value;
        }

        const fields = this._fields(descriptor.mapping, context);
        const mapped = fields.reduce((out, field) => {
            field.prepare(value, translation, runtime);
            return foundry.utils.mergeObject(out, field.map(value, translation, runtime));
        }, {});

        return foundry.utils.mergeObject(value, mapped, {inplace: false});
    }

    _extractValue(value, descriptor, context = {}, runtime = {}) {
        const fields = this._fields(descriptor.mapping, context);
        return fields.reduce((out, field) => {
            const extracted = field.extract(value, runtime);
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

    _output(values, descriptor) {
        if (descriptor.cardinality === "one") {
            return values[0] ?? null;
        }

        return values;
    }

    _extractedOutput(extracted, values, descriptor) {
        if (descriptor.cardinality === "one") {
            return extracted[0];
        }

        if (descriptor.key) {
            return values.reduce((out, value, index) => {
                const key = value?.[descriptor.key];
                if (key) {
                    out[key] = extracted[index];
                }
                return out;
            }, {});
        }

        return descriptor.compact ? extracted.filter((value) => Object.keys(value ?? {}).length > 0) : extracted;
    }
}
