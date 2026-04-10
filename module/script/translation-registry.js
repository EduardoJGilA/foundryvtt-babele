/**
 * @typedef {Object} TranslationSource
 * @property {string} file Absolute or relative path as returned by Foundry file browsing.
 * @property {string} directory Directory the file was discovered in.
 * @property {string} baseName File basename used for pack/source grouping.
 * @property {"translation"|"mapping"} kind
 */

/**
 * @typedef {Object} TranslationRegistryDiagnostics
 * @property {string} language
 * @property {Object} translation
 * @property {string[]} translation.directories
 * @property {{dir: string, files: number}[]} [translation.browseResults]
 * @property {string[]} translation.rawFiles
 * @property {string[]} translation.uniqueFiles
 * @property {number} translation.duplicateFilesDiscarded
 * @property {boolean} [translation.fromSettings]
 * @property {{collection: string, sourceCount: number, files: string[]}[]} translation.packs
 * @property {Object} mapping
 * @property {string[]} mapping.directories
 * @property {{dir: string, files: number}[]} [mapping.browseResults]
 * @property {string[]} mapping.rawFiles
 * @property {string[]} mapping.uniqueFiles
 * @property {number} mapping.duplicateFilesDiscarded
 * @property {boolean} [mapping.fromSettings]
 */

/**
 * Internal registry responsible for discovering translation and mapping sources,
 * deduplicating paths, and exposing the effective file precedence used by Babele.
 *
 * The registry is intentionally source-oriented: it knows which files contribute
 * to a pack, but it does not fetch JSON contents or resolve individual document keys.
 * Public query methods return source records in effective precedence order.
 */
export class TranslationRegistry {

    static MAPPING_FILENAME = "mappings.json";
    static LEGACY_MAPPING_FILENAME = "mapping.json";

    /**
     * @param {{module: string, dir: string, lang?: string}[]} modules
     */
    constructor(modules = []) {
        this.modules = modules;
        this._translationSources = null;
        this._mappingSources = null;
        this._translationDiagnostics = null;
        this._mappingDiagnostics = null;
    }

    /**
     * Discover both translation and mapping sources and cache the results for reuse.
     * This is an idempotent warmup step; query methods still work lazily if it is not called.
     *
     * @returns {Promise<void>}
     */
    async discover() {
        await Promise.all([this.translationSources(), this.mappingSources()]);
    }

    /**
     * Return the discovered translation sources with directory and basename metadata.
     *
     * Results are memoized. If file indexing is unavailable, stored settings are used instead.
     * Returned sources are ordered exactly as Babele will consider them during merge.
     *
     * @returns {Promise<TranslationSource[]>}
     */
    async translationSources() {
        if (this._translationSources) {
            return this._translationSources;
        }

        if (!TranslationRegistry.#canIndexFiles) {
            this._translationSources = this.#fromStoredFiles(game.settings.get("babele", "translationFiles"), "translation");
            this._translationDiagnostics = this.#buildStoredDiagnostics("translation", this._translationSources);
            return this._translationSources;
        }

        const directories = this.#getTranslationDirectories();
        const {sources, diagnostics} = await this.#browseDirectories("translation", directories);
        this._translationSources = sources;
        this._translationDiagnostics = diagnostics;
        return sources;
    }

    /**
     * Return the discovered mapping sources with directory and basename metadata.
     *
     * Canonical mapping filenames are preferred over deprecated ones within the same directory.
     * Returned sources are ordered exactly as Babele will consider them during merge.
     *
     * @returns {Promise<TranslationSource[]>}
     */
    async mappingSources() {
        if (this._mappingSources) {
            return this._mappingSources;
        }

        if (!TranslationRegistry.#canIndexFiles) {
            const sources = this.#fromStoredFiles(game.settings.get("babele", "mappingFiles"), "mapping");
            this._mappingSources = this.#normalizeMappingSources(sources);
            this._mappingDiagnostics = this.#buildStoredDiagnostics("mapping", this._mappingSources);
            return this._mappingSources;
        }

        const directories = this.#getMappingDirectories();
        const {sources, diagnostics} = await this.#browseDirectories("mapping", directories);
        this._mappingSources = this.#normalizeMappingSources(sources);
        this._mappingDiagnostics = {
            ...diagnostics,
            uniqueFiles: this._mappingSources.map((source) => source.file),
            duplicateFilesDiscarded: diagnostics.rawFiles.length - this._mappingSources.length,
        };
        return this._mappingSources;
    }

