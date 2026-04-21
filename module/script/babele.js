import {registerModuleSettings} from "./foundry/settings.js";
import {initWrapper} from "./foundry/wrapper.js";
import {Converters} from "./converter/converters.js";
import {OnDemandTranslateDialog} from "./ui/on-demand-translate-dialog.js";
import {DocumentMappings} from "./mapping/document-mappings.js";
import {BabeleRuntimeApplier} from "./foundry/babele-runtime-applier.js";
import {BabeleUiBridge} from "./ui/babele-ui-bridge.js";
import {DocumentConverter} from "./converter/document-converter.js";
import {StructuredDataConverter} from "./converter/structured-data-converter.js";
import {LookupConverter} from "./converter/lookup-converter.js";
import {TokenizedLookupConverter} from "./converter/tokenized-lookup-converter.js";
import {IdentityExtractorRegistry} from "./identity/identity-extractor-registry.js";
import {CompendiumRuntime} from "./compendium/compendium-runtime.js";
import {PackFoldersExport} from "./export/pack-folders-export.js";
import {TranslationExport} from "./export/translation-export.js";
import {FolderTranslations} from "./compendium/folder-translations.js";
import {MappedCompendiums} from "./compendium/mapped-compendiums.js";
import {ConverterRegistry} from "./converter/converter-registry.js";
import {CompendiumCatalog} from "./compendium/compendium-catalog.js";
import {TranslationRegistry} from "./translation/translation-registry.js";

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

    // `init()` only loads and installs Babele state. Runtime application is
    // deferred until Foundry is fully ready so compendium indexes, folders,
    // and caches can be updated coherently.
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
    #translationMatchStrategies
    #identityExtractors
    #folderTranslations
    #translationRegistry
    #catalog

    /**
     * Compatibility view of the currently published default mappings.
     *
     * The authoritative state lives in `DocumentMappings`; this getter
     * remains as a stable public entry point for callers that still inspect
     * default mappings through the facade.
     *
     * @returns {object}
     */
    static get DEFAULT_MAPPINGS() {
        return DocumentMappings.DEFAULT_MAPPINGS;
    }

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
        this.translations = null;
        this.mappedCompendiums = null;
        this.folders = null;
        this.#initialized = null;
        this.#dataLoaded = false;
        this.#translationMatchStrategies = [];
        this.#identityExtractors = new IdentityExtractorRegistry(IdentityExtractorRegistry.defaultExtractors());
        this.converterRegistry = new ConverterRegistry();
        this.registerDefaultIdentityExtractors();
        this.documentMappings = new DocumentMappings(undefined, {
            identityExtractors: this.#identityExtractors,
            converterRegistry: this.converterRegistry,
        });
        this.documentMappings.publish();
        this.#catalog = new CompendiumCatalog();
        this.#folderTranslations = new FolderTranslations({
            mappedCompendiums: () => this.mappedCompendiums,
            catalog: this.#catalog,
        });
        this.#translationRegistry = new TranslationRegistry();
        this.#translationRegistry.registerConfiguredDirectory();
        this.registerDefaultConverters();
    }

    /**
     * Register the built-in identity extractors exposed by Babele.
     *
     * This is invoked during facade construction and can also be reused by
     * custom bootstrap code when replacing registries in tests or advanced
     * integrations.
     *
     * @returns {void}
     */
    registerDefaultIdentityExtractors() {
        this.registerIdentityExtractors({
            range: (document) => {
                const [start, end] = document?.range ?? [];
                return Number.isInteger(start) && Number.isInteger(end) ? `${start}-${end}` : null;
            },
        });
    }

    /**
     * Register the default converters shipped with Babele.
     *
     * This publishes both the OO first-class converters and the legacy named
     * registrations kept for backward compatibility with existing mappings.
     *
     * @returns {void}
     */
    registerDefaultConverters() {
        this.registerConverters({
            ...Converters.legacyRegistrations(),
            "document": new DocumentConverter(),
            "structured": new StructuredDataConverter(),
            "lookup": new LookupConverter(),
            "tokenizedLookup": new TokenizedLookupConverter(),
        });
    }

    /**
     * Register one module translation source.
     *
     * The module declaration mirrors the public API historically exposed by
     * Babele: the directory identifies the root containing language folders
     * and optional mapping files.
     *
     *
     * @param {{module: string, dir: string, lang?: string}} module
     * @returns {void}
     */
    register(module) {
        this.#translationRegistry.registerModule(module);
    }

    /**
     * Register one named converter.
     *
     * Function-based legacy converters are normalized to the internal OO
     * converter contract at registration time.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {string} name
     * @param {Function|object} converter
     * @returns {void}
     */
    registerConverter(name, converter) {
        this.registerConverters({[name]: converter});
    }

    /**
     * Register multiple named converters at once.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {Record<string, Function|object>} converters
     * @returns {void}
     */
    registerConverters(converters) {
        this.converterRegistry.registerAll(converters);
    }

    /**
     * Register an additional translation match strategy. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {import("./translation/translation-entries.js").TranslationStrategy} strategy
     */
    registerTranslationMatchStrategy(strategy) {
        this.registerTranslationMatchStrategies([strategy]);
    }

    /**
     * Register additional translation match strategies. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {import("./translation/translation-entries.js").TranslationStrategy[]} strategies
     */
    registerTranslationMatchStrategies(strategies) {
        this.#translationMatchStrategies.push(...(strategies ?? []).filter(Boolean));
    }

    /**
     * Register one named identity extractor.
     *
     * Identity extractors can be referenced by document mappings when the
     * default `_id`/`name`/`sourceId` identity candidates are not sufficient.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {string} name
     * @param {Function} extractor
     * @returns {void}
     */
    registerIdentityExtractor(name, extractor) {
        this.registerIdentityExtractors({[name]: extractor});
    }

    /**
     * Register multiple named identity extractors.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full state rebuild.
     *
     * @param {Record<string, Function>} extractors
     * @returns {void}
     */
    registerIdentityExtractors(extractors = {}) {
        this.#identityExtractors.registerAll(extractors);
    }

    /**
     * Expose the live identity-extractor registry used by document mappings.
     *
     * This is an advanced extension point intended for integrations that need
     * to inspect or reuse the same registry object used by the facade.
     *
     * @returns {IdentityExtractorRegistry}
     */
    identityExtractorRegistry() {
        return this.#identityExtractors;
    }

    /**
     * Return the effective translation match strategies in precedence order.
     *
     * @returns {import("./translation/translation-entries.js").TranslationStrategy[]}
     */
    translationMatchStrategies() {
        return [...this.#translationMatchStrategies];
    }

    /**
     * Register one global document mapping layer.
     *
     * Registered mappings enrich or override the built-in defaults for the
     * next full Babele state rebuild.
     *
     * @param {object} mapping
     * @returns {void}
     */
    registerMapping(mapping) {
        this.documentMappings = this.documentMappings.withRegistered(mapping);
        this.documentMappings.publish();
    }

    /**
     * Declare the system-level translations directory.
     *
     * The directory is resolved relative to `systems/<system-id>` and acts as
     * the lowest-precedence filesystem source in the registry.
     *
     * @param {string|null} dir
     * @returns {void}
     */
    setSystemTranslationsDir(dir) {
        this.#translationRegistry.registerSystemTranslations(dir);
    }

    /**
     * Initialize babele downloading the available translations files and instantiating the associated
     * translated compendium class.
     *
     * @returns {Promise<boolean>}
     */
    async init() {
        if (this.#initialized !== null) {
            return await this.#initialized;
        }

        const initializing = (async () => {
            try {
                const state = await this.#loadState();
                await this.#installState(state);
                this.#initialized = Promise.resolve(true);

                if (!this.#dataLoaded) {
                    this.#dataLoaded = true;
                    Hooks.callAll("babele.dataLoaded");
                }

                return true;
            } catch (error) {
                this.#initialized = null;
                return false;
            }
        })();

        this.#initialized = initializing;
        return await initializing;
    }

    /**
     * Reload the current Babele state from the registered sources and, by
     * default, re-apply the translated runtime views exposed to Foundry.
     *
     * When the reload fails, the previously initialized state remains active.
     *
     * @param {object} [options]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.notify]
     * @returns {Promise<boolean>}
     */
    async reinitialize({shareSources = false, notify = false} = {}) {
        const previousInitialization = this.#initialized;

        const reinitializing = (async () => {
            try {
                const state = await this.#loadState();
                await this.#installState(state, {applyRuntime: true, shareSources, notify});
                this.#initialized = Promise.resolve(true);
                Hooks.callAll("babele.reinitialized", this);
                return true;
            } catch (error) {
                this.#initialized = previousInitialization;
                console.error("Babele | reinitialization failed", error);
                return false;
            }
        })();

        this.#initialized = reinitializing;
        return await reinitializing;
    }

    /**
     * Refresh translation sources after a settings change and publish the new
     * effective file revision for non-browsing clients.
     *
     * @returns {Promise<boolean>}
     */
    async refreshTranslationSources() {
        const refreshed = await this.reinitialize({
            shareSources: true,
            notify: false,
        });

        if (!refreshed) {
            return false;
        }

        await this.#publishSourcesRevision();
        ui.notifications?.info?.(
            "Babele refreshed translation sources. Closed compendium documents are updated; already open documents may need to be reopened.",
        );
        return true;
    }

    /**
     * Re-apply the current loaded Babele state to Foundry runtime collections.
     *
     * This updates translated indexes, imported folders, and the published
     * file lists used as fallback by clients that cannot browse the
     * filesystem.
     *
     * @param {object} [options]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.notify]
     * @param {boolean} [options.renderCompendium]
     * @returns {Promise<void>}
     */
    async applyRuntimeTranslations(options = {}) {
        await new BabeleRuntimeApplier({
            registry: this.#translationRegistry,
            folderTranslations: this.#folderTranslations,
            mappedCompendiums: this.mappedCompendiums,
        }).apply(options);
    }

    /**
     * Build the next coherent Babele state from the currently registered
     * translation sources.
     *
     * This method does not mutate the facade runtime state. It only loads the
     * data required to do so safely in a later step.
     *
     * @returns {Promise<{
     *   translations: import("./translation/compendium-translations.js").CompendiumTranslations,
     *   mappedCompendiums: import("./compendium/mapped-compendiums.js").MappedCompendiums,
     *   documentMappings: import("./mapping/document-mappings.js").DocumentMappings,
     *   folders: object[]|null
     * }>}
     */
    async #loadState() {
        let step = "load translations";

        try {
            const documentMappings = this.documentMappings.withLoaded(await this.#translationRegistry.loadMappings());
            const translations = await this.#translationRegistry.loadTranslations();
            step = "build mapped compendium registry";
            const mappedCompendiums = await new MappedCompendiums({
                catalog: this.#catalog,
                documentMappings,
                translations,
                translationStrategies: this.translationMatchStrategies(),
            }).load();

            return {
                translations,
                mappedCompendiums,
                documentMappings,
                folders: game.data.folders,
            };
        } catch (error) {
            console.error(`Babele | initialization failed during step: ${step}`, error);
            throw error;
        }
    }

    /**
     * Install one previously loaded Babele state into the live runtime and,
     * optionally, re-apply translated runtime views to Foundry collections.
     *
     * @param {object} state
     * @param {import("./translation/compendium-translations.js").CompendiumTranslations} state.translations
     * @param {import("./compendium/mapped-compendiums.js").MappedCompendiums} state.mappedCompendiums
     * @param {import("./mapping/document-mappings.js").DocumentMappings} state.documentMappings
     * @param {object[]|null} [state.folders]
     * @param {object} [options]
     * @param {boolean} [options.applyRuntime]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.notify]
     * @returns {Promise<boolean>}
     */
    async #installState(state, {applyRuntime = false, shareSources = false, notify = false} = {}) {
        let step = "install state";

        try {
            this.#applyRuntimeState(state);

            if (applyRuntime) {
                step = "apply runtime translations";
                await this.applyRuntimeTranslations({shareSources, notify});
            }

            return true;
        } catch (error) {
            console.error(`Babele | initialization failed during step: ${step}`, error);
            throw error;
        }
    }

    /**
     * Publish the effective source revision so non-GM clients can trigger a
     * synchronized refresh when the GM changes translation directories.
     *
     * @returns {Promise<void>}
     */
    async #publishSourcesRevision() {
        if (!game.user.isGM) {
            return;
        }

        await game.settings.set("babele", "sourcesRevision", Date.now());
    }

    /**
     * Return a frozen compatibility snapshot of the registered converters.
     *
     * @returns {Record<string, object>}
     */
    get converters() {
        return this.converterRegistry.snapshot();
    }

    /**
     * Resolve one named converter from the registry.
     *
     * @param {string} name
     * @returns {object|null}
     */
    converterNamed(name) {
        return this.converterRegistry.named(name);
    }

    /**
     * Resolve the translated mapped compendium that should translate a
     * document of the given type in the current runtime visibility rules.
     *
     * Callers may provide an explicit runtime registry through `options` to
     * constrain lookup to a custom scope, such as on-demand translation or
     * embedded-document processing.
     *
     * @param {string|null} documentType
     * @param {object} data
     * @param {object} [options]
     * @param {Map|object[]|null} [options.registry]
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    translatedPackFor(documentType, data, options = {}) {
        const registry = options.registry ?? this.mappedCompendiums ?? new foundry.utils.Collection();
        return CompendiumRuntime.from({globalPacks: registry}).translatedPackFor(documentType, data);
    }

    /**
     * Translates inplace and returns the compendium index.
     *
     * @param {object[]} index the untranslated index
     * @param {string} pack the pack name
     * @returns {object[]} the translated index
     */
    translateIndex(index, pack) {
        return this.mappedCompendiums?.translateIndex(index, pack) ?? index;
    }

    /**
     * Check if the compendium pack is translated (exists an associated translation file).
     *
     * @param {string} pack compendium name (ex. dnd5e.classes)
     * @returns {boolean} true if the compendium is translated.
     */
    isTranslated(pack) {
        return !!this.mappedCompendiums?.translated(pack);
    }

    /**
     * Translate one compendium document payload.
     *
     * When `translationsOnly` is truthy the mapped compendium may return only
     * the translated delta rather than the full merged document shape.
     *
     * @param {string} pack
     * @param {*} data
     * @param {boolean} [translationsOnly]
     * @returns {*}
     */
    translate(pack, data, translationsOnly) {
        return this.mappedCompendiums?.translate(pack, data, translationsOnly) ?? data;
    }

    /**
     * Translate one mapped field from a compendium document.
     *
     * @param {string} field
     * @param {string} pack
     * @param {*} data
     * @returns {*}
     */
    translateField(field, pack, data) {
        return this.mappedCompendiums?.translateField(pack, field, data) ?? null;
    }

    /**
     * Extract the exportable translation payload for one compendium document.
     *
     * @param {string} pack
     * @param {*} data
     * @param {object} [options]
     * @returns {*}
     */
    extract(pack, data, options = {}) {
        return this.mappedCompendiums?.extract(pack, data, options);
    }

    /**
     * Extract one mapped field from a compendium document.
     *
     * @param {string} pack
     * @param {string} field
     * @param {*} data
     * @returns {*}
     */
    extractField(pack, field, data) {
        return this.mappedCompendiums?.extractField(pack, field, data);
    }

    /**
     * Resolve the translated mapped compendium for a collection id.
     *
     * @param {string} pack
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    translatedCompendiumFor(pack) {
        return this.mappedCompendiums?.translated(pack) ?? null;
    }

    /**
     * Resolve the mapped compendium for a collection id, translated or not.
     *
     * @param {string} pack
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    mappedCompendiumFor(pack) {
        return this.mappedCompendiums?.get?.(pack) ?? null;
    }

    /**
     * Export one compendium translation ZIP through the interactive export UI.
     *
     * @param {object} pack
     * @returns {Promise<void>}
     */
    async exportTranslationsFile(pack) {
        return new TranslationExport(this, pack).download();
    }

    /**
     * Produce the raw export payload for one compendium without downloading it.
     *
     * This is mainly useful for tests and advanced integrations.
     *
     * @param {object} pack
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    async exportDataFor(pack, options = {}) {
        return new TranslationExport(this, pack).data(options);
    }

    /**
     * Export synthetic package-scoped `_packs-folders` starter files.
     *
     * @returns {Promise<void>}
     */
    async exportPackFoldersFile() {
        return new PackFoldersExport(this).download();
    }

    /**
     * Produce raw synthetic `_packs-folders` export payloads without
     * downloading them.
     *
     * @param {object} [options]
     * @returns {Array<object>}
     */
    exportPackFoldersData(options = {}) {
        return new PackFoldersExport(this).data(options);
    }

    /**
     * Open the on-demand actor translation dialog.
     *
     * @param {Actor} actor
     * @returns {void}
     */
    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
    }

    /**
     * Apply folder-name translations to one open compendium tree.
     *
     * @param {CompendiumCollection|object} pack
     * @returns {void}
     */
    translatePackFolders(pack) {
        this.#folderTranslations.translatePackFolders(pack);
    }

    /**
     * Apply folder-name translations to one imported world folder when its
     * source compendium can be resolved.
     *
     * @param {Folder|object} folder
     * @returns {void}
     */
    translateImportedCompendiumFolder(folder) {
        this.#folderTranslations.translateImportedCompendiumFolder(folder);
    }

    /**
     * Re-apply imported compendium folder translations to a folder collection.
     *
     * @param {Iterable<Folder>|object} [folders]
     * @returns {void}
     */
    translateImportedCompendiumFolders(folders = game.collections.get("Folder")) {
        this.#folderTranslations.translateImportedCompendiumFolders(folders);
    }

    /**
     * Apply `_packs-folders` translations to top-level system/world folders.
     *
     * @returns {void}
     */
    translateSystemPackFolders() {
        this.#folderTranslations.translateSystemPackFolders();
    }

    #applyRuntimeState({translations, mappedCompendiums, documentMappings, folders = null}) {
        this.translations = translations;
        this.mappedCompendiums = mappedCompendiums ?? null;
        this.folders = folders;
        this.documentMappings = documentMappings ?? this.documentMappings;
        this.documentMappings.publish();
    }

}

export default Babel

window.Babele = Babel;
