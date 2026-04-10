/**
 * @typedef {Object} TranslationResolution
 * @property {boolean} matched
 * @property {string|null} key
 * @property {Object|null} translation
 * @property {string|null} strategy
 * @property {string[]} candidates
 */

/**
 * @typedef {Object} TranslationStrategy
 * @property {string} name
 * @property {(data: Object) => (string|null|undefined)} keyFor
 */

/**
 * Resolves the effective translation entry for a document using Babele's current
 * key precedence rules. The resolver is intentionally local to a single translation
 * entry map and does not know about reference packs or source discovery.
 *
 * The resolver is only intended for compendium Documents, including embedded
 * Documents that are translated as document-like units by converters. It must
 * not be used as a generic lookup helper for arbitrary nested JSON data.
 */
export class TranslationResolver {

    /**
     * @param {Object<string, Object>} translations
     * @param {TranslationStrategy[]} [strategies]
     */
    constructor(translations = {}, strategies = TranslationResolver.defaultStrategies()) {
        this.translations = translations ?? {};
        this.strategies = strategies;
    }

    /**
     * Return the default deterministic translation strategies used by Babele.
     *
     * @returns {TranslationStrategy[]}
     */
    static defaultStrategies() {
        return [
            {
                name: "_id",
                keyFor: (data) => data?._id,
            },
            {
                name: "name",
                keyFor: (data) => data?.name,
            },
            {
                name: "sourceId",
                keyFor: (data) => foundry.utils.parseUuid(data?.flags?.core?.sourceId || data?._stats?.compendiumSource)?.id,
            },
        ];
    }

    /**
     * Return candidate keys with the winning strategy associated with each key.
     *
     * @param {Object} data
     * @returns {{key: string, strategy: string}[]}
     */
    candidatesFor(data) {
        const candidates = [];

        for (const strategy of this.strategies) {
            const key = strategy.keyFor(data);

            if (!key || candidates.some((candidate) => candidate.key === key)) {
                continue;
            }

            candidates.push({
                key,
                strategy: strategy.name,
            });
        }

        return candidates;
    }

    /**
     * Return candidate keys in deterministic precedence order.
     *
     * @param {Object} data
     * @returns {string[]}
     */
    keysFor(data) {
        return this.candidatesFor(data).map((candidate) => candidate.key);
    }

    /**
     * Resolve the effective translation entry for a document.
     *
     * @param {Object} data
     * @returns {TranslationResolution}
     */
    resolutionFor(data) {
        const candidates = this.candidatesFor(data);
        const keys = candidates.map((candidate) => candidate.key);

        for (const candidate of candidates) {
            const key = candidate.key;
            const translation = this.translations[key];

            if (translation) {
                return {
                    matched: true,
                    key,
                    translation,
                    strategy: candidate.strategy,
                    candidates: keys,
                };
            }
        }

        return {
            matched: false,
            key: null,
            translation: null,
            strategy: null,
            candidates: keys,
        };
    }

    /**
     * Return the translation entry for a document or null when no match exists.
     *
     * @param {Object} data
     * @returns {Object|null}
     */
    translationFor(data) {
        return this.resolutionFor(data).translation;
    }

    /**
     * Determine whether a document has a matching translation entry.
     *
     * @param {Object} data
     * @returns {boolean}
     */
    hasTranslationFor(data) {
        return this.resolutionFor(data).matched;
    }

    /**
     * Return the same resolution payload for diagnostics-oriented call sites.
     *
     * @param {Object} data
     * @returns {TranslationResolution}
     */
    diagnosticsFor(data) {
        return this.resolutionFor(data);
    }
}
