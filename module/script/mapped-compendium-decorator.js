import {MappedCompendium} from "./mapped-compendium.js";
import {CompendiumRuntime} from "./compendium-runtime.js";
import {ADVENTURE_EMBEDDED_MAPPINGS} from "./adventure-embedded-mappings.js";

/**
 * Base decorator that preserves the mapped compendium contract while allowing
 * specialized wrappers to override selected behaviors.
 */
class MappedCompendiumDecorator {

    /**
     * @param {*} compendium
     */
    constructor(compendium) {
        this.compendium = compendium;
    }

    get metadata() {
        return this.compendium.metadata;
    }

    get translations() {
        return this.compendium.translations;
    }

    get translated() {
        return this.compendium.translated;
    }

    get customMapping() {
        return this.compendium.customMapping;
    }

    get mapping() {
        return this.compendium.mapping;
    }

    get reference() {
        return this.compendium.reference;
    }

    get folders() {
        return this.compendium.folders;
    }

    get types() {
        return this.compendium.types;
    }

    hasTranslation(data, documentType = this.metadata?.type ?? null) {
        return this.compendium.hasTranslation(data, documentType);
    }

    translateIndex(index) {
        for (const entry of index) {
            const translationsOnly = !!entry?.translated;
            foundry.utils.mergeObject(entry, this.translate(entry, translationsOnly), {inplace: true});
        }

        return index;
    }

    translationsFor(data) {
        return this.compendium.translationsFor(data);
    }

    translationKeyFor(data) {
        return this.compendium.translationKeyFor(data);
    }

    hasReferenceTranslations(data) {
        return this.compendium.hasReferenceTranslations(data);
    }

    extract(data, runtime = {}) {
        return this.compendium.extract(data, runtime);
    }

    extractField(field, data, runtime = {}) {
        return this.compendium.extractField(field, data, runtime);
    }

    translateField(field, data, runtime = {}) {
        return this.compendium.translateField(field, data, runtime);
    }

    translate(data, translationsOnly = false, runtime = {}) {
        return this.compendium.translate(data, translationsOnly, runtime);
    }
}

/**
 * Decorator for top-level Adventure compendiums.
 *
 * It enriches the active runtime with entry-local virtual compendiums so
 * nested converter lookups can resolve against the current Adventure scope.
 */
export class AdventureMappedCompendium extends MappedCompendiumDecorator {
    #entryLocalPacks = new Map();
    #entryScopedRuntimes = new WeakMap();

    /**
     * @param {*} compendium
     */
    constructor(compendium) {
        super(compendium);

        if (this.metadata?.type !== "Adventure") {
            throw new Error("AdventureMappedCompendium can only decorate Adventure compendiums");
        }
    }

    extract(data, runtime = {}) {
        return this.compendium.extract(data, this.#scopedRuntimeFor(data, runtime));
    }

    extractField(field, data, runtime = {}) {
        return this.compendium.extractField(field, data, this.#scopedRuntimeFor(data, runtime));
    }

    translateField(field, data, runtime = {}) {
        return this.compendium.translateField(field, data, this.#scopedRuntimeFor(data, runtime));
    }

    translate(data, translationsOnly = false, runtime = {}) {
        return this.compendium.translate(data, translationsOnly, this.#scopedRuntimeFor(data, runtime));
    }

    #scopedRuntimeFor(data, runtime = {}) {
        const activeRuntime = this.#normalizeRuntime(runtime);
        const entryKey = this.translationKeyFor(data);

        if (!entryKey) {
            return activeRuntime.currentCompendium() === this
                ? activeRuntime
                : activeRuntime.child({currentCompendium: this});
        }

        let scopedRuntimes = this.#entryScopedRuntimes.get(activeRuntime);
        if (!scopedRuntimes) {
            scopedRuntimes = new Map();
            this.#entryScopedRuntimes.set(activeRuntime, scopedRuntimes);
        }

        if (!scopedRuntimes.has(entryKey)) {
            const localPacks = this.#localPacksFor(data, entryKey);
            scopedRuntimes.set(
                entryKey,
                localPacks.size > 0
                    ? activeRuntime.child({localPacks, currentCompendium: this})
                    : activeRuntime.child({currentCompendium: this}),
            );
        }

        return scopedRuntimes.get(entryKey);
    }

    #localPacksFor(data, entryKey = this.translationKeyFor(data)) {
        if (!this.#entryLocalPacks.has(entryKey)) {
            this.#entryLocalPacks.set(entryKey, this.#buildLocalPacksFor(data, entryKey));
        }

        return this.#entryLocalPacks.get(entryKey);
    }

    #buildLocalPacksFor(data, entryKey) {
        const localPacks = new foundry.utils.Collection();

        for (const [documentType, mappingKey] of Object.entries(ADVENTURE_EMBEDDED_MAPPINGS)) {
            const embeddedPack = this.#embeddedMappedCompendium(data, documentType, mappingKey, entryKey);
            if (embeddedPack) {
                localPacks.set(embeddedPack.metadata.id, embeddedPack);
            }
        }

        return localPacks;
    }

    #embeddedMappedCompendium(data, documentType, mappingKey, entryKey = this.translationKeyFor(data)) {
        const collection = this.#collectionFor(this.metadata);
        const virtualCollection = this.#virtualCollectionFor(collection, entryKey, mappingKey);

        if (!virtualCollection) {
            return null;
        }

        return createMappedCompendium({
            id: virtualCollection,
            type: documentType,
            virtual: true,
            packageName: this.metadata?.packageName,
            packageType: this.metadata?.packageType,
            name: virtualCollection,
            adventureCollection: collection,
            adventureEntryKey: entryKey,
        }, {
            mapping: this.customMapping?.[mappingKey] ?? {},
            entries: this.translationsFor(data)?.[mappingKey] ?? {},
        });
    }

    #collectionFor(metadata) {
        return game.babele?.getCollection?.(metadata)
            ?? metadata?.id
            ?? metadata?.name
            ?? null;
    }

    #virtualCollectionFor(parentCollection, entryKey, mappingKey) {
        if (!parentCollection || !entryKey || !mappingKey) {
            return null;
        }

        return `${parentCollection}::${entryKey}::${mappingKey}`;
    }

    #normalizeRuntime(runtime = {}) {
        return CompendiumRuntime.from(runtime);
    }
}

/**
 * Factory used by Babele to create the concrete mapped compendium object that
 * should be registered for the provided metadata.
 *
 * @param {object} metadata
 * @param {object|null} translations
 * @returns {*}
 */
export function createMappedCompendium(metadata, translations) {
    const compendium = new MappedCompendium(metadata, translations);

    if (metadata?.type === "Adventure") {
        return new AdventureMappedCompendium(compendium);
    }

    return compendium;
}
