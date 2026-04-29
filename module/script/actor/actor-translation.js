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
            const lookupSource = this.#lookupSource(source);
            const alreadyTranslated = this.#alreadyTranslated(item, source);
            const candidates = this.#translationCandidates(documentType, item, source, lookupSource);
            const candidate = candidates[0];

            if (!candidate) {
                const legacyMatch = this.#legacyTranslatedMatch(documentType, source);
                if (legacyMatch) {
                    return ActorTranslationEntry.alreadyTranslated({
                        documentType,
                        item,
                        source: {
                            ...source,
                            originalName: legacyMatch.originalName,
                        },
                        pack: legacyMatch.pack,
                        translatedData: legacyMatch.translatedData,
                    });
                }

                if (alreadyTranslated) {
                    return ActorTranslationEntry.alreadyTranslated({documentType, item, source});
                }

                return ActorTranslationEntry.untranslated({documentType, item, source});
            }

            return ActorTranslationEntry.translated({
                documentType,
                item,
                source,
                pack: candidate.pack,
                translatedData: candidate.translatedData,
                update: candidate.update,
                alreadyTranslated,
                changed: candidate.changed,
                candidates,
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

    #lookupSource(source) {
        const originalName = source?.flags?.babele?.originalName ?? source?.originalName;
        if (!originalName || source?.name === originalName) {
            return source;
        }

        return {
            ...source,
            name: originalName,
        };
    }

    #alreadyTranslated(item, source) {
        const hasTranslation = item?.getFlag?.("babele", "hasTranslation")
            ?? source?.flags?.babele?.hasTranslation
            ?? source?.hasTranslation;
        const translated = item?.getFlag?.("babele", "translated")
            ?? source?.flags?.babele?.translated
            ?? source?.translated;

        return hasTranslation === true || translated === true;
    }

    #updateFor(item, source, translatedData, {changed}) {
        return foundry.utils.mergeObject(translatedData, {
            _id: item.id ?? source._id,
            originalName: source.name,
            hasTranslation: true,
            translated: changed,
            flags: {
                babele: {
                    originalName: source.name,
                    hasTranslation: true,
                    translated: changed,
                },
            },
        });
    }

    #documentChanged(originalData, translatedData) {
        return JSON.stringify(originalData) !== JSON.stringify(translatedData);
    }

    #translationCandidates(documentType, item, source, lookupSource) {
        const packs = this.#translatedPacks(documentType, lookupSource)
            .filter((pack) => pack.hasTranslation?.(lookupSource, documentType) === true);

        if (packs.length === 0) {
            const fallbackPack = this.babele?.translatedPackFor?.(documentType, lookupSource);
            if (fallbackPack) {
                packs.push(fallbackPack);
            }
        }

        return packs
            .map((pack, index) => this.#candidateFor(pack, index, {item, source, lookupSource}))
            .filter(Boolean);
    }

    #candidateFor(pack, index, {item, source, lookupSource}) {
        if (typeof pack?.translate !== "function") {
            return null;
        }

        const translatedData = pack.translate(lookupSource, true);
        const translatedDocument = foundry.utils.mergeObject(source, translatedData, {inplace: false});
        const changed = this.#documentChanged(source, translatedDocument);
        const update = this.#updateFor(item, lookupSource, translatedData, {changed});

        return new ActorTranslationCandidate({
            id: this.#candidateId(pack, index),
            pack,
            translatedData,
            update,
            changed,
        });
    }

    #candidateId(pack, index) {
        return `${pack?.metadata?.id ?? pack?.metadata?.collection ?? pack?.metadata?.name ?? pack?.metadata?.label ?? "candidate"}::${index}`;
    }

    #legacyTranslatedMatch(documentType, source) {
        if (!source?.name) {
            return null;
        }

        for (const pack of this.#translatedPacks(documentType, source)) {
            for (const [key, translation] of Object.entries(pack.translations ?? {})) {
                if (translation?.name !== source.name) {
                    continue;
                }

                return {
                    pack,
                    translatedData: translation,
                    originalName: key === source._id ? source.name : key,
                };
            }
        }

        return null;
    }

    #translatedPacks(documentType, source) {
        const registry = this.babele?.mappedCompendiums;
        const packs = registry?.values?.()
            ? [...registry.values()]
            : Array.isArray(registry) ? [...registry] : Object.values(registry ?? {});
        return packs.filter((pack) => {
            if (pack?.translated !== true) {
                return false;
            }

            if (documentType && pack.metadata?.type && pack.metadata.type !== documentType) {
                return false;
            }

            return !(pack.types && !pack.types.includes(source.type));
        });
    }
}

