import {createMappedCompendium} from "./mapped-compendium-decorator.js";
import {CompendiumRuntime} from "./compendium-runtime.js";
import {TranslationResolver} from "./translation-resolver.js";

/**
 * Utility class with all predefined converters
 */
export class Converters {
    static REGION_BEHAVIOR_TRANSLATION_FIELDS = Object.freeze({
        displayScrollingText: [
            {
                translationPath: ["text"],
                dataPath: ["system", "text"],
            },
        ],
        teleportToken: [
            {
                translationPath: ["dialog", "revealed"],
                dataPath: ["system", "dialog", "revealed"],
            },
            {
                translationPath: ["dialog", "unrevealed"],
                dataPath: ["system", "dialog", "unrevealed"],
            },
        ],
    });

    /**
     * Normalize Foundry collections, arrays, and collection-like objects to a
     * plain array so converters can iterate uniformly.
     *
     * @param {*} collection
     * @returns {Array<*>}
     */
    static _asArray(collection) {
        if (!collection) {
            return [];
        }

        if (Array.isArray(collection)) {
            return collection;
        }

        return collection.contents ?? Array.from(collection);
    }

    /**
     * Choose a stable export key for an embedded document, preferring human
     * readable names and falling back to ids when duplicates occur.
     *
     * @param {object} data
     * @param {Set<string>} usedKeys
     * @param {string} [fallbackPrefix]
     * @returns {string}
     */
    static _exportKeyFor(data, usedKeys, fallbackPrefix = "entry") {
        const candidates = [data?.name, data?._id, data?.id].filter(Boolean);

        for (const key of candidates) {
            if (!usedKeys.has(key)) {
                usedKeys.add(key);
                return key;
            }
        }

        let index = usedKeys.size;
        let fallback = `${fallbackPrefix}-${index}`;
        while (usedKeys.has(fallback)) {
            index += 1;
            fallback = `${fallbackPrefix}-${index}`;
        }
        usedKeys.add(fallback);
        return fallback;
    }

    /**
     * Read a nested property by path without depending on Foundry helpers.
     *
     * @param {object|null|undefined} value
     * @param {string[]} path
     * @returns {*}
     */
    static _readPath(value, path) {
        return path.reduce((current, segment) => current?.[segment], value);
    }

    /**
     * Assign a nested property by path, creating missing intermediate objects.
     *
     * @param {object} target
     * @param {string[]} path
     * @param {*} value
     */
    static _writePath(target, path, value) {
        let current = target;

        for (let index = 0; index < path.length - 1; index += 1) {
            const segment = path[index];
            current[segment] ??= {};
            current = current[segment];
        }

        current[path.at(-1)] = value;
    }

    /**
     * Return the supported translation field descriptors for a RegionBehavior type.
     *
     * @param {string} type
     * @returns {Array<{translationPath: string[], dataPath: string[]}>}
     */
    static _regionBehaviorFields(type) {
        return Converters.REGION_BEHAVIOR_TRANSLATION_FIELDS[type] ?? [];
    }

    /**
     * Extract supported text-bearing RegionBehavior fields into translation JSON.
     *
     * @param {object} data
     * @returns {object}
     */
    static _extractRegionBehaviorFields(data) {
        return Converters._regionBehaviorFields(data?.type).reduce((out, descriptor) => {
            const value = Converters._readPath(data, descriptor.dataPath);
            if (typeof value !== "undefined" && value !== null && value !== "") {
                Converters._writePath(out, descriptor.translationPath, value);
            }
            return out;
        }, {});
    }

    /**
     * Build the merge payload for supported RegionBehavior text fields.
     *
     * @param {object} data
     * @param {object} translation
     * @returns {object}
     */
    static _translatedRegionBehaviorFields(data, translation) {
        return Converters._regionBehaviorFields(data?.type).reduce((out, descriptor) => {
            const value = Converters._readPath(translation, descriptor.translationPath);
            if (typeof value !== "undefined") {
                Converters._writePath(out, descriptor.dataPath, value);
            }
            return out;
        }, {});
    }

