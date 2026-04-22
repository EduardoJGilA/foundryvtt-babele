/**
 * Catalog of Foundry compendiums managed by Babele.
 *
 * This object only describes the Foundry compendium side of the model:
 * - which metadata records are supported by Babele
 * - how a Foundry metadata record maps to a collection id
 */
export class CompendiumCatalog {

    #supportedTypes;

    static get SUPPORTED_TYPES() {
        return ["Adventure", "Actor", "Cards", "Folder", "Item", "JournalEntry", "Macro", "Playlist", "RollTable", "Scene"];
    }

    constructor({
        supportedTypes = CompendiumCatalog.SUPPORTED_TYPES,
    } = {}) {
        this.#supportedTypes = [...supportedTypes];
    }

    supported(metadata) {
        return this.#supportedTypes.includes(metadata?.type);
    }

    collectionOf(metadata) {
        const collectionPrefix = metadata.packageType === "world" ? "world" : metadata.packageName;
        return `${collectionPrefix}.${metadata.name}`;
    }

    supportedPacks(packs = game.data.packs ?? []) {
        return [...packs].filter((metadata) => this.supported(metadata));
    }
}
