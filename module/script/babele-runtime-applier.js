/**
 * Applies the current Babele state to Foundry runtime collections and caches.
 */
export class BabeleRuntimeApplier {

    /**
     * @param {import("./babele.js").default} babele
     */
    constructor(babele) {
        this.babele = babele;
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
            await this.babele.shareTranslationFiles();
            await this.babele.shareGlobalMappingFiles();
        }

        game.packs.forEach((pack) => {
            this.#restorePackIndex(pack);
            this.#restorePackFolders(pack);
            this.babele.translateIndex(pack.index, pack.collection);
            this.babele.translatePackFolders(pack);
            pack.initializeTree?.();
            pack.clear?.();
        });

        this.#restoreWorldFolders();
        this.babele.translateSystemPackFolders();
        this.babele.translateImportedCompendiumFolders();

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

    #restorePackFolders(pack) {
        pack?.folders?.forEach?.((folder) => {
            if (folder?.originalName) {
                folder.name = folder.originalName;
            }
        });
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
