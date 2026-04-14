import {registerModuleSettings} from "./settings.js";
import {initWrapper} from "./wrapper.js";
import {HtmlUtils} from "./html-utils.js";
import {Converters} from "./converters.js";
import {createMappedCompendium} from "./mapped-compendium-decorator.js";
import {ExportTranslationsDialog} from "./export-translations-dialog.js";
import {OnDemandTranslateDialog} from "./on-demand-translate-dialog.js";
import {defaultMappings} from "./default-mappings.js"
import {TranslationRegistry} from "./translation-registry.js";

/****************
 * HOOKS
 ***************/

Hooks.once('init', () => {
    let babele = new Babel();
    Babel.instance = babele;
    game["babele"] = babele;
    registerModuleSettings();
    initWrapper();
    Hooks.callAll('babele.init', babele);
});

Hooks.once('ready', async () => {

    const initialized = await game.babele.init();

    if (!initialized) {
        return;
    }

    await game.babele.shareTranslationFiles();
    await game.babele.shareGlobalMappingFiles();

    game.packs.forEach(pack => {
        game.babele.translateIndex(pack.index, pack.collection);
        game.babele.translatePackFolders(pack);
        pack.initializeTree();
    });

    game.babele.translateSystemPackFolders();

    Hooks.callAll('babele.ready');
    await ui.compendium.render();
});

function addTranslateButton(app, html, data){
    const exportEnabled = game.settings.get('babele', 'showTranslateOption');
    if(exportEnabled && game.user.isGM && data.editable) {
        let title = game.i18n.localize("BABELE.TranslateActorHeadBtn");
        HtmlUtils.appendHeaderButton(html, title, ev => {
            game.babele.translateActor(app.actor);
        });
    }
}

Hooks.on('renderActorSheet', (app, html, data) => addTranslateButton(app, html[0], data));

Hooks.on('getHeaderControlsActorSheetV2', (sheet, controls) => {
    const exportEnabled = game.settings.get('babele', 'showTranslateOption');
    if(exportEnabled && game.user.isGM && sheet.isEditable) {
        let label = game.i18n.localize("BABELE.TranslateActorHeadBtn");
        controls.push({
            icon: 'fas fa-globe',
            label: label,
            onClick: () => game.babele.translateActor(sheet.actor),
        });
    }
});

Hooks.on('renderCompendium', (app, html, data) => {
    const exportEnabled = game.settings.get('babele', 'export');
    if(game.user.isGM && exportEnabled) {
        let title = game.i18n.localize("BABELE.CompendiumTranslations");
        HtmlUtils.appendHeaderButton(html, title, ev => {
            game.babele.exportTranslationsFile(app.collection)
        });
    }

    if (game.settings.get('babele', 'showOriginalName')) {
        html.querySelectorAll('.directory-list .entry-name, .directory-list .document-name').forEach((item) => {
            const entry = item.textContent?.length ? data.collection.index.find(i => i.name === item.textContent) : null;

            if (entry && entry.translated && entry.hasTranslation) {
                item.setAttribute('style', 'line-height: normal; padding-top: 10px;');
                item.innerHTML += `<div style="line-height: normal; font-size: 12px; color: gray;">${entry.originalName}</div>`;
            }
        });
    }
});

Hooks.on('importAdventure', () => {
    game.scenes.forEach(scene => {
        scene.tokens.forEach(token => {
            const actor = game.actors.get(token.actorId);
            if (actor && !token.delta.name) {
                token.update({ name: actor.prototypeToken.name });
            }
        });
    });
});

/**
 * Main facade class with init logic and on API for on demand translations based on loaded mapping files.
 */
class Babel {
    /** @type {Promise<boolean> | null} */
    #initialized
    #dataLoaded
    #translationRegistry

    static get PACK_FOLDER_TRANSLATION_NAME_SUFFIX() {
        return '_packs-folders';
    }

    static get SUPPORTED_PACKS() {
        return ['Adventure', 'Actor', 'Cards', 'Folder', 'Item', 'JournalEntry', 'Macro', 'Playlist', 'RollTable', 'Scene'];
    }

