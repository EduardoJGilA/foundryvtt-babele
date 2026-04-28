import {CompendiumTranslation} from "./compendium-translation.js";
import {CompendiumTranslations} from "./compendium-translations.js";
import {DirectoryTranslationSource, PublishedTranslationSource} from "./translation-source.js";

/**
 * @typedef {Object} TranslationSourceFile
 * @property {string} file Absolute or relative path as returned by Foundry file browsing.
 * @property {string} directory Directory the file was discovered in.
 * @property {string} baseName File basename used for pack/source grouping.
 * @property {"translation"|"mapping"} kind
 * @property {string} [source]
 */

/**
 * Bootstrap aggregate responsible for discovering, loading, and composing the
 * effective translation and mapping files for the current language.
 *
 * The registry owns:
 * - the registered translation sources ordered by merge precedence
     * - the internal published fallback source used when file browsing is unavailable
 * - precedence, deduplication, and mapping filename normalization
 * - JSON loading and fail-open diagnostics
 * - materialization of `CompendiumTranslations`
 *
 * Effective precedence is source-driven:
 * - lower source weights are loaded first
 * - higher source weights are loaded later and override earlier payloads
 */
export class TranslationRegistry {

    static MAPPING_FILENAME = DirectoryTranslationSource.MAPPING_FILENAME;
    static LEGACY_MAPPING_FILENAME = DirectoryTranslationSource.LEGACY_MAPPING_FILENAME;

    constructor({
        jsonLoader = null,
    } = {}) {
        this._sources = [];
        this._moduleRegistrations = new Map();
        this._publishedSource = new PublishedTranslationSource({
            translationFiles: () => game.settings.get("babele", "translationFiles"),
            mappingFiles: () => game.settings.get("babele", "mappingFiles"),
        });
        this._jsonLoader = jsonLoader;
        this.#invalidateDiscovery();
        this._language = null;
    }

    /**
     * Register or replace one translation source by name.
     *
     * @param {{name?: string}} source
     * @returns {TranslationRegistry}
     */
    register(source) {
        this._sources = [
            ...this._sources.filter((registered) => registered?.name !== source?.name),
            source,
        ];
        this.#invalidateDiscovery();
        return this;
    }

    /**
     * Remove a previously registered source by name.
     *
     * @param {string} name
     * @returns {TranslationRegistry}
     */
    unregister(name) {
        this._sources = this._sources.filter((source) => source?.name !== name);
        this.#invalidateDiscovery();
        return this;
    }

    /**
     * Register the translation source contributed by one module registration.
     *
     * Modules are loaded after system translations and before the configured
     * directory, so they can enrich or override system payloads while still
     * remaining overridable by the explicit user directory.
     *
     * @param {{module: string, dir?: string|string[], dirs?: string[], lang?: string}} module
     * @returns {TranslationRegistry}
     */
    registerModule(module) {
        const registration = this.#moduleRegistrationFor(module);

        return this.register(new DirectoryTranslationSource({
            name: registration.name,
            weight: 20,
            supports: (language) => registration.lang === language,
            translationDirectories: () => registration.dirs.map((dir) => `modules/${registration.module}/${dir}`),
            mappingDirectories: () => registration.dirs.map((dir) => `modules/${registration.module}/${dir}`),
        }));
    }

    /**
     * Register or remove the current system translation source.
     *
     * System translations are loaded first so they establish the baseline
     * payload that modules and the configured directory may override.
     *
     * @param {string|null} directory
     * @returns {TranslationRegistry}
     */
    registerSystemTranslations(directory) {
        if (!directory) {
            return this.unregister("system");
        }

        return this.register(new DirectoryTranslationSource({
                name: "system",
                weight: 10,
                translationDirectories: (language) => [`systems/${game.system.id}/${directory}/${language}`],
                mappingDirectories: () => [`systems/${game.system.id}/${directory}`],
            }));
    }

    /**
     * Register the directory configured from Babele settings.
     *
     * This source has the highest normal precedence and therefore overrides
     * both system and module payloads.
     *
     * @returns {TranslationRegistry}
     */
    registerConfiguredDirectory() {
        return this.register(new DirectoryTranslationSource({
            name: "directory",
            weight: 30,
            translationDirectories: (language) => {
                const directory = game.settings.get("babele", "directory");
                return directory?.trim?.() ? [`${directory}/${language}`] : [];
            },
            mappingDirectories: () => {
                const directory = game.settings.get("babele", "directory");
                return directory?.trim?.() ? [directory] : [];
            },
        }));
    }