    /**
     * Extract a translation JSON fragment for an embedded document collection
     * by delegating each document extraction to the effective embedded
     * compendium context.
     *
     * @param {Array<object>|*} entities
     * @param {*} contextPack
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    static _extractEmbeddedCollection(entities, contextPack, runtime = {}) {
        const activeRuntime = Converters._runtimeWithContextCompendium(contextPack, runtime);
        const usedKeys = new Set();

        return Converters._asArray(entities).reduce((out, entity) => {
            const key = Converters._exportKeyFor(entity, usedKeys, "embedded");
            out[key] = contextPack.extract(entity, activeRuntime);
            return out;
        }, {});
    }

    /**
     * Normalize translation entries to an object keyed by translation id.
     *
     * Accepts both legacy array-shaped payloads and the object form used by
     * Transifex-compatible files.
     *
     * @param {object|Array<object>|null} translations
     * @returns {object}
     */
    static _translationMap(translations) {
        if (!translations) {
            return {};
        }

        if (!Array.isArray(translations)) {
            return translations;
        }

        return translations.reduce((out, translation) => {
            if (translation?.id) {
                out[translation.id] = translation;
            }
            return out;
        }, {});
    }

    /**
     * Resolve the inline translation entry matched for an embedded document.
     *
     * @param {object} data
     * @param {object|Array<object>|null} translations
     * @param {object} [context]
     * @returns {object|null}
     */
    static _resolvedTranslation(data, translations, context = {}) {
        if (!translations) {
            return null;
        }

        return new TranslationResolver(Converters._translationMap(translations)).translationFor(data, context);
    }

    /**
     * Build the effective compendium context used to translate or extract an
     * embedded document collection.
     *
     * The effective context merges:
     * - the runtime-local compendium for the document type, if present
     * - inline translations declared on the parent document
     * - the mapping chosen by the converter
     *
     * Inline translations intentionally override scoped pack translations for
     * the same embedded document, mirroring the historical `fromPack`
     * semantics where parent-provided overrides win.
     *
     * @param {string} documentType
     * @param {object} [options]
     * @param {object|null} [options.mapping]
     * @param {object|Array<object>|null} [options.translations]
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [options.runtime]
     * @returns {*}
     */
    static _embeddedContextPack(documentType, {mapping = null, translations = null, runtime = {}} = {}) {
        const activeRuntime = CompendiumRuntime.from(runtime);
        const scopedPack = activeRuntime.localMappedCompendiumFor(documentType);
        const payload = {};
        const baseEntries = scopedPack ? Converters._translationMap(scopedPack.translations) : {};
        const inlineEntries = Converters._translationMap(translations);
        const entries = {
            ...baseEntries,
            ...inlineEntries,
        };
        const effectiveMapping = mapping ?? scopedPack?.customMapping ?? null;

        if (effectiveMapping !== null) {
            payload.mapping = effectiveMapping;
        }

        if (Object.keys(entries).length > 0) {
            payload.entries = entries;
        }

        if (scopedPack?.reference?.length) {
            payload.reference = [...scopedPack.reference];
        }

        if (scopedPack?.types?.length) {
            payload.types = [...scopedPack.types];
        }

        return createMappedCompendium(
            scopedPack?.metadata ? {...scopedPack.metadata} : {type: documentType},
            Object.keys(payload).length > 0 ? payload : null,
            {
                translationStrategies: scopedPack?.translationMatchStrategies?.()
                    ?? game.babele?.translationMatchStrategies?.(),
            },
        );
    }

    static _runtimeWithContextCompendium(contextPack, runtime = {}) {
        const activeRuntime = CompendiumRuntime.from(runtime);
        return activeRuntime.currentCompendium() === contextPack
            ? activeRuntime
            : activeRuntime.child({currentCompendium: contextPack});
    }

