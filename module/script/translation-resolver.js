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
 * @property {(data: Object, context?: Object) => (string|null|undefined)} [keyFor]
 * @property {(data: Object, key: string, translation: Object, context?: Object) => boolean} [matches]
 */

/**
 * @typedef {Object} TranslationResolverContext
 * @property {string|null} [documentType]
 * @property {Object} [pack]
 * @property {Object} [metadata]
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
     * @param {TranslationResolverContext} [context]
     * @returns {{key: string, strategy: string}[]}
     */
    candidatesFor(data, context = {}) {
        const candidates = [];

        for (const strategy of this.strategies) {
            if (typeof strategy.keyFor !== "function") {
                continue;
            }

            const key = strategy.keyFor(data, context);

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
     * @param {TranslationResolverContext} [context]
     * @returns {string[]}
     */
    keysFor(data, context = {}) {
        return this.candidatesFor(data, context).map((candidate) => candidate.key);
    }

    /**
     * Resolve the effective translation entry for a document.
     *
     * @param {Object} data
     * @param {TranslationResolverContext} [context]
     * @returns {TranslationResolution}
     */
    resolutionFor(data, context = {}) {
        const candidates = this.candidatesFor(data, context);
        const keys = candidates.map((candidate) => candidate.key);

        for (const strategy of this.strategies) {
            const resolution = this.#resolutionFromStrategy(strategy, data, context, keys);

            if (!resolution) {
                continue;
            }

            return resolution;
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
     * @param {TranslationResolverContext} [context]
     * @returns {Object|null}
     */
    translationFor(data, context = {}) {
        return this.resolutionFor(data, context).translation;
    }

    /**
     * Determine whether a document has a matching translation entry.
     *
     * @param {Object} data
     * @param {TranslationResolverContext} [context]
     * @returns {boolean}
     */
    hasTranslationFor(data, context = {}) {
        return this.resolutionFor(data, context).matched;
    }

    /**
     * Return the same resolution payload for diagnostics-oriented call sites.
     *
     * @param {Object} data
     * @param {Object} [context]
     * @returns {TranslationResolution}
     */
    diagnosticsFor(data, context = {}) {
        return this.resolutionFor(data, context);
    }

    #resolutionFromStrategy(strategy, data, context, keys) {
        if (typeof strategy.matches === "function") {
            const matched = this.#resolutionFromMatches(strategy, data, context, keys);

            if (matched) {
                return matched;
            }
        }

        if (typeof strategy.keyFor !== "function") {
            return null;
        }

        const key = strategy.keyFor(data, context);
        const translation = key ? this.translations[key] : null;

        if (!key || !translation) {
            return null;
        }

        return {
            matched: true,
            key,
            translation,
            strategy: strategy.name,
            candidates: keys,
        };
    }

    #resolutionFromMatches(strategy, data, context, keys) {
        for (const [key, translation] of Object.entries(this.translations)) {
            if (!strategy.matches(data, key, translation, context)) {
                continue;
            }

            return {
                matched: true,
                key,
                translation,
                strategy: strategy.name,
                candidates: keys.includes(key) ? keys : [...keys, key],
            };
        }

        return null;
    }
}
