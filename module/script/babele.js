import {registerModuleSettings} from "./settings.js";
import {initWrapper} from "./wrapper.js";
import {HtmlUtils} from "./html-utils.js";
import {Converters} from "./converters.js";
import {ExportTranslationsDialog} from "./export-translations-dialog.js";
import {OnDemandTranslateDialog} from "./on-demand-translate-dialog.js";
import {defaultMappings} from "./default-mappings.js"
import {TranslationRegistry} from "./translation-registry.js";
import {BabeleMappings} from "./babele-mappings.js";
import {BabeleBootstrap} from "./babele-bootstrap.js";
import {BabeleRuntimeApplier} from "./babele-runtime-applier.js";
import {BabeleState} from "./babele-state.js";

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

    await game.babele.applyRuntimeTranslations({shareSources: true, renderCompendium: false});
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
        this.state = BabeleState.empty();
        this.translations = this.state.translations;
        this.packs = this.state.packs;
        this.folders = this.state.folders;
        this.systemTranslationsDir = null;
        this.#initialized = null;
        this.#dataLoaded = false;
        this.#translationRegistry = null;
        this.mappings = new BabeleMappings(defaultMappings);
        Babel.DEFAULT_MAPPINGS = this.mappings.current();
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
        this.#applyEffectiveMappings(this.mappings.register(mapping));
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

        this.#initialized = this.#rebuildState({applyRuntime: false}).catch((error) => {
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

    async reinitialize({shareSources = false, notify = false} = {}) {
        const previousInitialization = this.#initialized;

        try {
            const pending = this.#rebuildState({applyRuntime: true, shareSources, notify});
            this.#initialized = pending;
            const result = await pending;
            this.#initialized = Promise.resolve(result);
            Hooks.callAll("babele.reinitialized", this);
            return result;
        } catch (error) {
            this.#initialized = previousInitialization;
            console.error("Babele | reinitialization failed", error);
            return false;
        }
    }

    async refreshTranslationSources() {
        const refreshed = await this.reinitialize({
            shareSources: true,
            notify: false,
        });

        if (!refreshed) {
            return false;
        }

        if (game.user.isGM) {
            await game.settings.set("babele", "sourcesRevision", Date.now());
        }

        ui.notifications?.info?.(
            "Babele refreshed translation sources. Closed compendium documents are updated; already open documents may need to be reopened.",
        );
        return true;
    }

    async applyRuntimeTranslations(options = {}) {
        await this.#runtimeApplier().apply(options);
    }

    async #rebuildState({applyRuntime = false, shareSources = false, notify = false} = {}) {
        let step = "load translations";

        try {
            const prepared = await this.#bootstrap().prepare();
            step = "apply mappings";
            this.#applyEffectiveMappings(this.mappings.replaceLoaded(prepared.loadedGlobalMappings));
            step = "build mapped compendium registry";
            const state = await this.#bootstrap().buildState(prepared);
            this.#applyState(state);

            if (applyRuntime) {
                step = "apply runtime translations";
                await this.applyRuntimeTranslations({shareSources, notify});
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
        const prepared = await this.#bootstrap().prepare();
        this.#translationRegistry = prepared.registry;
        this.#applyEffectiveMappings(this.mappings.replaceLoaded(prepared.loadedGlobalMappings));
        return prepared.translations;
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

        game.collections.get('Folder').forEach((folder) => {
            const originalName = folder.originalName ?? folder.name;
            const translatedName = translations[originalName];
            if (translatedName) {
                folder.originalName = originalName;
                folder.name = translatedName;
            }
        });
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

    specialPackFoldersMetadataFor(file) {
        const [packageName, name] = file.split('.');

        return {
            packageType: 'system',
            type: 'Folder',
            packageName,
            name,
        };
    }


    async loadJsonFile(file, context = {}) {
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

    #registry() {
        if (!this.#translationRegistry) {
            this.#translationRegistry = new TranslationRegistry(this.modules);
        }

        return this.#translationRegistry;
    }

    #bootstrap() {
        return new BabeleBootstrap(this);
    }

    #runtimeApplier() {
        return new BabeleRuntimeApplier(this);
    }

    #applyState(state) {
        this.state = state;
        this.translations = state.translations;
        this.packs = state.packs;
        this.folders = state.folders;
        this.#translationRegistry = state.translationRegistry;
    }

    #applyEffectiveMappings(mappings) {
        Babel.DEFAULT_MAPPINGS = mappings;
    }

}

export default Babel

window.Babele = Babel;