    static DEFAULT_MAPPINGS = defaultMappings;

    /**
     * Singleton implementation.
     *
     * @deprecated
     * @returns {Babel}
     */
    static get() {
        foundry.utils.logCompatibilityWarning('Babele.get is deprecated, use game.babele instead', {since: "2.5.5", until: 4});
        if (!Babel.instance) {
            Babel.instance = new Babel();
        }
        return Babel.instance;
    }

    constructor() {
        this.modules = [];
        this.converters = {};
        this.translations = null;
        this.systemTranslationsDir = null;
        this.#initialized = null;
        this.#dataLoaded = false;
        this.#translationRegistry = null;
        this.registerDefaultConverters();
    }

    /**
     * Register the default provided converters.
     */
    registerDefaultConverters() {
        this.registerConverters({
            "fromPack": Converters.fromPack(),
            "name": Converters.mappedField("name"),
            "nameCollection": Converters.fieldCollection("name"),
            "textCollection": Converters.fieldCollection("text"),
            "tableResults": Converters.tableResults(),
            "tableResultsCollection": Converters.tableResultsCollection(),
            "pages": Converters.pages(),
            "playlistSounds": Converters.playlistSounds(),
            "deckCards": Converters.deckCards(),
            "sceneRegions": Converters.sceneRegions(),
            "adventureItems": Converters.fromDefaultMapping("Item", "items"),
            "adventureActors": Converters.fromDefaultMapping("Actor", "actors"),
            "adventureCards": Converters.fromDefaultMapping("Cards", "cards"),
            "adventureJournals": Converters.fromDefaultMapping("JournalEntry", "journals"),
            "adventurePlaylists": Converters.fromDefaultMapping("Playlist", "playlists"),
            "adventureMacros": Converters.fromDefaultMapping("Macro", "macros"),
            "adventureScenes": Converters.fromDefaultMapping("Scene", "scenes")
        })
    }

    /**
     *
     * @param module
     */
    register(module) {
        this.modules.push(module);
    }

    /**
     *
     * @param name
     * @param converter
     */
    registerConverter(name, converter) {
        this.registerConverters({[name]: converter});
    }

    /**
     *
     * @param converters
     */
    registerConverters(converters) {
        this.converters = foundry.utils.mergeObject(this.converters, converters);
    }

    /**
     *
     * @param converters
     */
    registerMapping(mapping) {
        for (const [key, value] of Object.entries(mapping)) {
            if (Babel.DEFAULT_MAPPINGS[key]) {
                Babel.DEFAULT_MAPPINGS[key] = foundry.utils.mergeObject(Babel.DEFAULT_MAPPINGS[key], value);
            } else {
                Babel.DEFAULT_MAPPINGS[key] = value;
            }
        }
    }

    /**
     *
     * @param pack
     * @returns {boolean}
     */
    supported(pack) {
        return Babel.SUPPORTED_PACKS.includes(pack.type);
    }

    /**
     *
     * @param dir
     */
    setSystemTranslationsDir(dir) {
        this.systemTranslationsDir = dir;
    }

    /**
     * Initialize babele downloading the available translations files and instantiating the associated
     * translated compendium class.
     *
     * @returns {Promise<boolean>}
     */
    async init() {
        if(this.#initialized !== null)
            return await this.#initialized;

        this.#initialized = this.#initialize().catch((error) => {
            this.#initialized = null;
            return false;
        });