/**
 * One possible translated payload for an embedded Actor item.
 */
export class ActorTranslationCandidate {
    constructor({id, pack, translatedData, update, changed = false}) {
        this.id = id;
        this.pack = pack;
        this.translatedData = translatedData;
        this.update = update;
        this.changed = changed;
    }

    proposedName(fallback = "") {
        return this.update?.name ?? this.translatedData?.name ?? fallback;
    }

    packLabel() {
        return this.pack?.metadata?.label
            ?? this.pack?.metadata?.name
            ?? this.pack?.metadata?.collection
            ?? "";
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
     * @returns {{total: number, ready: number, translated: number, untranslated: number}}
     */
    summary() {
        const ready = this.translatedEntries().length;
        const translated = this.entries.filter((entry) => entry.hasTranslation() && !entry.applicable()).length;
        return {
            total: this.entries.length,
            ready,
            translated,
            untranslated: this.entries.length - ready - translated,
        };
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    translatedEntries() {
        return this.entries.filter((entry) => entry.applicable());
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    untranslatedEntries() {
        return this.entries.filter((entry) => !entry.hasTranslation());
    }

    /**
     * @param {Array<ActorTranslationEntry>} [entries]
     * @returns {Array<object>}
     */
    updates(entries = this.translatedEntries()) {
        return entries
            .filter((entry) => entry.applicable())
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
    static translated({
        documentType,
        item,
        source,
        pack,
        translatedData,
        update,
        alreadyTranslated = false,
        changed = true,
        candidates = [],
    }) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            pack,
            translatedData,
            update,
            translated: true,
            alreadyTranslated,
            changed,
            candidates,
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

    static alreadyTranslated({documentType, item, source, pack = null, translatedData = null}) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            pack,
            translatedData,
            translated: false,
            alreadyTranslated: true,
        });
    }

    constructor({
        documentType,
        item,
        source,
        pack = null,
        translatedData = null,
        update = null,
        translated = false,
        alreadyTranslated = false,
        changed = false,
        candidates = [],
    }) {
        this.documentType = documentType;
        this.item = item;
        this.source = source;
        this.pack = pack;
        this.translatedData = translatedData;
        this.#fallbackUpdate = update;
        this.translated = translated;
        this.alreadyTranslated = alreadyTranslated;
        this.#fallbackChanged = changed;
        this.candidates = candidates;
        this.selectedCandidateId = candidates[0]?.id ?? null;
    }

    #fallbackUpdate
    #fallbackChanged

    get update() {
        return this.selectedCandidate()?.update ?? this.#fallbackUpdate;
    }

    get changed() {
        return this.selectedCandidate()?.changed ?? this.#fallbackChanged;
    }

    /**
     * @returns {string}
     */
    name() {
        return this.source?.flags?.babele?.originalName
            ?? this.source?.originalName
            ?? this.source?.name
            ?? this.item?.name
            ?? "";
    }

    /**
     * @returns {string}
     */
    id() {
        return String(this.item?.id ?? this.source?._id ?? this.name());
    }

    /**
     * @returns {string}
     */
    proposedName() {
        return this.selectedCandidate()?.proposedName(this.name())
            ?? this.update?.name
            ?? this.translatedData?.name
            ?? this.name();
    }

    /**
     * @returns {string}
     */
    currentName() {
        return this.source?.name
            ?? this.item?.name
            ?? "";
    }

    /**
     * @returns {string}
     */
    type() {
        return this.source?.type ?? this.item?.type ?? "";
    }

    /**
     * @returns {string}
     */
    packLabel() {
        return this.selectedCandidate()?.packLabel()
            ?? this.pack?.metadata?.label
            ?? this.pack?.metadata?.name
            ?? this.pack?.metadata?.collection
            ?? "";
    }

    /**
     * @returns {boolean}
     */
    hasTranslation() {
        return this.translated || this.alreadyTranslated;
    }

    /**
     * @returns {boolean}
     */
    applicable() {
        return this.translated && !this.alreadyTranslated && this.changed && !!this.update;
    }

    selectedCandidate() {
        return this.candidates.find((candidate) => candidate.id === this.selectedCandidateId) ?? null;
    }

    selectCandidate(candidateId) {
        if (!this.candidates.some((candidate) => candidate.id === candidateId)) {
            return false;
        }

        this.selectedCandidateId = candidateId;
        return true;
    }
}
