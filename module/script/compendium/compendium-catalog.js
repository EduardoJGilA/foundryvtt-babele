/**
 * Catalog of Foundry compendiums managed by Babele.
 *
 * This object only describes the Foundry compendium side of the model:
 * - which metadata records are supported by Babele
 * - how a Foundry metadata record maps to a collection id
 */
export class CompendiumCatalog {

    #documentMappings;

    constructor({
        documentMappings,
    } = {}) {
        this.#documentMappings = documentMappings;
    }

    supported(metadata) {
        return this.#documentMappings?.supports?.(metadata?.type) ?? false;
    }

    collectionOf(metadata) {
        const collectionPrefix = metadata.packageType === "world" ? "world" : metadata.packageName;
        return `${collectionPrefix}.${metadata.name}`;
    }

    supportedPacks(packs = game.data.packs ?? []) {
        return [...packs].filter((metadata) => this.supported(metadata));
    }
}