        const result = await this.#initialized;
        if (result && !this.#dataLoaded) {
            this.#dataLoaded = true;
            Hooks.callAll('babele.dataLoaded');
        }
        return result;
    }

    async #initialize() {
        let step = "load translations";

        try {
            if (!this.translations) {
                this.translations = await this.loadTranslations();
            }

            step = "build mapped compendium registry";
            this.packs = new foundry.utils.Collection();

            const registerMappedCompendium = (metadata, translation = null) => {
                const collection = this.getCollection(metadata);

                if (this.supported(metadata)) {
                    this.packs.set(collection, createMappedCompendium(metadata, translation));
                }
            };

            for (const metadata of game.data.packs) {
                const collection = this.getCollection(metadata);
                const translation = this.translations.find(t => t.collection === collection) ?? null;
                registerMappedCompendium(metadata, translation);
            }

            // Handle specific files for pack folders
            step = "load pack folder translations";
            this.folders = game.data.folders;

            if (this.folders) {
                const files = (await this.#registry().translationSources())
                    .filter((source) => source.baseName.endsWith(`${Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`));

                // Handle specific files for pack folders
                for (const file of files) {
                    const metadata = this.#getSpecialPacksFoldersMetadata(file.baseName);
                    const collection = this.getCollection(metadata);
                    const translation = this.translations.find(t => t.collection === collection) ?? null;

                    if (translation) {
                        registerMappedCompendium(metadata, translation);
                    }
                }
            }
        } catch (error) {
            console.error(`Babele | initialization failed during step: ${step}`, error);
            throw error;
        }

        return true;
    }

    getCollection(metadata) {
        const collectionPrefix = metadata.packageType === "world" ? "world" : metadata.packageName;
        return `${collectionPrefix}.${metadata.name}`;
    }

    translatedPackFor(documentType, data, options = {}) {
        const registry = options.registry ?? this.packs;
        return registry?.find?.((pack) => pack.translated && pack.hasTranslation(data, documentType)) ?? null;
    }

    /**
     * Find and download the translation files for each compendium present on the world.
     * Verify the effective presence of each file using the FilePicker API.
     *
     * @returns {Promise<[]>}
     */
    async loadTranslations() {
        const registry = this.#registry();
        const diagnostics = await registry.diagnostics();
        this.#logRegistryDiscovery(diagnostics.translation);
        this.#logRegistryDiscovery(diagnostics.mapping);

        const translationSources = await registry.translationSources();
        const files = translationSources.map((source) => source.file);

        if (files.length === 0) {
            console.log(`Babele | no compendium translation files found for ${game.settings.get('core', 'language')} language.`);

            return [];
        }

        const allTranslations = [];
        const loadTranslations = async (collection, urls) => {
            if (urls.length === 0) {
                console.log(`Babele | no translation file found for ${collection} pack`);
            } else {
                const translations = await Promise.all(
                    urls.map((url) => this.#loadJsonFile(url, {
                        kind: "translation",
                        collection,
                    })),
                );

                let translation;
                translations.forEach(t => {
                    if (t) {
                        if (translation) {
                            translation.label = t.label ?? translation.label;
                            if (t.entries) {
                                translation.entries = {...translation.entries, ...t.entries};
                            }
                            if (t.mapping) {
                                translation.mapping = {...translation.mapping, ...t.mapping};
                            }
                        } else {
                            translation = t;
                        }
                    }
                });

                if (translation) {
                    if (urls.length > 1) {
                        console.log(`Babele | translation for ${collection} pack successfully loaded from ${urls.length} source file(s)`, urls);
                    } else {
                        console.log(`Babele | translation for ${collection} pack successfully loaded from ${urls[0]}`);
                    }
                    allTranslations.push(foundry.utils.mergeObject(translation, {collection: collection}));
                }
            }
        };

        const packPromises = game.data.packs
            .filter(metadata => this.supported(metadata))
            .map(async (metadata) => {
                const collection = this.getCollection(metadata);
                const urls = (await registry.sourcesFor(collection)).map((source) => source.file);
                return loadTranslations(collection, urls);
            });

        // Handle specific files for pack folders
        const folderPromises = translationSources
            .filter((source) => source.baseName.endsWith(`${Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`))
            .map((source) => {
                const fileName = source.baseName;
                const file = source.file;
                return loadTranslations(fileName.replace('.json', ''), [file]);
            });

        await Promise.all([...packPromises, ...folderPromises]);

        // Handle global mappings
        const mappingFiles = (await registry.mappingSources()).map((source) => source.file);

        if (mappingFiles.length > 0) {
            console.log(`Babele | global mapping files found, defaults will be enriched/overwritten...`, mappingFiles);

            const loadMappings = async () => {
                const mappings = await Promise.all(
                    mappingFiles.map((file) => this.#loadJsonFile(file, {
                        kind: "mapping",
                        phase: "global defaults enrichment",
                    })),
                );
                mappings.forEach(mapping => {
                    if (mapping) {
                        this.registerMapping(mapping);
                    }
                })
            }
            await loadMappings();
        }

        return allTranslations;
    }

    #translationEntries(entries) {
        if (Array.isArray(entries)) {
            return entries
                .filter((entry) => entry?.id)
                .map((entry) => [entry.id, entry]);
        }

        return Object.entries(entries || {});
    }

    /**
     * Translates inplace and returns the compendium index.
     *
     * @param index the untranslated index
     * @param pack the pack name
     * @returns {*} the translated index
     */
    translateIndex(index, pack) {
        return this.translatedCompendiumFor(pack)?.translateIndex(index) ?? index;
    }

    /**
     * Check if the compendium pack is translated (exists an associated translation file).
     *
     * @param pack compendium name (ex. dnd5e.classes)
     * @returns {boolean|*} true if the compendium is translated.
     */
    isTranslated(pack) {
        return !!this.translatedCompendiumFor(pack);
    }

    /**
     * Translate the
     *
     * @param pack
     * @param data
     * @param translationsOnly
     * @returns {*}
     */
    translate(pack, data, translationsOnly) {
        return this.translatedCompendiumFor(pack)?.translate(data, translationsOnly) ?? data;
    }

    /**
     *
     * @param field
     * @param pack
     * @param data
     * @returns {*}
     */
    translateField(field, pack, data) {
        return this.mappedCompendiumFor(pack)?.translateField(field, data) ?? null;
    }

    /**
     *
     * @param pack
     * @param data
     * @returns {*}
     */
    extract(pack, data, options = {}) {
        return this.mappedCompendiumFor(pack)?.extract(data, options);
    }

    /**
     *
     * @param pack
     * @param field
     * @param data
     * @returns {*}
     */
    extractField(pack, field, data) {
        return this.mappedCompendiumFor(pack)?.extractField(field, data);
    }

    translatedCompendiumFor(pack) {
        const compendium = this.mappedCompendiumFor(pack);
        return compendium?.translated ? compendium : null;
    }

    mappedCompendiumFor(pack) {
        return this.packs?.get(pack) ?? null;
    }

    pruneExportData(value) {
        if (typeof value === "undefined" || value === null || value === "") {
            return undefined;
        }

        if (Array.isArray(value)) {
            const pruned = value
                .map(item => this.pruneExportData(item))
                .filter(item => typeof item !== "undefined");

            return pruned.length ? pruned : undefined;
        }

        if (typeof value === "object") {
            const pruned = Object.entries(value).reduce((out, [key, entryValue]) => {
                const nextValue = this.pruneExportData(entryValue);
                if (typeof nextValue !== "undefined") {
                    out[key] = nextValue;
                }
                return out;
            }, {});

            return Object.keys(pruned).length ? pruned : undefined;
        }

        return value;
    }

    folderTranslationsForExport(pack) {
        if (!pack?.folders?.size) {
            return undefined;
        }

        const folders = {};
        pack.folders.forEach((folder) => {
            const name = folder?.originalName ?? folder?.name;
            if (name) {
                folders[name] = name;
            }
        });

        return Object.keys(folders).length ? folders : undefined;
    }

    /**
     *
     * @param pack
     */
    exportTranslationsFile(pack) {

        ExportTranslationsDialog.create(pack).then(async conf => {

            if (conf) {
                const folders = this.folderTranslationsForExport(pack);
                let file = {
                    label: pack.metadata.label,
                    ...(folders ? {folders} : {}),
                    entries: conf.format === 'legacy' ? [] : {}
                };
                const skippedDynamicFields = [];

                let index = await pack.getIndex();
                Promise.all(index.map(entry => pack.getDocument(entry._id))).then(entities => {
                    entities.forEach((entity, idx) => {
                        const name = entity.getFlag("babele", "translated") ? entity.getFlag("babele", "originalName") : entity.name;
                        const extracted = this.pruneExportData(this.extract(pack.collection, entity, {
                            format: conf.format,
                            onSkippedDynamicField: info => skippedDynamicFields.push({
                                entry: name,
                                ...info,
                            }),
                        })) ?? {};
                        if (conf.format === 'legacy') {
                            let entry = foundry.utils.mergeObject({id: name}, extracted);
                            file.entries.push(entry);
                        } else {
                            file.entries[`${name}`] = extracted;
                        }
                    });

                    if (skippedDynamicFields.length) {
                        console.warn("Babele | skipped dynamic export fields", {
                            pack: pack.collection,
                            fields: skippedDynamicFields,
                        });
                    }

                    let dataStr = JSON.stringify(file, null, '\t');
                    let exportFileDefaultName = pack.collection + '.json';

                    var zip = new JSZip();
                    zip.file(exportFileDefaultName, dataStr);
                    zip.generateAsync({type: "blob"})
                        .then(content => {
                            saveAs(content, pack.collection + ".zip");
                        });
                });
            }
        });
    }

    /**
     *
     * @param actor
     */
    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
    }

    translatePackFolders(pack) {
        if (!pack?.folders?.size) {
            return;
        }

        const tcFolders = this.packs.get(pack.metadata.id)?.folders ?? [];

        pack.folders.forEach((folder) => {
            const originalName = folder.originalName ?? folder.name;
            const translatedName = tcFolders[originalName];

            if (translatedName) {
                folder.originalName = originalName;
                folder.name = translatedName;
            }
        });
    }

    translateSystemPackFolders() {
        if (!game.data.folders?.length) {
            return;
        }

        const translations = {};

        this.packs
            .filter((pack) => pack.metadata.name === Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX)
            .forEach((pack) => Object.assign(translations, pack.translations ?? {}, pack.folders ?? {}));

        game.collections.get('Folder').forEach((folder) => folder.name = translations[folder.name] ?? folder.name);
    }

    async shareTranslationFiles() {
        if (game.user.isGM) {
            let files = (await game.babele.#registry().translationSources()).map((source) => source.file);
            game.settings.set('babele', 'translationFiles', files);
        }
    }

    async shareGlobalMappingFiles() {
        if (game.user.isGM) {
            let files = (await game.babele.#registry().mappingSources()).map((source) => source.file);
            game.settings.set('babele', 'mappingFiles', files);
        }
    }

    #getSpecialPacksFoldersMetadata(file) {
        const [packageName, name] = file.split('.');

        return {
            packageType: 'system',
            type: 'Folder',
            packageName,
            name,
        };
    }


    async #loadJsonFile(file, context = {}) {
        try {
            const response = await fetch(file);

            if (response?.ok === false) {
                const status = response.status ?? "unknown";
                const statusText = response.statusText ? ` ${response.statusText}` : "";
                throw new Error(`HTTP ${status}${statusText}`);
            }

            return await response.json();
        } catch (error) {
            this.#logJsonLoadFailure(file, context, error);
            return null;
        }
    }

    #logJsonLoadFailure(file, context, error) {
        const details = {
            file,
            error: error?.message ?? String(error),
        };

        if (context.kind) {
            details.kind = context.kind;
        }

        if (context.collection) {
            details.collection = context.collection;
        }

        if (context.phase) {
            details.phase = context.phase;
        }

        console.error(`Babele | failed to load ${context.kind ?? "JSON"} file '${file}'`, details);
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

    #registry() {
        if (!this.#translationRegistry) {
            this.#translationRegistry = new TranslationRegistry(this.modules);
        }

        return this.#translationRegistry;
    }

    /**
     * @type {boolean}
     */
    static get #canIndexFiles(){
        // Needs to check both the permissions and the GM status 
        // as the file discovery will fail if a folder is hidden
        // This is checked by the server itself and can't be changed
        return game.user.hasPermission('FILES_BROWSE') && game.user.isGM;
    }
}

export default Babel

window.Babele = Babel;
