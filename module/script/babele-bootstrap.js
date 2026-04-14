import {TranslationRegistry} from "./translation-registry.js";
import {BabeleState} from "./babele-state.js";
import {createMappedCompendium} from "./mapped-compendium-decorator.js";

/**
 * Internal bootstrapper responsible for rebuilding Babele derived state from
 * the current configuration and discovered translation sources.
 */
export class BabeleBootstrap {

    /**
     * @param {import("./babele.js").default} babele
     */
    constructor(babele) {
        this.babele = babele;
    }

    /**
     * Discover translation sources, load translations, and load global mapping
     * layers without mutating the current facade state.
     *
     * @returns {Promise<{registry: TranslationRegistry, translations: object[], loadedGlobalMappings: object[]}>}
     */
    async prepare() {
        const registry = new TranslationRegistry(this.babele.modules);
        const diagnostics = await registry.diagnostics();
        this.#logRegistryDiscovery(diagnostics.translation);
        this.#logRegistryDiscovery(diagnostics.mapping);

        const translations = await this.#loadTranslations(registry);
        const loadedGlobalMappings = await this.#loadGlobalMappings(registry);

        return {
            registry,
            translations,
            loadedGlobalMappings,
        };
    }

    /**
     * Build the runtime state object once mappings have been applied.
     *
     * @param {object} prepared
     * @param {TranslationRegistry} prepared.registry
     * @param {object[]} prepared.translations
     * @param {object[]} [prepared.loadedGlobalMappings]
     * @returns {Promise<BabeleState>}
     */
    async buildState(prepared) {
        const {registry, translations, loadedGlobalMappings = []} = prepared;
        const packs = new foundry.utils.Collection();
        const registerMappedCompendium = (metadata, translation = null) => {
            const collection = this.babele.getCollection(metadata);

            if (this.babele.supported(metadata)) {
                packs.set(collection, createMappedCompendium(metadata, translation));
            }
        };

        for (const metadata of game.data.packs) {
            const collection = this.babele.getCollection(metadata);
            const translation = translations.find((entry) => entry.collection === collection) ?? null;
            registerMappedCompendium(metadata, translation);
        }

        const folders = game.data.folders;
        if (folders) {
            const files = (await registry.translationSources())
                .filter((source) => source.baseName.endsWith(`${this.babele.constructor.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`));

            for (const file of files) {
                const metadata = this.babele.specialPackFoldersMetadataFor(file.baseName);
                const collection = this.babele.getCollection(metadata);
                const translation = translations.find((entry) => entry.collection === collection) ?? null;

                if (translation) {
                    registerMappedCompendium(metadata, translation);
                }
            }
        }

        return new BabeleState({
            translations,
            packs,
            folders,
            translationRegistry: registry,
            loadedGlobalMappings,
        });
    }

    async #loadTranslations(registry) {
        const translationSources = await registry.translationSources();
        const files = translationSources.map((source) => source.file);

        if (files.length === 0) {
            console.log(`Babele | no compendium translation files found for ${game.settings.get("core", "language")} language.`);
            return [];
        }

        const allTranslations = [];
        const loadTranslations = async (collection, urls) => {
            if (urls.length === 0) {
                console.log(`Babele | no translation file found for ${collection} pack`);
                return;
            }

            const translations = await Promise.all(
                urls.map((url) => this.babele.loadJsonFile(url, {
                    kind: "translation",
                    collection,
                })),
            );

            let translation;
            translations.forEach((entry) => {
                if (!entry) {
                    return;
                }

                if (translation) {
                    translation.label = entry.label ?? translation.label;
                    if (entry.entries) {
                        translation.entries = {...translation.entries, ...entry.entries};
                    }
                    if (entry.mapping) {
                        translation.mapping = {...translation.mapping, ...entry.mapping};
                    }
                    if (entry.folders) {
                        translation.folders = {...translation.folders, ...entry.folders};
                    }
                } else {
                    translation = entry;
                }
            });

            if (!translation) {
                return;
            }

            if (urls.length > 1) {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${urls.length} source file(s)`, urls);
            } else {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${urls[0]}`);
            }

            allTranslations.push(foundry.utils.mergeObject(translation, {collection}, {inplace: false}));
        };

        const packPromises = game.data.packs
            .filter((metadata) => this.babele.supported(metadata))
            .map(async (metadata) => {
                const collection = this.babele.getCollection(metadata);
                const urls = (await registry.sourcesFor(collection)).map((source) => source.file);
                return loadTranslations(collection, urls);
            });

        const folderPromises = translationSources
            .filter((source) => source.baseName.endsWith(`${this.babele.constructor.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`))
            .map((source) => loadTranslations(source.baseName.replace(".json", ""), [source.file]));

        await Promise.all([...packPromises, ...folderPromises]);
        return allTranslations;
    }

    async #loadGlobalMappings(registry) {
        const mappingFiles = (await registry.mappingSources()).map((source) => source.file);

        if (mappingFiles.length === 0) {
            return [];
        }

        console.log("Babele | global mapping files found, defaults will be enriched/overwritten...", mappingFiles);

        const mappings = await Promise.all(
            mappingFiles.map((file) => this.babele.loadJsonFile(file, {
                kind: "mapping",
                phase: "global defaults enrichment",
            })),
        );

        return mappings.filter(Boolean);
    }

    #logRegistryDiscovery(diagnostics) {
        console.log(
            `Babele | discovered ${diagnostics.uniqueFiles.length} unique ${diagnostics.kind} file(s) across ${diagnostics.directories.length} directorie(s)`,
            {
                directories: diagnostics.browseResults ?? [],
                duplicatesDiscarded: diagnostics.duplicateFilesDiscarded,
            },
        );
    }
}