    /**
     * Build a converter for embedded document collections whose effective
     * mapping is provided directly by the converter declaration.
     *
     * Typical use case: fields like `Actor.items`, where Babele knows that the
     * field contains embedded documents and should translate each document
     * recursively, first using any inline overrides and then falling back to
     * visible translated packs in runtime.
     *
     * Converter callback contract:
     * `(value, translation, data, tc, allTranslations, runtime) => translatedValue`
     *
     * `tc` is kept for backward compatibility with existing third-party
     * converters, but internal Babele converters should treat
     * `runtime.currentCompendium()` as the authoritative active context.
     *
     * @param {object|null} mapping
     * @param {string} documentType
     * @returns {function(*, *=): *}
     */
    static fromPack(mapping, documentType = 'Item') {
        const fn = function (items, translations, data, tc, _allTranslations, runtime = {}) {
            const contextPack = Converters._embeddedContextPack(documentType, {
                mapping,
                translations,
                runtime,
            });

            return Converters._fromPack(items, contextPack, runtime);
        };

        fn.extract = function (items, data, tc, context) {
            const runtime = context.runtime;
            const contextPack = Converters._embeddedContextPack(documentType, {
                mapping,
                runtime,
            });

            return Converters._extractEmbeddedCollection(items, contextPack, runtime);
        };

        return fn;
    }

    /**
     * Build a converter for Adventure embedded document collections whose
     * mapping is resolved from the parent Adventure mapping block.
     *
     * This reuses the same embedded translation flow as `fromPack`, but the
     * mapping comes from `tc.customMapping[mappingKey]` so each Adventure can
     * define additional translated fields for its embedded document type.
     *
     * As with `fromPack`, the runtime carries the active embedded compendium
     * context. The `tc` callback parameter remains available only for
     * compatibility with existing custom converters.
     *
     * @param {string} documentType
     * @param {string} mappingKey
     * @returns {function(*, *=): *}
     */
    static fromDefaultMapping(documentType, mappingKey) {
        const fn = function (entities, translations, data, tc, _allTranslations, runtime = {}) {
            const contextPack = Converters._embeddedContextPack(documentType, {
                mapping: tc.customMapping?.[mappingKey] ?? {},
                translations,
                runtime,
            });

            return Converters._fromPack(entities, contextPack, runtime);
        };

        fn.extract = function (entities, data, tc, context) {
            const runtime = context.runtime;
            const contextPack = Converters._embeddedContextPack(documentType, {
                mapping: tc.customMapping?.[mappingKey] ?? {},
                runtime,
            });

            return Converters._extractEmbeddedCollection(entities, contextPack, runtime);
        };

        return fn;
    }

    /**
     * Translate embedded document collections using the effective embedded
     * compendium first, then falling back to the translated packs visible in
     * the current runtime.
     *
     * This is the shared execution path behind `fromPack` and
     * `fromDefaultMapping`: both resolve an effective embedded compendium
     * context, then delegate the per-document translation logic here.
     *
     * The active embedded compendium is pushed into `runtime.currentCompendium`
     * before any nested translation occurs, so recursive converters resolve
     * their context from runtime instead of relying on captured `tc` state.
     *
     * @param {Array<object>} entities
     * @param {*} contextPack
     * @param {import("./compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {Array<object>}
     */
    static _fromPack(entities, contextPack, runtime = {}) {
        const activeRuntime = Converters._runtimeWithContextCompendium(contextPack, runtime);
        const currentCompendium = activeRuntime.currentCompendium();

        return entities.map((data) => {
            if (currentCompendium?.hasTranslation(data, currentCompendium.metadata?.type ?? null)) {
                return currentCompendium.translate(data, false, activeRuntime);
            }

            const documentType = currentCompendium?.metadata?.type ?? null;
            const pack = activeRuntime.translatedPackFor(documentType, data);

            return pack ? pack.translate(data, false, activeRuntime) : data;
        });
    }

