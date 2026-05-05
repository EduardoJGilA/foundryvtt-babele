/**
 * Builds and applies on-demand Actor translation proposals.
 */
export class ActorTranslation {

    constructor({
        sourceDataForUuid,
        translatedPackFor,
        translatedPacks,
    } = {}) {
        const babele = arguments[0];
        this.sourceDataForUuid = sourceDataForUuid ?? ((uuid, options = {}) => babele?.sourceDataForUuid?.(uuid, options));
        this.translatedPackFor = translatedPackFor ?? ((documentType, data, options = {}) => babele?.translatedPackFor?.(documentType, data, options));
        this.translatedPacks = translatedPacks ?? (() => {
            const registry = babele?.mappedCompendiums;
            return registry?.values?.()
                ? [...registry.values()]
                : Array.isArray(registry) ? [...registry] : Object.values(registry ?? {});
        });
    }

    /**
     * Build a translation proposal for one Actor's embedded Items without
     * writing anything to the Actor.
     *
     * @param {Actor|object} actor
     * @param {object} [options]
     * @param {string} [options.documentType="Item"]
     * @returns {Promise<ActorTranslationProposal>}
     */
    async proposal(actor, options = {}) {
        const documentType = options.documentType ?? "Item";
        const entries = await Promise.all([...actor.items?.contents ?? []].map(async (item) => {
            const source = item.toObject();
            const alreadyTranslated = this.#alreadyTranslated(item, source);
            const sourceDocument = alreadyTranslated ? null : await this.#sourceDocumentData(source);
            const lookupSource = this.#lookupSource(source, sourceDocument);
            const candidates = this.#translationCandidates(documentType, item, source, lookupSource, sourceDocument);
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
        }));

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

    #lookupSource(source, sourceDocument = null) {
        const originalName = source?.flags?.babele?.originalName
            ?? source?.originalName
            ?? sourceDocument?.name;

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

    #updateFor(item, source, translatedData, {changed, originalPayload = null}) {
        const babeleFlags = {
            originalName: source.name,
            hasTranslation: true,
            translated: changed,
        };
        if (originalPayload) {
            babeleFlags.originalPayload = originalPayload;
        }

        return foundry.utils.mergeObject(translatedData, {
            _id: item.id ?? source._id,
            originalName: source.name,
            hasTranslation: true,
            translated: changed,
            flags: {
                babele: babeleFlags,
            },
        });
    }

