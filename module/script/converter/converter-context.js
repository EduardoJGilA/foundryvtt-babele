/**
 * Build the canonical converter context passed to OO converters.
 *
 * This helper centralizes the shape expected by built-in and custom
 * converters so callers do not have to reassemble the same payload in
 * multiple places.
 *
 * @param {object} options
 * @param {*} options.value
 * @param {*} [options.translation]
 * @param {object} options.source
 * @param {string} options.field
 * @param {string} options.path
 * @param {*} [options.params]
 * @param {object} [options.allTranslations]
 * @param {*} [options.contextCompendium]
 * @param {object} [options.runtime]
 * @returns {object}
 */
export function converterContext({
    value,
    translation = undefined,
    source,
    field,
    path,
    params = undefined,
    allTranslations = {},
    contextCompendium = null,
    runtime = {},
}) {
    return {
        value,
        translation,
        source,
        field,
        path,
        params,
        allTranslations,
        contextCompendium,
        runtime,
    };
}