    /**
     * Build a simple dynamic converter that maps a field to another translated
     * field of the same document through the current compendium context.
     *
     * The active compendium should be read from `runtime.currentCompendium()`;
     * the `tc` callback parameter is retained only for backward compatibility.
     *
     * @param {string} field
     * @returns {function(*, *, *=, *): *|{translated}}
     */
    static mappedField(field) {
        return function (value, translation, data, tc, _allTranslations, runtime = {}) {
            return tc.translateField(field, data, runtime);
        }
    }

    /**
     * Build a converter for collections of plain objects keyed by one of their
     * fields rather than by document identity.
     *
     * @param {string} field
     * @returns {function(*, *=): *}
     */
    static fieldCollection(field) {
        const fn = function (collection, translations) {
            if (!translations) {
                return collection;
            }

            return collection.map(data => {
                const translation = translations[data[field]];
                if (!translation) {
                    return data;
                }

                return foundry.utils.mergeObject(data, {[field]: translation, translated: true});
            });
        };

        fn.extract = function (collection) {
            return Converters._asArray(collection).reduce((out, data) => {
                const key = data?.[field];
                if (key) {
                    out[key] = key;
                }
                return out;
            }, {});
        };

        return fn;
    }

    static _tableResults(results, translations) {
        return results.map(data => {
            if (translations) {
                const translation = translations[data._id] || translations[`${data.range[0]}-${data.range[1]}`];
                if (translation) {
                    if (typeof translation === "string") {
                        data = foundry.utils.mergeObject(data, foundry.utils.mergeObject({'description': translation}, {translated: true}));
                    } else {
                        const range = translation.range ?? data.range;
                        data = foundry.utils.mergeObject(data, {
                            name: translation.name ?? data.name,
                            img: translation.img ?? data.img,
                            weight: translation.weight ?? data.weight,
                            range: { '0': range[0], '1': range[1] },
                            description: translation.description ?? data.description,
                            translated: true
                        });
                    }
                }
            }
            if (data.documentUuid) {
                const text = game.babele.translateField('name', foundry.utils.parseUuid(data.documentUuid).collection.collection, {'name': data.name});
                if (text) {
                    return foundry.utils.mergeObject(data, foundry.utils.mergeObject({'name': text}, {translated: true}));
                } else {
                    return data;
                }
            }
            return data;
        });
    }

    static tableResults() {
        const fn = function (results, translations) {
            return Converters._tableResults(results, translations);
        };

        fn.extract = function (results) {
            const out = {};

            for (const data of Converters._asArray(results)) {
                const rangeKey = Number.isInteger(data?.range?.[0]) && Number.isInteger(data?.range?.[1])
                    ? `${data.range[0]}-${data.range[1]}`
                    : null;
                const key = rangeKey ?? data?._id;
                if (!key) {
                    continue;
                }

                const description = data.description ?? data.text;
                const extracted = {};
                if (data.name) {
                    extracted.name = data.name;
                }
                if (description) {
                    extracted.description = description;
                }

                if (Object.keys(extracted).length > 0) {
                    out[key] = extracted;
                }
            }

            return out;
        };

        return fn;
    }

    static tableResultsCollection() {
        const fn = function (collection, translations) {
            if (!translations) {
                return collection;
            }

            return collection.map(data => {
                const translation = Converters._resolvedTranslation(data, translations, {documentType: "RollTable"});
                if (!translation) {
                    return data;
                }

                const translated = {
                    translated: true,
                };

                if (typeof translation.name !== "undefined") {
                    translated.name = translation.name;
                }
                if (typeof translation.description !== "undefined") {
                    translated.description = translation.description;
                }
                if (typeof translation.results !== "undefined") {
                    translated.results = Converters._tableResults(data.results, translation.results);
                }

                return foundry.utils.mergeObject(data, translated);
            });
        };

        fn.extract = function (collection) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(collection)) {
                const key = Converters._exportKeyFor(data, usedKeys, "table");
                const extracted = {};
                if (data.name) {
                    extracted.name = data.name;
                }
                if (typeof data.description !== "undefined" && data.description !== null && data.description !== "") {
                    extracted.description = data.description;
                }
                const results = Converters.tableResults().extract(data.results);
                if (Object.keys(results).length > 0) {
                    extracted.results = results;
                }
                if (Object.keys(extracted).length > 0) {
                    out[key] = extracted;
                }
            }