    #invalidateDiscovery() {
        this._translationSources = null;
        this._mappingSources = null;
        this._translationDiagnostics = null;
        this._mappingDiagnostics = null;
    }

    /**
     * Explicitly invalidate cached source-discovery results.
     *
     * This does not unload already materialized translation state. Callers that
     * need the live runtime to change should follow with a full Babele
     * reinitialization.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    invalidate(reason = "manual") {
        this.#invalidateDiscovery();
        this.#debug("invalidated translation registry discovery cache", {reason});
    }

    /**
     * Return a snapshot of source-discovery cache boundaries.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        return {
            boundary: "translation-registry",
            language: this._language,
            translationSourcesCached: this._translationSources !== null,
            mappingSourcesCached: this._mappingSources !== null,
            translationDiagnosticsCached: this._translationDiagnostics !== null,
            mappingDiagnosticsCached: this._mappingDiagnostics !== null,
            registeredSources: this._sources.map((source) => ({
                name: source?.name ?? null,
                weight: source?.weight?.() ?? null,
            })),
        };
    }

    async discover(language = this.#language()) {
        await Promise.all([this.translationSources(language), this.mappingSources(language)]);
    }

    /**
     * Return the effective translation files for the requested language in the
     * same precedence order used during merge.
     *
     * @param {string} [language]
     * @returns {Promise<TranslationSourceFile[]>}
     */
    async translationSources(language = this.#language()) {
        this.#prepare(language);

        if (this._translationSources) {
            this.#debug("using cached translation source discovery", {language});
            return this._translationSources;
        }

        const rawSources = await this.#discoverFromActiveSources("translation", language);
        const uniqueSources = this.#dedupeSources(rawSources);

        this._translationSources = uniqueSources;
        this._translationDiagnostics = this.#buildDiagnostics("translation", rawSources, uniqueSources);
        return uniqueSources;
    }

    /**
     * Return the effective mapping files for the requested language in the
     * same precedence order used during merge.
     *
     * Canonical `mappings.json` files win over deprecated `mapping.json`
     * files found in the same directory.
     *
     * @param {string} [language]
     * @returns {Promise<TranslationSourceFile[]>}
     */
    async mappingSources(language = this.#language()) {
        this.#prepare(language);

        if (this._mappingSources) {
            this.#debug("using cached mapping source discovery", {language});
            return this._mappingSources;
        }

        const rawSources = await this.#discoverFromActiveSources("mapping", language);
        const uniqueSources = this.#normalizeMappingSources(this.#dedupeSources(rawSources));

        this._mappingSources = uniqueSources;
        this._mappingDiagnostics = this.#buildDiagnostics("mapping", rawSources, uniqueSources);
        return uniqueSources;
    }

    /**
     * Return the effective translation files contributing to one compendium
     * collection.
     *
     * @param {string} collection
     * @param {string} [language]
     * @returns {Promise<TranslationSourceFile[]>}
     */
    async sourcesFor(collection, language = this.#language()) {
        return this.#orderedSourcesFor(collection, (await this.translationSources(language))
            .filter((source) => source.baseName === encodeURI(`${collection}.json`)));
    }

    /**
     * Return the configured source-priority settings.
     *
     * @returns {{global: string[], collections: Record<string, string[]>}}
     */
    sourcePriority() {
        return this.#sourcePriorityConfig();
    }

    /**
     * Persist source priority for one collection.
     *
     * The provided array is interpreted as merge order for matching sources:
     * listed sources are applied after unlisted sources, and later listed
     * sources override earlier listed sources.
     *
     * @param {string} collection
     * @param {string[]} sources
     * @returns {Promise<void>}
     */
    async setSourcePriority(collection, sources = []) {
        const config = this.#sourcePriorityConfig();
        const normalized = [...new Set((sources ?? []).filter(Boolean).map(String))];

        if (normalized.length === 0) {
            delete config.collections[collection];
        } else {
            config.collections[collection] = normalized;
        }

        await game.settings.set("babele", "sourcePriority", config);
        this.invalidate("source-priority-change");
    }

    /**
     * Load and merge all effective translation payloads for the requested
     * language.
     *
     * Files are merged in precedence order, so later sources override earlier
     * ones on the same collection.
     *
     * @param {string} [language]
     * @returns {Promise<CompendiumTranslations>}
     */
    async loadTranslations(language = this.#language()) {
        const translationSources = await this.translationSources(language);
        const translations = new CompendiumTranslations();

        if (translationSources.length === 0) {
            console.log(`Babele | no compendium translation files found for ${language} language.`);
            return translations;
        }

        for (const [collection, sources] of this.#translationSourcesByCollection(translationSources).entries()) {
            const orderedSources = this.#orderedSourcesFor(collection, sources);
            const files = orderedSources.map((source) => source.file);
            const payload = (
                await Promise.all(
                    files.map((file) => this.loadJsonFile(file, {
                        kind: "translation",
                        collection,
                    })),
                )
            ).reduce(
                (merged, entry) => (entry ? merged.merge(entry) : merged),
                new CompendiumTranslation(collection),
            );

            if (!payload.loaded()) {
                continue;
            }

            if (files.length > 1) {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${files.length} source file(s)`, files);
            } else {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${files[0]}`);
            }

            translations.add(payload);
        }

        return translations.resolveInheritance();
    }

    /**
     * Load and merge all global mapping payloads for the requested language.
     *
     * @param {string} [language]
     * @returns {Promise<object[]>}
     */
    async loadMappings(language = this.#language()) {
        const mappingFiles = (await this.mappingSources(language)).map((source) => source.file);

        if (mappingFiles.length === 0) {
            return [];
        }

        console.log("Babele | global mapping files found, defaults will be enriched/overwritten...", mappingFiles);

        const mappings = await Promise.all(
            mappingFiles.map((file) => this.loadJsonFile(file, {
                kind: "mapping",
                phase: "global defaults enrichment",
            })),
        );

        return mappings.filter(Boolean);
    }

    /**
     * Materialize a diagnostic snapshot of effective translation and mapping
     * sources for the requested language.
     *
     * @param {string} [language]
     * @returns {Promise<object>}
     */
    async diagnostics(language = this.#language()) {
        await this.discover(language);

        return {
            language,
            translation: {
                ...this._translationDiagnostics,
                packs: this.#packDiagnostics(this._translationSources),
                overlaps: this.#overlapDiagnostics(this._translationSources),
            },
            mapping: this._mappingDiagnostics,
        };
    }

    /**
     * Publish the effective translation files so non-browsing clients can
     * reuse them through the fallback source.
     *
     * @param {string} [language]
     * @returns {Promise<void>}
     */
    async shareTranslationFiles(language = this.#language()) {
        if (!game.user.isGM) {
            return;
        }

        game.settings.set(
            "babele",
            "translationFiles",
            (await this.translationSources(language)).map((source) => source.file),
        );
    }

    /**
     * Publish the effective mapping files so non-browsing clients can reuse
     * them through the fallback source.
     *
     * @param {string} [language]
     * @returns {Promise<void>}
     */
    async shareGlobalMappingFiles(language = this.#language()) {
        if (!game.user.isGM) {
            return;
        }

        game.settings.set(
            "babele",
            "mappingFiles",
            (await this.mappingSources(language)).map((source) => source.file),
        );
    }

    /**
     * Load one JSON payload with fail-open diagnostics.
     *
     * @param {string} file
     * @param {object} [context]
     * @returns {Promise<object|null>}
     */
    async loadJsonFile(file, context = {}) {
        try {
            return this._jsonLoader
                ? await this._jsonLoader(file, context)
                : await this.#fetchJson(file);
        } catch (error) {
            this.#logJsonLoadFailure(file, context, error);
            return null;
        }
    }

    #prepare(language) {
        if (this._language === language) {
            return;
        }

        this.#invalidateDiscovery();
        this.#debug("invalidated translation registry discovery cache for language switch", {
            previousLanguage: this._language,
            language,
        });
        this._language = language;
    }

    #debug(message, data = {}) {
        if (!globalThis.CONFIG?.debug?.babele) {
            return;
        }

        console.debug(`Babele | ${message}`, data);
    }

    async #discoverFromActiveSources(kind, language) {
        const activeSources = this.#activeSources(language);
        const discovered = await Promise.all(
            activeSources.map((source) => kind === "translation"
                ? source.translationFiles(language)
                : source.mappingFiles(language)),
        );

        return discovered.flat();
    }

    #activeSources(language) {
        if (this.#canIndexFiles()) {
            return [...this._sources]
                .filter((source) => source && (source.supports?.(language) ?? true))
                .sort((left, right) => (left.weight?.() ?? 0) - (right.weight?.() ?? 0));
        }

        return [this._publishedSource];
    }

    #translationSourcesByCollection(sources) {
        const byCollection = new Map();

        for (const source of sources) {
            const collection = source.baseName.replace(/\.json$/u, "");
            const collectionSources = byCollection.get(collection) ?? [];
            collectionSources.push(source);
            byCollection.set(collection, collectionSources);
        }

        return byCollection;
    }

    #packDiagnostics(sources = []) {
        return [...this.#translationSourcesByCollection(sources).entries()].map(([collection, collectionSources]) => {
            const orderedSources = this.#orderedSourcesFor(collection, collectionSources);
            return {
                collection,
                sourceCount: orderedSources.length,
                overlapping: orderedSources.length > 1,
                customPriority: this.#sourceOrderFor(collection).length > 0,
                sources: orderedSources.map((source) => source.source),
                files: orderedSources.map((source) => source.file),
            };
        });
    }

    #overlapDiagnostics(sources = []) {
        return this.#packDiagnostics(sources).filter((pack) => pack.overlapping);
    }

    #orderedSourcesFor(collection, sources = []) {
        const order = this.#sourceOrderFor(collection);
        if (order.length === 0 || sources.length < 2) {
            return [...sources];
        }

        const orderRank = new Map(order.map((source, index) => [source, index]));
        return sources
            .map((source, index) => ({source, index}))
            .sort((left, right) => {
                const leftRanked = orderRank.has(left.source.source);
                const rightRanked = orderRank.has(right.source.source);

                if (!leftRanked && !rightRanked) {
                    return left.index - right.index;
                }

                if (leftRanked !== rightRanked) {
                    return leftRanked ? 1 : -1;
                }

                return orderRank.get(left.source.source) - orderRank.get(right.source.source);
            })
            .map((entry) => entry.source);
    }

    #sourceOrderFor(collection) {
        const config = this.#sourcePriorityConfig();
        return config.collections[collection] ?? config.global ?? [];
    }

    #sourcePriorityConfig() {
        const raw = game.settings.get("babele", "sourcePriority");
        if (Array.isArray(raw)) {
            return {
                global: [...new Set(raw.filter(Boolean).map(String))],
                collections: {},
            };
        }

        if (!raw || typeof raw !== "object") {
            return {
                global: [],
                collections: {},
            };
        }

        const collections = Object.fromEntries(
            Object.entries(raw.collections ?? {})
                .filter(([, value]) => Array.isArray(value))
                .map(([collection, value]) => [
                    collection,
                    [...new Set(value.filter(Boolean).map(String))],
                ]),
        );

        return {
            global: Array.isArray(raw.global) ? [...new Set(raw.global.filter(Boolean).map(String))] : [],
            collections,
        };
    }

    #buildDiagnostics(kind, rawSources, uniqueSources) {
        return {
            kind,
            directories: [...new Set(rawSources.map((source) => source.directory))],
            rawFiles: rawSources.map((source) => source.file),
            uniqueFiles: uniqueSources.map((source) => source.file),
            duplicateFilesDiscarded: rawSources.length - uniqueSources.length,
            fromSettings: !this.#canIndexFiles(),
        };
    }

    #dedupeSources(sources) {
        const seen = new Set();
        return sources.filter((source) => {
            if (seen.has(source.file)) {
                return false;
            }

            seen.add(source.file);
            return true;
        });
    }

    #normalizeMappingSources(sources) {
        const byDirectory = new Map();

        for (const source of sources) {
            const entry = byDirectory.get(source.directory) ?? {};

            if (source.baseName === TranslationRegistry.MAPPING_FILENAME) {
                entry.canonical = source;
            } else if (source.baseName === TranslationRegistry.LEGACY_MAPPING_FILENAME) {
                entry.legacy = source;
            }

            byDirectory.set(source.directory, entry);
        }

        const normalized = [];
        for (const [directory, entry] of byDirectory.entries()) {
            if (entry.canonical) {
                if (entry.legacy) {
                    console.warn(`Babele | both '${TranslationRegistry.MAPPING_FILENAME}' and deprecated '${TranslationRegistry.LEGACY_MAPPING_FILENAME}' found in '${directory}'. Using '${TranslationRegistry.MAPPING_FILENAME}'.`);
                }
                normalized.push(entry.canonical);
                continue;
            }

            if (entry.legacy) {
                console.warn(`Babele | deprecated mapping filename '${TranslationRegistry.LEGACY_MAPPING_FILENAME}' found in '${directory}'. Please rename it to '${TranslationRegistry.MAPPING_FILENAME}'.`);
                normalized.push(entry.legacy);
            }
        }

        return normalized;
    }

    async #fetchJson(file) {
        const response = await fetch(file);

        if (response?.ok === false) {
            const status = response.status ?? "unknown";
            const statusText = response.statusText ? ` ${response.statusText}` : "";
            throw new Error(`HTTP ${status}${statusText}`);
        }

        return await response.json();
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

    #language() {
        return game.settings.get("core", "language");
    }

    #canIndexFiles() {
        return game.user.hasPermission("FILES_BROWSE") && game.user.isGM;
    }

    #moduleRegistrationFor(module) {
        const name = this.#moduleSourceName(module);
        const current = this._moduleRegistrations.get(name) ?? {
            name,
            module: module.module,
            lang: module.lang,
            dirs: [],
        };

        current.dirs = [...new Set([
            ...current.dirs,
            ...this.#moduleDirs(module),
        ])];
        this._moduleRegistrations.set(name, current);
        return current;
    }

    #moduleSourceName(module) {
        return `module:${module.module}:${module.lang ?? "*"}`;
    }

    #moduleDirs(module) {
        const dirs = module.dirs ?? module.dir ?? [];
        return (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
    }
}
