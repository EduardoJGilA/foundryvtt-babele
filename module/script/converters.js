import {CompendiumMapping} from "./compendium-mapping.js";
import {TranslatedCompendium} from "./translated-compendium.js";

const embeddedMappingKeys = {
    Actor: "actors",
    Cards: "cards",
    Item: "items",
    JournalEntry: "journals",
    Macro: "macros",
    Playlist: "playlists",
    RollTable: "tables",
    Scene: "scenes",
};

/**
 * Utility class with all predefined converters
 */
export class Converters {

    static _asArray(collection) {
        if (!collection) {
            return [];
        }

        if (Array.isArray(collection)) {
            return collection;
        }

        return collection.contents ?? Array.from(collection);
    }

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

    static _extractEmbeddedCollection(entities, dynamicMapping, options = {}) {
        const usedKeys = new Set();

        return Converters._asArray(entities).reduce((out, entity) => {
            const key = Converters._exportKeyFor(entity, usedKeys, "embedded");
            out[key] = dynamicMapping.extract(entity, options);
            return out;
        }, {});
    }

    /**
     *
     * @param mapping
     * @param entityType
     * @returns {function(*, *=): *}
     */
    static fromPack(mapping, entityType = 'Item') {
        const fn = function (items, translations, data, tc) {
            const contextPack = game.babele.getRelatedAdventureTranslatedCompendium(tc, embeddedMappingKeys[entityType]);
            if (!contextPack) {
                const dynamicMapping = new CompendiumMapping(entityType, mapping);
                return Converters._fromPack(items, translations, dynamicMapping);
            }

            const dynamicMapping = new CompendiumMapping(entityType, mapping, contextPack);
            return Converters._fromPack(items, translations, dynamicMapping, contextPack);
        };

        fn.extract = function (items, data, tc, context) {
            const contextPack = game.babele.getRelatedAdventureTranslatedCompendium(tc, embeddedMappingKeys[entityType]);
            const dynamicMapping = new CompendiumMapping(entityType, mapping, contextPack ?? tc);

            return Converters._extractEmbeddedCollection(items, dynamicMapping, context.options);
        };

        return fn;
    }

    static fromDefaultMapping(entityType, mappingKey) {
        const fn = function (entities, translations, data, tc) {
            const collection = game.babele.getCollection(tc.metadata);
            const babeleTranslations = game.babele.translations.find((item) => item.collection === collection);
            const customMapping = babeleTranslations && babeleTranslations.mapping
                ? babeleTranslations?.mapping[mappingKey] ?? {}
                : {};
            const contextPack = game.babele.getAdventureEntryTranslatedCompendium(tc.metadata, data, mappingKey)
                ?? new TranslatedCompendium({
                    type: entityType,
                    adventureCollection: collection,
                    adventureEntryKey: tc.translationKeyFor(data),
                }, {
                    mapping: customMapping,
                    entries: translations ?? {},
                });
            const dynamicMapping = new CompendiumMapping(
                entityType,
                customMapping,
                contextPack
            );

            return Converters._fromPack(entities, translations, dynamicMapping, contextPack);
        };

        fn.extract = function (entities, data, tc, context) {
            const collection = game.babele.getCollection(tc.metadata);
            const customMapping = tc.customMapping?.[mappingKey] ?? {};
            const contextPack = game.babele.getAdventureEntryTranslatedCompendium(tc.metadata, data, mappingKey)
                ?? new TranslatedCompendium({
                    type: entityType,
                    packageName: tc.metadata.packageName,
                    packageType: tc.metadata.packageType,
                    adventureCollection: collection,
                    adventureEntryKey: tc.translationKeyFor?.(data) ?? null,
                }, {
                    mapping: customMapping,
                    entries: {},
                });
            const dynamicMapping = new CompendiumMapping(entityType, customMapping, contextPack);

            return Converters._extractEmbeddedCollection(entities, dynamicMapping, context.options);
        };

        return fn;
    }

    static _fromPack(entities, translations, dynamicMapping, priorityPack = null) {
        return entities.map((data) => {
            if (translations) {
                let translation;

                if (Array.isArray(translations)) {
                    translation = translations.find(t => t.id === data._id || t.id === data.name);
                } else {
                    translation = translations[data._id] || translations[data.name];
                }

                if (translation) {
                    const translatedData = dynamicMapping.map(data, translation);

                    return foundry.utils.mergeObject(data, foundry.utils.mergeObject(translatedData, {translated: true}));
                }
            }

            const pack = priorityPack?.translated && priorityPack.hasTranslation(data)
                ? priorityPack
                : game.babele.packs.find(pack => !pack.metadata?.virtual && pack.translated && pack.hasTranslation(data));

            return pack ? pack.translate(data) : data;
        });
    }

    /**
     *
     * @param field
     * @returns {function(*, *, *=, *): *|{translated}}
     */
    static mappedField(field) {
        return function (value, translation, data, tc) {
            return tc.translateField(field, data);
        }
    }

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
                const key = data?._id || `${data.range?.[0]}-${data.range?.[1]}`;
                if (!key) {
                    continue;
                }

                out[key] = {
                    name: data.name,
                    img: data.img,
                    range: data.range,
                    weight: data.weight,
                    description: data.description,
                };
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
                const translation = translations[data.name];
                if (!translation) {
                    return data;
                }

                return foundry.utils.mergeObject(data, {
                    name: translation.name ?? data.name,
                    description: translation.description ?? data.description,
                    results: Converters._tableResults(data.results, translation.results),
                    translated: true,
                });
            });
        };

        fn.extract = function (collection) {
            const out = {};
            const usedKeys = new Set();

            for (const data of Converters._asArray(collection)) {
                const key = Converters._exportKeyFor(data, usedKeys, "table");
                out[key] = {
                    name: data.name,
                    description: data.description,
                    results: Converters.tableResults().extract(data.results),
                };
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

            const translation = translations[data._id] || translations[data.name];
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
                out[key] = {
                    name: data.name,
                    caption: data.image?.caption,
                    src: data.src,
                    text: data.text?.content,
                    width: data.video?.width,
                    height: data.video?.height,
                };
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
                out[key] = {
                    name: data.name,
                    description: data.description,
                    suit: data.suit,
                    faces: (data.faces ?? []).map(face => ({
                        img: face.img,
                        name: face.name,
                        text: face.text,
                    })),
                    back: {
                        img: data.back?.img,
                        name: data.back?.name,
                        text: data.back?.text,
                    },
                };
            }

            return out;
        };

        return fn;
    }

    static _deckCards(cards, translations) {
        return cards.map(data => {
            if (translations) {
                const translation = translations[data.name];
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
                out[key] = {
                    name: data.name,
                    description: data.description,
                };
            }

            return out;
        };

        return fn;
    }

    static _playlistSounds(sounds, translations) {
        return sounds.map(data => {
            if (translations) {
                const translation = translations[data.name];
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
            const translation = translations[data._id] || translations[data.name];
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
            const translation = translations[data._id] || translations[data.name];
            if (!translation) return data;

            return foundry.utils.mergeObject(data, {
                name: translation.name ?? data.name,
                system: { text: translation.text ?? data.system.text },
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
                text: data.system?.text,
            };
        }

        return out;
    }
}