            return out;
        };

        return fn;
    }

    static _pages(pages, translations) {
        return pages.map(data => {
            if (!translations) {
                return data;
            }

            const translation = Converters._resolvedTranslation(data, translations, {documentType: "JournalEntryPage"});
            if (!translation) {
                return data;
            }

            return foundry.utils.mergeObject(data, {
                name: translation.name,
                image: {caption: translation.caption ?? data.image.caption},
                src: translation.src ?? data.src,
                text: {content: translation.text ?? data.text.content},
                video: {
                    width: translation.width ?? data.video.width,
                    height: translation.height ?? data.video.height,
                },
                translated: true,
            });
        });
    }

    static pages() {
        const fn = function (pages, translations) {
            return Converters._pages(pages, translations);
        };

        fn.extract = function (pages) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(pages)) {
                const key = Converters._exportKeyFor(data, usedKeys, "page");
                const extracted = {};
                if (data.name) {
                    extracted.name = data.name;
                }
                if (typeof data.image?.caption !== "undefined" && data.image.caption !== null && data.image.caption !== "") {
                    extracted.caption = data.image.caption;
                }
                if (typeof data.src !== "undefined" && data.src !== null && data.src !== "") {
                    extracted.src = data.src;
                }
                if (typeof data.text?.content !== "undefined" && data.text.content !== null && data.text.content !== "") {
                    extracted.text = data.text.content;
                }
                if (typeof data.video?.width !== "undefined") {
                    extracted.width = data.video.width;
                }
                if (typeof data.video?.height !== "undefined") {
                    extracted.height = data.video.height;
                }
                if (Object.keys(extracted).length > 0) {
                    out[key] = extracted;
                }
            }

            return out;
        };

        return fn;
    }

    static deckCards() {
        const fn = function (cards, translations) {
            return Converters._deckCards(cards, translations);
        }

        fn.extract = function (cards) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(cards)) {
                const key = Converters._exportKeyFor(data, usedKeys, "card");
                const extracted = {};
                if (data.name) {
                    extracted.name = data.name;
                }
                if (typeof data.description !== "undefined" && data.description !== null && data.description !== "") {
                    extracted.description = data.description;
                }
                if (typeof data.suit !== "undefined" && data.suit !== null && data.suit !== "") {
                    extracted.suit = data.suit;
                }

                const faces = (data.faces ?? []).map((face) => {
                    const extractedFace = {};
                    if (typeof face?.img !== "undefined" && face.img !== null && face.img !== "") {
                        extractedFace.img = face.img;
                    }
                    if (face?.name) {
                        extractedFace.name = face.name;
                    }
                    if (typeof face?.text !== "undefined" && face.text !== null && face.text !== "") {
                        extractedFace.text = face.text;
                    }
                    return extractedFace;
                }).filter((face) => Object.keys(face).length > 0);
                if (faces.length > 0) {
                    extracted.faces = faces;
                }

                const back = {};
                if (typeof data.back?.img !== "undefined" && data.back.img !== null && data.back.img !== "") {
                    back.img = data.back.img;
                }
                if (data.back?.name) {
                    back.name = data.back.name;
                }
                if (typeof data.back?.text !== "undefined" && data.back.text !== null && data.back.text !== "") {
                    back.text = data.back.text;
                }
                if (Object.keys(back).length > 0) {
                    extracted.back = back;
                }

                if (Object.keys(extracted).length > 0) {
                    out[key] = extracted;
                }
            }

            return out;
        };

        return fn;
    }

    static _deckCards(cards, translations) {
        return cards.map(data => {
            if (translations) {
                const translation = Converters._resolvedTranslation(data, translations, {documentType: "Card"});
                if (translation) {
                    return foundry.utils.mergeObject(data, {
                        name: translation.name ?? data.name,
                        description: translation.description ?? data.description,
                        suit: translation.suit ?? data.suit,
                        faces: (translation.faces ?? []).map((face, faceIndex) => {
                            const faceData = data.faces[faceIndex];
                            return foundry.utils.mergeObject(faceData ?? {}, {
                                img: face.img ?? faceData.img,
                                name: face.name ?? faceData.name,
                                text: face.text ?? faceData.text,
                            });
                        }),
                        back: {
                            img: translation.back?.img ?? data.back.img,
                            name: translation.back?.name ?? data.back.name,
                            text: translation.back?.text ?? data.back.text,
                        },
                        translated: true,
                    });
                }
            }

            return data;
        });
    }

    static playlistSounds() {
        const fn = function (sounds, translations) {
            return Converters._playlistSounds(sounds, translations);
        }

        fn.extract = function (sounds) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(sounds)) {
                const key = Converters._exportKeyFor(data, usedKeys, "sound");
                const extracted = {};
                if (data.name) {
                    extracted.name = data.name;
                }
                if (typeof data.description !== "undefined" && data.description !== null && data.description !== "") {
                    extracted.description = data.description;
                }
                if (Object.keys(extracted).length > 0) {
                    out[key] = extracted;
                }
            }

            return out;
        };

        return fn;
    }

    static _playlistSounds(sounds, translations) {
        return sounds.map(data => {
            if (translations) {
                const translation = Converters._resolvedTranslation(data, translations, {documentType: "PlaylistSound"});
                if (translation) {
                    return foundry.utils.mergeObject(data, {
                        name: translation.name ?? data.name,
                        description: translation.description ?? data.description,
                        translated: true,
                    });
                }
            }

            return data;
        });
    }

    static sceneRegions() {
        const fn = function (regions, translations) {
            return Converters._sceneRegions(regions, translations);
        }

        fn.extract = function (regions) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(regions)) {
                const key = Converters._exportKeyFor(data, usedKeys, "region");
                out[key] = {
                    name: data.name,
                    behaviors: Converters._extractRegionBehaviors(data.behaviors),
                };
            }

            return out;
        };

        return fn;
    }

    static _sceneRegions(regions, translations) {
        if (!translations) return regions;

        return regions.map(data => {
            const translation = Converters._resolvedTranslation(data, translations, {documentType: "Region"});
            if (!translation) return data;

            return foundry.utils.mergeObject(data, {
                name: translation.name ?? data.name,
                behaviors: Converters._regionBehaviors(data.behaviors, translation.behaviors),
                translated: true
            });            
        });
    }

    static _regionBehaviors(behaviors, translations) {
        if (!translations) return behaviors;

        return behaviors.map(data => {
            const translation = Converters._resolvedTranslation(data, translations, {documentType: "RegionBehavior"});
            if (!translation) return data;

            return foundry.utils.mergeObject(data, {
                name: translation.name ?? data.name,
                ...Converters._translatedRegionBehaviorFields(data, translation),
                translated: true
            });
        });
    }

    static _extractRegionBehaviors(behaviors) {
        const out = {};
        const usedKeys = new Set();

        for (const data of Converters._asArray(behaviors)) {
            const key = Converters._exportKeyFor(data, usedKeys, "behavior");
            out[key] = {
                name: data.name,
                ...Converters._extractRegionBehaviorFields(data),
            };
        }

        return out;
    }
}
