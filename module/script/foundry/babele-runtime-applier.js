/**
 * Applies the current Babele state to Foundry runtime collections and caches.
 */
export class BabeleRuntimeApplier {

    constructor({
        registry,
        folderTranslations,
        mappedCompendiums,
    }) {
        this.registry = registry;
        this.folderTranslations = folderTranslations;
        this.mappedCompendiums = mappedCompendiums;
    }

    /**
     * Re-apply translated runtime views to pack indexes, folders, and cached
     * compendium contents where safe.
     *
     * @param {object} [options]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.renderCompendium]
     * @param {boolean} [options.notify]
     * @returns {Promise<void>}
     */
    async apply({shareSources = false, renderCompendium = true, notify = false} = {}) {
        if (shareSources && game.user.isGM) {
            await this.registry.shareTranslationFiles();
            await this.registry.shareGlobalMappingFiles();
        }

        game.packs.forEach((pack) => {
            this.#restorePackLabel(pack);
            this.#restorePackIndex(pack);
            this.#restorePackFolders(pack);
            this.#translatePackLabel(pack);
            this.mappedCompendiums?.get?.(pack.collection)?.translateIndex(pack.index);
            this.folderTranslations.translatePackFolders(pack);
            pack.initializeTree?.();
            pack.clear?.();
        });

        this.#restoreWorldFolders();
        this.folderTranslations.translateSystemPackFolders();
        this.folderTranslations.translateImportedCompendiumFolders();

        if (renderCompendium) {
            await ui.compendium?.render?.();
        }

        if (notify) {
            ui.notifications?.info?.(
                "Babele refreshed translation sources. Closed compendium documents are updated; already open documents may need to be reopened.",
            );
        }
    }

    #restorePackIndex(pack) {
        pack?.index?.forEach?.((entry) => {
            if (entry?.originalName) {
                entry.name = entry.originalName;
            }
            if (entry?.flags?.babele) {
                delete entry.flags.babele;
            }
            delete entry.originalName;
            delete entry.translated;
            delete entry.hasTranslation;
        });
    }

    #restorePackLabel(pack) {
        if (!pack?.metadata) {
            return;
        }

        if (pack.metadata.originalLabel) {
            pack.metadata.label = pack.metadata.originalLabel;
            delete pack.metadata.originalLabel;
        }
    }

    #restorePackFolders(pack) {
        pack?.folders?.forEach?.((folder) => {
            if (folder?.originalName) {
                folder.name = folder.originalName;
            }
        });
    }

    #translatePackLabel(pack) {
        const collection = pack?.collection ?? pack?.metadata?.id ?? null;
        const translatedLabel = this.mappedCompendiums?.get?.(collection)?.metadata?.label ?? null;

        if (!translatedLabel || !pack?.metadata) {
            return;
        }

        const originalLabel = pack.metadata.originalLabel ?? pack.metadata.label;
        if (translatedLabel === originalLabel) {
            return;
        }

        pack.metadata.originalLabel = originalLabel;
        pack.metadata.label = translatedLabel;
    }

    #restoreWorldFolders() {
        const folders = game.collections.get("Folder");
        folders?.forEach?.((folder) => {
            if (folder?.originalName) {
                folder.name = folder.originalName;
            }
        });
    }
}
