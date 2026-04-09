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

    /**
     *
     * @param mapping
     * @param entityType
     * @returns {function(*, *=): *}
     */
    static fromPack(mapping, entityType = 'Item') {
        return function (items, translations, data, tc) {
            const contextPack = game.babele.getRelatedAdventureTranslatedCompendium(tc, embeddedMappingKeys[entityType]);
            if (!contextPack) {
                const dynamicMapping = new CompendiumMapping(entityType, mapping);
                return Converters._fromPack(items, translations, dynamicMapping);
            }

            const dynamicMapping = new CompendiumMapping(entityType, mapping, contextPack);
            return Converters._fromPack(items, translations, dynamicMapping, contextPack);
        }
    }

    static fromDefaultMapping(entityType, mappingKey) {
        return function (entities, translations, data, tc) {
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
        return function (collection, translations) {
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
        return function (results, translations) {
            return Converters._tableResults(results, translations);
        };
    }

    static tableResultsCollection() {
        return function (collection, translations) {
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
        return function (pages, translations) {
            return Converters._pages(pages, translations);
        };
    }

    static deckCards() {
        return function (cards, translations) {
            return Converters._deckCards(cards, translations);
        }
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
        return function (sounds, translations) {
            return Converters._playlistSounds(sounds, translations);
        }
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
        return function (regions, translations) {
            return Converters._sceneRegions(regions, translations);
        }
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
}
