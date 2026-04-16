import {registerModuleSettings} from "./settings.js";
import {initWrapper} from "./wrapper.js";
import {Converters} from "./converters.js";
import {ExportTranslationsDialog} from "./export-translations-dialog.js";
import {OnDemandTranslateDialog} from "./on-demand-translate-dialog.js";
import {defaultMappings} from "./default-mappings.js"
import {TranslationRegistry} from "./translation-registry.js";
import {BabeleMappings} from "./babele-mappings.js";
import {BabeleBootstrap} from "./babele-bootstrap.js";
import {BabeleRuntimeApplier} from "./babele-runtime-applier.js";
import {BabeleState} from "./babele-state.js";
import {BabeleUiBridge} from "./babele-ui-bridge.js";
import {TranslationResolver} from "./translation-resolver.js";

/****************
 * HOOKS
 ***************/

const uiBridge = new BabeleUiBridge();

Hooks.once('init', () => {
    let babele = new Babel();
    Babel.instance = babele;
    game["babele"] = babele;
    registerModuleSettings();
    initWrapper();
    uiBridge.registerHooks();
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

Hooks.on("createFolder", (folder) => {
    game.babele?.translateImportedCompendiumFolder?.(folder);
});

/**
 * Main facade class with init logic and on API for on demand translations based on loaded mapping files.
 */
class Babel {
    /** @type {Promise<boolean> | null} */
    #initialized
    #dataLoaded
    #translationRegistry
    #translationMatchStrategies

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
        this.defaultConverters = {};
        this.state = BabeleState.empty();
        this.translations = this.state.translations;
        this.packs = this.state.packs;
        this.folders = this.state.folders;
        this.systemTranslationsDir = null;
        this.#initialized = null;
        this.#dataLoaded = false;
        this.#translationRegistry = null;
        this.#translationMatchStrategies = [];
        this.mappings = new BabeleMappings(defaultMappings);
        Babel.DEFAULT_MAPPINGS = this.mappings.current();
        this.registerDefaultConverters();
    }

    /**
     * Register the default provided converters.
     */
    registerDefaultConverters() {
        const converters = {
            "fromPack": Converters.fromPack(),
            "name": Converters.mappedField("name"),
            "nameCollection": Converters.fieldCollection("name"),
            "textCollection": Converters.fieldCollection("text"),
            "document": Converters.document(),
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
        };

        this.defaultConverters = this.#normalizeConverters(converters);
        this.registerConverters(converters);
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
        this.converters = foundry.utils.mergeObject(this.converters, this.#normalizeConverters(converters));
    }

    #normalizeConverters(converters = {}) {
        return Object.fromEntries(
            Object.entries(converters).map(([name, converter]) => [name, this.#normalizeConverter(name, converter)]),
        );
    }

    #normalizeConverter(name, converter) {
        if (typeof converter === "function") {
            return this.#legacyConverter(converter);
        }

        if (converter && typeof converter.translate === "function") {
            return converter;
        }

        throw new Error(`Invalid converter registration for '${name}'. Expected a legacy function or an OO converter.`);
    }

    #legacyConverter(fn) {
        return {
            translate(context) {
                return fn(
                    context.value,
                    context.translation,
                    context.source,
                    context.contextCompendium,
                    context.allTranslations,
                    context.runtime,
                    context.params,
                );
            },

            extract(context) {
                if (typeof fn.extract !== "function") {
                    return undefined;
                }

                return fn.extract(
                    context.value,
                    context.source,
                    context.contextCompendium,
                    {
                        field: context.field,
                        path: context.path,
                        params: context.params,
                        mapping: context.params,
                        runtime: context.runtime,
                    },
                );
            },

            isDynamic() {
                return true;
            },
        };
    }

    /**
     * Register an additional translation match strategy. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * @param {import("./translation-resolver.js").TranslationStrategy} strategy
     */
    registerTranslationMatchStrategy(strategy) {
        this.registerTranslationMatchStrategies([strategy]);
    }

    /**
     * Register additional translation match strategies. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * @param {import("./translation-resolver.js").TranslationStrategy[]} strategies
     */
    registerTranslationMatchStrategies(strategies) {
        this.#translationMatchStrategies.push(...(strategies ?? []).filter(Boolean));
        this.#applyTranslationMatchStrategies();
    }

    /**
     * Return the effective translation match strategies in precedence order.
     *
     * @returns {import("./translation-resolver.js").TranslationStrategy[]}
     */
    translationMatchStrategies() {
        return [
            ...this.#translationMatchStrategies,
            ...TranslationResolver.defaultStrategies(),
        ];
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
    async exportTranslationsFile(pack) {
        const mappedCompendium = this.mappedCompendiumFor(pack.collection);
        const exportCounts = await this.#exportSelectionCountsFor(pack, mappedCompendium);
        const conf = await ExportTranslationsDialog.create(pack, {
            hasTranslations: !!mappedCompendium?.translated,
            format: "compatible",
            selection: "all",
            counts: exportCounts,
        });

        if (!conf) {
            return;
        }

        const exportEntries = await this.#exportEntriesFor(pack, mappedCompendium);
        const file = await this.exportDataFor(pack, {
            ...conf,
            mappedCompendium,
            entries: exportEntries,
        });
        const dataStr = JSON.stringify(file, null, '\t');
        const exportFileDefaultName = `${pack.collection}.json`;

        const zip = new JSZip();
        zip.file(exportFileDefaultName, dataStr);
        const progress = this.#createExportZipProgress(pack);
        this.#updateExportZipProgress(progress, pack, 0.01);
        await this.#yieldToUi();
        const content = await zip.generateAsync({type: "blob"}, (metadata) => {
            this.#updateExportZipProgress(progress, pack, (metadata?.percent ?? 0) / 100);
        });
        this.#updateExportZipProgress(progress, pack, 1);
        saveAs(content, `${pack.collection}.zip`);
    }

    async exportDataFor(pack, options = {}) {
        const format = options.format === "legacy" ? "legacy" : "compatible";
        const selection = this.#normalizedExportSelection(options.selection);
        const mappedCompendium = options.mappedCompendium ?? this.mappedCompendiumFor(pack.collection);
        const exportEntries = options.entries ?? await this.#exportEntriesFor(pack, mappedCompendium);
        const folders = this.folderTranslationsForExport(pack);
        const file = {
            label: pack.metadata.label,
            ...(folders ? {folders} : {}),
            entries: format === "legacy" ? [] : {},
        };
        const skippedDynamicFields = [];

        for (const {entity, sourceData, hasTranslation} of exportEntries) {
            const exportedData = this.#exportPayloadData(sourceData, hasTranslation, mappedCompendium);
            const name = this.#exportEntryName(entity, exportedData, sourceData);

            if (!this.#shouldExportEntity(selection, hasTranslation)) {
                continue;
            }

            const extracted = this.pruneExportData(this.extract(pack.collection, exportedData, {
                format,
                onSkippedDynamicField: info => skippedDynamicFields.push({
                    entry: name,
                    ...info,
                }),
            })) ?? {};

            if (format === "legacy") {
                file.entries.push(foundry.utils.mergeObject({id: name}, extracted));
            } else {
                file.entries[name] = extracted;
            }
        }

        if (skippedDynamicFields.length) {
            console.warn("Babele | skipped dynamic export fields", {
                pack: pack.collection,
                fields: skippedDynamicFields,
            });
        }

        return file;
    }

    /**
     *
     * @param actor
     */
    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
    }

    #normalizedExportSelection(selection) {
        if (selection === "present" || selection === "translated") {
            return "present";
        }

        if (selection === "missing" || selection === "untranslated") {
            return "missing";
        }

        return "all";
    }

    #exportSourceData(entity) {
        if (typeof entity?.toObject === "function") {
            const sourceData = entity.toObject();

            if (this.#isJournalEntry(entity)) {
                this.#hydrateJournalEmbeddedExportData(sourceData, entity);
            }

            return sourceData;
        }

        return entity;
    }

    #isJournalEntry(entity) {
        return entity?.documentName === "JournalEntry"
            || entity?.constructor?.metadata?.name === "JournalEntry";
    }

    #hydrateJournalEmbeddedExportData(sourceData, entity) {
        this.#hydrateEmbeddedCollection(sourceData, entity, "pages");
        this.#hydrateEmbeddedCollection(sourceData, entity, "categories");
    }

    #hydrateEmbeddedCollection(sourceData, entity, key) {
        const current = sourceData?.[key];
        if (Array.isArray(current) && current.length > 0) {
            return;
        }

        const embedded = entity?.[key]?.contents;
        if (!Array.isArray(embedded) || embedded.length === 0) {
            return;
        }

        sourceData[key] = embedded.map((document) => typeof document?.toObject === "function" ? document.toObject() : document);
    }

    async #exportEntriesFor(pack, mappedCompendium) {
        const index = this.#normalizedExportIndex(await pack.getIndex());
        const entities = await Promise.all(index.map(entry => pack.getDocument(entry._id)));

        return entities.map(entity => {
            const sourceData = this.#exportSourceData(entity);
            return {
                entity,
                sourceData,
                hasTranslation: this.#exportHasTranslation(entity, sourceData, mappedCompendium),
            };
        });
    }

    async #exportSelectionCountsFor(pack, mappedCompendium) {
        const index = this.#normalizedExportIndex(await pack.getIndex());
        const all = index.length;
        const present = index.filter((entry) => this.#exportHasTranslation(entry, this.#exportLookupData(entry), mappedCompendium)).length;

        return {
            all,
            present,
            missing: all - present,
        };
    }

    #normalizedExportIndex(index) {
        if (Array.isArray(index)) {
            return index;
        }

        if (typeof index?.values === "function") {
            return Array.from(index.values());
        }

        if (index && typeof index[Symbol.iterator] === "function") {
            return Array.from(index);
        }

        return [];
    }

    #exportLookupData(data) {
        if (!data) {
            return data;
        }

        const originalName = data?.flags?.babele?.originalName ?? data?.originalName ?? null;
        if (!originalName || data?.name === originalName) {
            return data;
        }

        return {
            ...data,
            name: originalName,
        };
    }

    #exportHasTranslation(entity, data, mappedCompendium) {
        const explicitFlag = entity?.getFlag?.("babele", "hasTranslation")
            ?? entity?.flags?.babele?.hasTranslation
            ?? data?.flags?.babele?.hasTranslation
            ?? entity?.hasTranslation
            ?? data?.hasTranslation;

        if (typeof explicitFlag === "boolean") {
            return explicitFlag;
        }

        return mappedCompendium?.hasTranslation?.(this.#exportLookupData(data)) ?? false;
    }

    #shouldExportEntity(selection, hasTranslation) {
        if (selection === "present") {
            return hasTranslation;
        }

        if (selection === "missing") {
            return !hasTranslation;
        }

        return true;
    }

    #exportPayloadData(sourceData, hasTranslation, mappedCompendium) {
        if (!hasTranslation) {
            return sourceData;
        }

        return mappedCompendium?.translate?.(sourceData) ?? sourceData;
    }

    #createExportZipProgress(pack) {
        const label = `Babele | Exporting ${pack.metadata.label} zip`;

        if (typeof ui?.notifications?.info === "function") {
            return ui.notifications.info(label, {
                progress: true,
                console: false,
            });
        }

        return null;
    }

    #updateExportZipProgress(progress, pack, percent) {
        const pct = Math.max(0, Math.min(1, percent));
        const message = `Babele | Exporting ${pack.metadata.label} zip`;

        if (progress?.update) {
            progress.update({message, pct});
            return;
        }

        if (typeof SceneNavigation?.displayProgressBar === "function") {
            SceneNavigation.displayProgressBar({label: message, pct: pct * 100});
        }
    }

    async #yieldToUi() {
        if (typeof requestAnimationFrame === "function") {
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 0));
    }

    #exportEntryName(...candidates) {
        for (const candidate of candidates) {
            const name = candidate?.getFlag?.("babele", "originalName")
                ?? candidate?.flags?.babele?.originalName
                ?? candidate?.originalName
                ?? candidate?.name;

            if (name) {
                return name;
            }
        }

        return "entry";
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

    translateImportedCompendiumFolder(folder) {
        if (!folder) {
            return;
        }

        const sourceCollection = this.sourcePackCollectionFor(folder);
        if (!sourceCollection) {
            return;
        }

        const tcFolders = this.packs.get(sourceCollection)?.folders ?? [];
        const originalName = folder.originalName ?? folder.name;
        const translatedName = tcFolders[originalName];

        if (translatedName) {
            folder.originalName = originalName;
            folder.name = translatedName;
        }
    }

    translateImportedCompendiumFolders(folders = game.collections.get("Folder")) {
        folders?.forEach?.((folder) => this.translateImportedCompendiumFolder(folder));
    }

    sourcePackCollectionFor(document) {
        const directSourceId = document?._stats?.compendiumSource ?? document?.flags?.core?.sourceId;
        const directCollection = this.#collectionFromSourceId(directSourceId);
        if (directCollection) {
            return directCollection;
        }

        for (const entry of document?.contents ?? []) {
            const entrySourceId = entry?._stats?.compendiumSource ?? entry?.flags?.core?.sourceId;
            const entryCollection = this.#collectionFromSourceId(entrySourceId);
            if (entryCollection) {
                return entryCollection;
            }
        }

        const folderId = document?.id ?? document?._id;
        const documentType = document?.type ?? null;

        if (!folderId) {
            return null;
        }

        return game.packs?.find?.((pack) => {
            const packType = pack?.metadata?.type ?? pack?.documentName ?? null;
            if (documentType && packType && documentType !== packType) {
                return false;
            }

            return !!pack?.folders?.get?.(folderId);
        })?.collection ?? null;
    }

    #collectionFromSourceId(sourceId) {
        if (!sourceId) {
            return null;
        }

        return String(sourceId).match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1] ?? null;
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
        this.#applyTranslationMatchStrategies();
    }

    #applyEffectiveMappings(mappings) {
        Babel.DEFAULT_MAPPINGS = mappings;
    }

    #applyTranslationMatchStrategies() {
        if (!this.packs?.values) {
            return;
        }

        const strategies = this.translationMatchStrategies();
        for (const pack of this.packs.values()) {
            pack.useTranslationMatchStrategies?.(strategies);
        }
    }

}

export default Babel

window.Babele = Babel;
