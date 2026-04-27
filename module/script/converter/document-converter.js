import {EmbeddedCompendium} from "../compendium/embedded-compendium.js";
import {CompendiumRuntime} from "../compendium/compendium-runtime.js";
import {DocumentTranslationScope} from "../compendium/document-translation-scope.js";
import {converterContext} from "./converter-context.js";
import {ExportKeys} from "../identity/export-key-allocator.js";

/**
 * Built-in OO converter for document-valued fields.
 *
 * It resolves the effective embedded document mapping for the configured
 * `documentType`, optionally publishes an `EmbeddedCompendium` before
 * translation starts, and then translates or extracts the embedded documents
 * through that context.
 */
export class DocumentConverter {

    #resolveParams;

    /**
     * @param {object|function(object): object} [params]
     */
    constructor(params = {}) {
        this.#resolveParams = typeof params === "function" ? params : () => params;
    }

    /**
     * Prepare the runtime-local mapped compendium used by this embedded
     * document field before any sibling field translation begins.
     *
     * @param {object} context
     * @returns {{key: string, contextPack: EmbeddedCompendium}}
     */
    prepare(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const key = this._scopeKey(configuredContext, descriptor);

        if (scope.prepared(key)) {
            return scope.prepared(key);
        }

        const contextPack = new EmbeddedCompendium(descriptor.documentType, {
            mapping: descriptor.mapping,
            translations: configuredContext.translation,
            translationStrategies: configuredContext.contextCompendium?.translationMatchStrategies?.(),
            documentMappings: configuredContext.contextCompendium?.documentMappings,
            runtime: scope.runtime(),
        });

        const prepared = {
            key,
            contextPack,
        };

        scope.remember(key, prepared);

        if (descriptor.expose === true) {
            scope.publish(key, contextPack);
        }

        return prepared;
    }

    /**
     * Translate one or many embedded documents through the prepared local
     * mapped compendium and the currently visible runtime packs.
     *
     * @param {object} context
     * @returns {*}
     */
    translate(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const prepared = this.prepare(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const values = this._documentValues(configuredContext.value, descriptor.cardinality);
        const translated = this._fromPack(values, prepared.contextPack, scope.runtime());

        return this._documentOutput(translated, descriptor.cardinality);
    }

    /**
     * Extract one or many embedded documents through the prepared local mapped
     * compendium.
     *
     * @param {object} context
     * @returns {*}
     */
    extract(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const prepared = this.prepare(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const values = this._documentValues(configuredContext.value, descriptor.cardinality);
        const extracted = this._extractEmbeddedCollection(values, prepared.contextPack, scope.runtime());

        if (descriptor.cardinality === "one") {
            return Object.values(extracted)[0];
        }

        return extracted;
    }

    /**
     * Merge constructor-level defaults with the call-site converter context.
     *
     * @param {object} context
     * @returns {object}
     */
    _context(context) {
        const defaultParams = this.#resolveParams(context) ?? {};
        const path = context.path ?? defaultParams.path ?? context.field;

        return converterContext({
            ...context,
            field: context.field ?? path,
            path,
            params: {
                ...defaultParams,
                ...(context.params ?? {}),
                converter: "document",
            },
        });
    }

    /**
     * Resolve the effective structural parameters for the current embedded
     * document field.
     *
     * When the field does not declare an inline `mapping`, the converter falls
     * back to the current compendium custom mapping block keyed by the field
     * path. This keeps Adventure embedded-document fields aligned with the same
     * mapping object shape used by root compendium definitions.
     *
     * @param {object} context
     * @returns {{documentType: string, cardinality: string, expose: boolean, mapping: object|null}}
     */
    _descriptor(context) {
        return {
            documentType: context.params?.documentType,
            cardinality: context.params?.cardinality ?? "many",
            expose: context.params?.expose === true,
            mapping: context.params?.mapping
                ?? context.contextCompendium?.customMapping?.[context.params?.path]
                ?? null,
        };
    }

    /**
     * Build a stable scope key for the prepared embedded compendium of the
     * current field.
     *
     * @param {object} context
     * @param {{documentType: string}} descriptor
     * @returns {string}
     */
    _scopeKey(context, descriptor) {
        const parentPack = CompendiumRuntime.from(context.runtime).currentCompendium()
            ?? context.contextCompendium
            ?? null;
        const parentId = parentPack?.metadata?.id ?? parentPack?.metadata?.name ?? "runtime";
        const sourceId = context.source?._id ?? context.source?.id ?? context.field;
        return `${parentId}::${sourceId}::${context.field}::${descriptor.documentType}`;
    }

    /**
     * Normalize a document-valued field to an array form for translation or
     * extraction.
     *
     * @param {*} value
     * @param {string} [cardinality]
     * @returns {Array<*>}
     */
    _documentValues(value, cardinality = "many") {
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

    /**
     * Restore the original cardinality after translating or extracting in
     * array form.
     *
     * @param {Array<*>} values
     * @param {string} [cardinality]
     * @returns {*}
     */
    _documentOutput(values, cardinality = "many") {
        return cardinality === "one" ? (values[0] ?? null) : values;
    }

    /**
     * Ensure nested translation runs with the embedded mapped compendium as
     * current runtime compendium.
     *
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {import("../compendium/compendium-runtime.js").CompendiumRuntime}
     */
    _runtimeWithContextCompendium(contextPack, runtime = {}) {
        const activeRuntime = CompendiumRuntime.from(runtime);
        return activeRuntime.currentCompendium() === contextPack
            ? activeRuntime
            : activeRuntime.child({currentCompendium: contextPack});
    }

    /**
     * Extract an embedded collection through the prepared local mapped
     * compendium.
     *
     * @param {*} entities
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    _extractEmbeddedCollection(entities, contextPack, runtime = {}) {
        const activeRuntime = this._runtimeWithContextCompendium(contextPack, runtime);
        const keys = new ExportKeys();

        return this._documentValues(entities).reduce((out, entity) => {
            const key = keys.keyFor(entity, "embedded", contextPack.mappingFor(entity));
            out[key] = contextPack.extract(entity, activeRuntime);
            return out;
        }, {});
    }

    /**
     * Translate embedded documents first through the prepared local mapped
     * compendium, then through any other visible mapped compendium of the same
     * document type.
     *
     * @param {Array<object>} entities
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {Array<object>}
     */
    _fromPack(entities, contextPack, runtime = {}) {
        const activeRuntime = this._runtimeWithContextCompendium(contextPack, runtime);
        const currentCompendium = activeRuntime.currentCompendium();

        return entities.map((data) => {
            const currentMapping = currentCompendium?.mappingFor?.(data);
            const shouldTranslateCurrent = currentCompendium?.hasTranslation(data, currentCompendium.metadata?.type ?? null)
                || currentMapping?.usesConverters?.() === true;

            if (shouldTranslateCurrent) {
                const translatedCurrent = currentCompendium.translate(data, false, activeRuntime);
                if (translatedCurrent !== data) {
                    return translatedCurrent;
                }
            }

            const documentType = currentCompendium?.metadata?.type ?? null;
            const pack = activeRuntime.translatedPackFor(documentType, data);

            return pack ? pack.translate(data, false, activeRuntime) : data;
        });
    }
}