    /**
     * Return the translation sources whose basename exactly matches the provided filename.
     *
     * @param {string} baseName
     * @returns {Promise<TranslationSource[]>}
     */
    async #translationSourcesByBasename(baseName) {
        return (await this.translationSources())
            .filter((source) => source.baseName === baseName);
    }

    /**
     * Return the effective translation sources for a compendium collection.
     *
     * @param {string} collection Compendium collection id, for example `dnd5e.items`.
     * @returns {Promise<TranslationSource[]>}
     */
    async sourcesFor(collection) {
        return await this.#translationSourcesByBasename(encodeURI(`${collection}.json`));
    }

    /**
     * Return a serializable diagnostic snapshot describing effective translation
     * and mapping sources, deduplication, and per-pack source aggregation.
     * Calling this method does not change precedence; it only materializes cached discovery state.
     *
     * @returns {Promise<TranslationRegistryDiagnostics>}
     */
    async diagnostics() {
        await this.discover();

        return {
            language: game.settings.get("core", "language"),
            translation: {
                ...this._translationDiagnostics,
                packs: await this.#buildPackDiagnostics(),
            },
            mapping: this._mappingDiagnostics,
        };
    }

    #getTranslationDirectories() {
        const lang = game.settings.get("core", "language");
        const directory = game.settings.get("babele", "directory");
        const directories = this.#uniqueEntries(this.modules
            .filter((module) => module.lang === lang)
            .map((module) => `modules/${module.module}/${module.dir}`));

        if (directory && directory.trim && directory.trim()) {
            directories.push(`${directory}/${lang}`);
        }

        const systemTranslationsDir = game.babele?.systemTranslationsDir;
        if (systemTranslationsDir) {
            directories.push(`systems/${game.system.id}/${systemTranslationsDir}/${lang}`);
        }

        return directories;
    }

    #getMappingDirectories() {
        const directory = game.settings.get("babele", "directory");
        const directories = this.#uniqueEntries(this.modules
            .map((module) => `modules/${module.module}/${module.dir}`));

        if (directory && directory.trim && directory.trim()) {
            directories.push(`${directory}`);
        }

        const systemTranslationsDir = game.babele?.systemTranslationsDir;
        if (systemTranslationsDir) {
            directories.push(`systems/${game.system.id}/${systemTranslationsDir}`);
        }

        return directories;
    }

    async #browseDirectories(kind, directories) {
        const uniqueDirectories = this.#uniqueEntries(directories);
        const results = await Promise.all(
            uniqueDirectories.map(async (dir) => {
                try {
                    return await foundry.applications.apps.FilePicker.browse("data", dir);
                } catch (error) {
                    console.warn(`Babele: ${error}`);
                    return {files: []};
                }
            }),
        );

        const rawSources = results.flatMap((result, index) => {
            const dir = uniqueDirectories[index];
            return (result.files ?? [])
                .filter((file) => kind === "translation" || this.#isMappingFile(file))
                .map((file) => this.#buildSourceRecord(file, dir, kind));
        });
        const uniqueSources = this.#dedupeSources(rawSources);

        return {
            sources: uniqueSources,
            diagnostics: {
                kind,
                directories: uniqueDirectories,
                browseResults: results.map((result, index) => ({
                    dir: uniqueDirectories[index],
                    files: result.files?.length ?? 0,
                })),
                rawFiles: rawSources.map((source) => source.file),
                uniqueFiles: uniqueSources.map((source) => source.file),
                duplicateFilesDiscarded: rawSources.length - uniqueSources.length,
            },
        };
    }

    #buildSourceRecord(file, directory, kind) {
        return {
            file,
            directory,
            baseName: this.#basename(file),
            kind,
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

    #fromStoredFiles(files, kind) {
        return this.#dedupeSources((files ?? []).map((file) => ({
            file,
            directory: this.#directoryName(file),
            baseName: this.#basename(file),
            kind,
        })));
    }

    #buildStoredDiagnostics(kind, sources) {
        return {
            directories: [],
            rawFiles: sources.map((source) => source.file),
            uniqueFiles: sources.map((source) => source.file),
            duplicateFilesDiscarded: 0,
            fromSettings: true,
            kind,
        };
    }

    async #buildPackDiagnostics() {
        const byBaseName = new Map();

        for (const source of await this.translationSources()) {
            const collection = source.baseName.replace(/\.json$/, "");
            const files = byBaseName.get(collection) ?? [];
            files.push(source.file);
            byBaseName.set(collection, files);
        }

        return [...byBaseName.entries()].map(([collection, files]) => ({
            collection,
            sourceCount: files.length,
            files,
        }));
    }

    #uniqueEntries(entries) {
        return [...new Set(entries)];
    }

    #isMappingFile(file) {
        return file.endsWith(`/${TranslationRegistry.MAPPING_FILENAME}`) || file.endsWith(`/${TranslationRegistry.LEGACY_MAPPING_FILENAME}`);
    }

    #basename(file) {
        return file.split("/").pop().split("\\").pop();
    }

    #directoryName(file) {
        const baseName = this.#basename(file);
        return file.slice(0, file.length - baseName.length);
    }

    static get #canIndexFiles() {
        return game.user.hasPermission("FILES_BROWSE") && game.user.isGM;
    }

}