    #documentChanged(sourcePayload, translatedData) {
        return JSON.stringify(sourcePayload) !== JSON.stringify(translatedData);
    }

    #userChanged(source, sourceDocument, pack = null) {
        if (!sourceDocument) {
            return false;
        }

        const current = this.#currentPayload(pack, source);
        const original = this.#sourcePayload(pack, sourceDocument);
        if (!current || !original) {
            return false;
        }

        return this.#sharedPayloadChanged(current, original);
    }

    async #sourceDocumentData(source) {
        const uuid = source?.flags?.core?.sourceId ?? source?._stats?.compendiumSource;
        if (!uuid) {
            return null;
        }

        const sourceData = await this.sourceDataForUuid?.(uuid, {data: source});
        return sourceData ? this.#sourceLikeData(sourceData) : null;
    }

    #sourceLikeData(data) {
        const originalName = data?.flags?.babele?.originalName ?? data?.originalName;
        if (!originalName || data?.name === originalName) {
            return data;
        }

        return {
            ...data,
            name: originalName,
        };
    }

    #currentPayload(pack, data) {
        try {
            const extracted = pack?.extract?.(data);
            return typeof extracted === "undefined" ? null : extracted;
        } catch (_error) {
            return null;
        }
    }

    #sourcePayload(pack, data) {
        try {
            const originalPayload = data?.flags?.babele?.originalPayload;
            if (originalPayload) {
                return originalPayload;
            }

            const extracted = pack?.extract?.(data);
            return typeof extracted === "undefined" ? null : extracted;
        } catch (_error) {
            return null;
        }
    }

    #sharedPayloadChanged(current, original) {
        if (this.#isPlainObject(current) && this.#isPlainObject(original)) {
            for (const [key, value] of Object.entries(current)) {
                if (!Object.prototype.hasOwnProperty.call(original, key)) {
                    continue;
                }

                if (this.#sharedPayloadChanged(value, original[key])) {
                    return true;
                }
            }

            return false;
        }

        if (Array.isArray(current) && Array.isArray(original)) {
            const length = Math.min(current.length, original.length);
            for (let index = 0; index < length; index += 1) {
                if (
                    !Object.prototype.hasOwnProperty.call(current, index)
                    || !Object.prototype.hasOwnProperty.call(original, index)
                ) {
                    continue;
                }

                if (this.#sharedPayloadChanged(current[index], original[index])) {
                    return true;
                }
            }

            return false;
        }

        return JSON.stringify(current) !== JSON.stringify(original);
    }

    #isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    #translationCandidates(documentType, item, source, lookupSource, sourceDocument) {
        const packs = this.#translatedPacks(documentType, lookupSource)
            .filter((pack) => pack.hasTranslation?.(lookupSource, documentType) === true);

        if (packs.length === 0) {
            const fallbackPack = this.translatedPackFor?.(documentType, lookupSource);
            if (fallbackPack) {
                packs.push(fallbackPack);
            }
        }

        return packs
            .map((pack, index) => this.#candidateFor(pack, index, {item, source, lookupSource, sourceDocument}))
            .filter(Boolean);
    }

    #candidateFor(pack, index, {item, source, lookupSource, sourceDocument}) {
        if (typeof pack?.translate !== "function") {
            return null;
        }

        const translatedData = pack.translate(lookupSource, true);
        const translatedDocument = foundry.utils.mergeObject(source, translatedData, {inplace: false});
        const changed = this.#documentChanged(source, translatedDocument);
        const originalPayload = this.#originalPayload(pack, sourceDocument ?? lookupSource);
        const update = this.#updateFor(item, lookupSource, translatedData, {changed, originalPayload});
        const userChanged = changed && this.#userChanged(source, sourceDocument, pack);

        return new ActorTranslationCandidate({
            id: this.#candidateId(pack, index),
            pack,
            translatedData,
            update,
            changed,
            userChanged,
        });
    }

    #originalPayload(pack, data) {
        if (!data) {
            return null;
        }

        const originalPayload = data?.flags?.babele?.originalPayload;
        if (originalPayload) {
            return originalPayload;
        }

        try {
            return pack?.sourcePayload?.(data)
                ?? pack?.extract?.(data)
                ?? null;
        } catch (_error) {
            return null;
        }
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
        return (this.translatedPacks?.() ?? []).filter((pack) => {
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
    constructor({id, pack, translatedData, update, changed = false, userChanged = false}) {
        this.id = id;
        this.pack = pack;
        this.translatedData = translatedData;
        this.update = update;
        this.changed = changed;
        this.userChanged = userChanged;
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
     * @returns {{total: number, ready: number, modified: number, translated: number, untranslated: number}}
     */
    summary() {
        const modified = this.entries.filter((entry) => entry.applicable() && entry.userChanged).length;
        const ready = this.translatedEntries().length - modified;
        const translated = this.entries.filter((entry) => entry.hasTranslation() && !entry.applicable()).length;
        return {
            total: this.entries.length,
            ready,
            modified,
            translated,
            untranslated: this.entries.length - ready - modified - translated,
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
        userChanged = false,
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
            userChanged,
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
        userChanged = false,
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
        this.#fallbackUserChanged = userChanged;
        this.candidates = candidates;
        this.selectedCandidateId = candidates[0]?.id ?? null;
    }

    #fallbackUpdate
    #fallbackChanged
    #fallbackUserChanged

    get update() {
        return this.selectedCandidate()?.update ?? this.#fallbackUpdate;
    }

    get changed() {
        return this.selectedCandidate()?.changed ?? this.#fallbackChanged;
    }

    get userChanged() {
        return this.selectedCandidate()?.userChanged ?? this.#fallbackUserChanged;
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
