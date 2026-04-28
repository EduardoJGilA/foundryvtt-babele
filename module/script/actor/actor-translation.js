/**
 * Builds and applies on-demand Actor translation proposals.
 */
export class ActorTranslation {

    constructor(babele) {
        this.babele = babele;
    }

    /**
     * Build a translation proposal for one Actor's embedded Items without
     * writing anything to the Actor.
     *
     * @param {Actor|object} actor
     * @param {object} [options]
     * @param {string} [options.documentType="Item"]
     * @returns {ActorTranslationProposal}
     */
    proposal(actor, options = {}) {
        const documentType = options.documentType ?? "Item";
        const entries = [...actor.items?.contents ?? []].map((item) => {
            const source = item.toObject();
            const pack = this.babele.translatedPackFor(documentType, source);

            if (!pack) {
                return ActorTranslationEntry.untranslated({documentType, item, source});
            }

            const translatedData = pack.translate(source, true);
            const update = foundry.utils.mergeObject(translatedData, {
                _id: item.id ?? source._id,
            });

            return ActorTranslationEntry.translated({
                documentType,
                item,
                source,
                pack,
                translatedData,
                update,
            });
        });

        return new ActorTranslationProposal(actor, {documentType, entries});
    }

    /**
     * Apply a previously computed Actor translation proposal.
     *
     * @param {ActorTranslationProposal} proposal
     * @param {object} [options]
     * @returns {Promise<Array<object>>}
     */
    async apply(proposal, options = {}) {
        return proposal.apply(options);
    }
}

/**
 * A computed set of Actor embedded-document translation changes.
 */
export class ActorTranslationProposal {
    constructor(actor, {documentType = "Item", entries = []} = {}) {
        this.actor = actor;
        this.documentType = documentType;
        this.entries = entries;
    }

    /**
     * @returns {{total: number, translated: number, untranslated: number}}
     */
    summary() {
        const translated = this.translatedEntries().length;
        return {
            total: this.entries.length,
            translated,
            untranslated: this.entries.length - translated,
        };
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    translatedEntries() {
        return this.entries.filter((entry) => entry.translated);
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    untranslatedEntries() {
        return this.entries.filter((entry) => !entry.translated);
    }

    /**
     * @param {Array<ActorTranslationEntry>} [entries]
     * @returns {Array<object>}
     */
    updates(entries = this.translatedEntries()) {
        return entries
            .filter((entry) => entry.translated && entry.update)
            .map((entry) => entry.update);
    }

    /**
     * @param {object} [options]
     * @param {Array<ActorTranslationEntry>} [options.entries]
     * @returns {Promise<Array<object>>}
     */
    async apply({entries = this.translatedEntries()} = {}) {
        const updates = this.updates(entries);
        if (updates.length === 0) {
            return [];
        }

        await this.actor.updateEmbeddedDocuments(this.documentType, updates);
        return updates;
    }
}

/**
 * One embedded-document translation candidate.
 */
export class ActorTranslationEntry {
    static translated({documentType, item, source, pack, translatedData, update}) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            pack,
            translatedData,
            update,
            translated: true,
        });
    }

    static untranslated({documentType, item, source}) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            translated: false,
        });
    }

    constructor({documentType, item, source, pack = null, translatedData = null, update = null, translated = false}) {
        this.documentType = documentType;
        this.item = item;
        this.source = source;
        this.pack = pack;
        this.translatedData = translatedData;
        this.update = update;
        this.translated = translated;
    }

    /**
     * @returns {string}
     */
    name() {
        return this.source?.name ?? this.item?.name ?? "";
    }
}
