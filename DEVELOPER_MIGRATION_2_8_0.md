# Developer Migration Notes for 2.8.0

This document summarizes the architectural and API changes introduced during
the 2.8.0 refactor cycle.

It is intended for:

- module developers integrating with `game.babele`
- authors of custom converters
- advanced users importing Babele internals from `module/script/*`

This is not end-user documentation. For usage documentation, refer to
`doc.md`.

## Scope

The 2.8.0 cycle did more than add features. It also clarified the internal
model around:

- document mappings
- translation entry matching
- nested translation runtime scope
- embedded document translation
- translation source discovery and precedence
- export flows
- Foundry v13/v14 UI integration

The practical consequence is that some historical concepts are no longer the
canonical way to think about Babele internals.

## Important Boundary

`game.babele` is the supported facade.

Anything imported directly from `module/script/*` should be considered an
advanced integration point. Internal classes are much cleaner and more coherent
than before, but they are still internal implementation details unless they are
explicitly exposed by the facade.

If your integration can be written against `game.babele`, prefer that.

## High-Level Design Changes

The main conceptual shifts are:

- Babele now reasons primarily in terms of `DocumentMapping`, not
  "compendium mapping"
- translation matching is owned by `TranslationEntries`
- mapping layers are owned by `DocumentMappings`
- nested translation visibility is owned by `CompendiumRuntime`
- document-valued fields are handled by the built-in OO `DocumentConverter`
- function-based converters are still supported, but they are normalized to the
  internal converter contract through `FunctionalConverter`

This means the old mental model of "a translated pack plus a few special-case
converters" is no longer accurate.

## Canonical Names and Imports

The canonical internal classes are now:

- `module/script/compendium/mapped-compendium.js`
- `module/script/mapping/document-mapping.js`
- `module/script/mapping/document-mappings.js`
- `module/script/translation/translation-entries.js`
- `module/script/compendium/compendium-runtime.js`
- `module/script/converter/document-converter.js`
- `module/script/converter/functional-converter.js`

Notably:

- `MappedCompendium` is the canonical compendium model
- `DocumentMapping` is the canonical single-document-type mapping model
- `DocumentMappings` is the aggregate of effective mapping layers
- `TranslationEntries` is the canonical translation-entry matching object

Older names such as `TranslatedCompendium` and `CompendiumMapping` should now be
treated as historical terminology, not as the current design center.

## `game.babele` Facade Changes

### Mapped vs translated compendiums

`game.babele` now exposes two distinct retrieval semantics:

```js
const mapped = game.babele.mappedCompendiumFor("dnd5e.items");
const translated = game.babele.translatedCompendiumFor("dnd5e.items");
```

Behavior:

- `mappedCompendiumFor(pack)` returns the managed compendium when the pack type
  is supported by Babele, even if no translation file exists
- `translatedCompendiumFor(pack)` returns a compendium only when it has an
  associated translation payload

Use:

- `mappedCompendiumFor(pack)` for extraction, mapping, field translation,
  diagnostics, or advanced inspection
- `translatedCompendiumFor(pack)` only when you explicitly require loaded
  translations

### Existing facade methods remain available

These methods still exist and delegate to the new internal model:

- `translateIndex(index, pack)`
- `isTranslated(pack)`
- `translate(pack, data, translationsOnly)`
- `translateField(field, pack, data)`
- `extract(pack, data, options)`
- `extractField(pack, field, data)`
- `translatedPackFor(documentType, data, options)`
- `mappedCompendiumFor(pack)`
- `translatedCompendiumFor(pack)`

### Registrations should happen before `init()`

This is an important behavioral rule now documented more explicitly in the
codebase.

The following registration APIs are intended to be used before `init()`:

- `registerConverter()`
- `registerConverters()`
- `registerTranslationMatchStrategy()`
- `registerTranslationMatchStrategies()`
- `registerIdentityExtractor()`
- `registerIdentityExtractors()`
- `registerMapping()`
- `register()`
- `setSystemTranslationsDir()`

If these are called after initialization, they do not mutate the already-built
runtime state in place. They affect the next full rebuild instead.

This is deliberate: Babele now prefers rebuilding coherent state over mutating
live state ad hoc.

## Mapping Model Changes

### `DocumentMapping` is the canonical unit

The old mental model was often "a compendium mapping."

The current model is:

- a `DocumentMapping` describes how one `Document` type is translated and
  exported
- a `MappedCompendium` uses the appropriate `DocumentMapping` to translate the
  documents it contains

Example:

```js
const hierarchy = game.babele.documentMappings.hierarchyFor("Item");
const mapping = hierarchy.mappingFor({type: "weapon"});
```

### `entityType` became `documentType`

This is a naming correction throughout the design.

When adapting old code, rename mental models and variable names accordingly:

- `entityType` -> `documentType`

### `DocumentMappings` owns mapping layers

`DocumentMappings` is now the aggregate responsible for effective mapping
precedence.

Its layer order is:

1. built-in default mappings
2. mappings registered through the public API
3. mappings loaded from discovered mapping files

Implications:

- mapping precedence no longer needs to be reimplemented outside the aggregate
- `Babel.DEFAULT_MAPPINGS` should be considered a compatibility view only
- advanced code should prefer the live aggregate owned by `game.babele`

### Subtype mappings are modeled as hierarchy

Subtype-specific mappings such as `Item.weapon` are now better understood as a
hierarchy-like refinement of the base document mapping.

Use:

```js
const mapping = game.babele.documentMappings
  .hierarchyFor("Item")
  .mappingFor({type: "weapon"});
```

This replaces older, flatter mental models where subtype handling looked like a
special case layered on top of generic mapping lookup.

## Translation Matching Changes

### `TranslationEntries` owns matching

Translation entry normalization and matching are now owned by
`TranslationEntries`.

That object is responsible for:

- normalizing compatible/object payloads
- normalizing legacy array payloads
- generating candidate keys
- applying custom strategies
- applying the built-in `_id` / `name` / `sourceId` fallback order

This is a major design change.

Matching logic should no longer be spread across compendium classes, converters,
or ad hoc utilities.

### Custom match strategies are now first-class

Developers can register custom translation match strategies through the facade:

```js
game.babele.registerTranslationMatchStrategy({
  name: "my-strategy",
  keyFor(data, context) {
    return null;
  },
  matches(data, key, entry, context) {
    return false;
  },
});
```

Important notes:

- custom strategies run before Babele’s internal defaults
- the default strategies are now an internal detail of `TranslationEntries`
- callers should register only their custom logic, not re-register the built-in
  fallback order

### Identity extractors and matching are related, but distinct

`DocumentMapping` can provide identity candidates for export and matching.

`TranslationEntries` consumes those candidates when present.

At the same time, custom identity extractors can be registered through:

```js
game.babele.registerIdentityExtractor("range", (document) => {
  const [start, end] = document?.range ?? [];
  return Number.isInteger(start) && Number.isInteger(end) ? `${start}-${end}` : null;
});
```

Use identity extractors when you need reusable key extraction logic.
Use translation match strategies when you need custom matching behavior across
entries.

## Converter Contract Changes

This is the most important migration area for module developers.

### Function-based converters are still supported

Babele still supports a plain function as a converter:

```js
game.babele.registerConverter("myConverter", function (
  value,
  translation,
  data,
  tc,
  allTranslations,
  runtime,
  params,
) {
  return value;
});
```

This is no longer described as a purely legacy escape hatch. It is still a
valid first-class extension pattern for simple cases.

Internally, Babele wraps these through `FunctionalConverter`.

### `runtime` is the authoritative execution context

Historically, many converters treated `tc` as the active compendium context.

This is no longer a safe assumption.

You should now assume:

- `tc` exists for compatibility
- `runtime.currentCompendium()` is the source of truth

Recommended pattern:

```js
game.babele.registerConverter("myConverter", function (
  value,
  translation,
  data,
  tc,
  allTranslations,
  runtime = {},
) {
  const current = runtime.currentCompendium?.() ?? tc ?? null;
  return current ? current.translateField("name", data, runtime) : value;
});
```

### `params` is the field declaration payload

Function-based converters now receive `params` as their last argument.

This is the field-level configuration object from the mapping declaration. It
lets a converter read its own configuration without relying on ad hoc external
state.

### Extraction hooks now receive structured context

If a function-based converter defines `extract`, it now receives:

```js
converter.extract = function (value, data, tc, context = {}) {
  const runtime = context.runtime ?? {};
  const params = context.params ?? {};
  return value;
};
```

The `context` object includes:

- `field`
- `path`
- `params`
- `mapping`
- `runtime`

`mapping` currently mirrors `params` for compatibility and convenience.

### Built-in OO converters are now the reference model

The internal converter model is object-oriented. The built-in first-class
converters include:

- `document`
- `structured`
- `lookup`
- `tokenizedLookup`

The most important one for migration purposes is `DocumentConverter`.

## `DocumentConverter` and Embedded Documents

### Document-valued fields now have a canonical built-in converter

The built-in `document` converter is now the canonical mechanism for translating
embedded document collections and nested document payloads.

Typical mapping shape:

```js
"items": {
  "path": "items",
  "converter": "document",
  "documentType": "Item",
  "cardinality": "many"
}
```

### What `DocumentConverter` now owns

`DocumentConverter` is responsible for:

- resolving the effective embedded mapping
- preparing an `EmbeddedCompendium` for the field
- publishing that embedded context to the runtime when configured
- translating embedded documents through the runtime-aware current context
- falling back to other visible translated packs of the same document type

### `expose` is optional and conservative

The `document` converter supports:

- `documentType`
- `cardinality`
- `mapping`
- `expose`

The default for `expose` is conservative. It should only be enabled where the
embedded collection must become visible to sibling lookup flows, such as
Adventure-local document scopes.

### Inline mapping merges with the canonical mapping

When a document field defines inline mapping data, that mapping is treated as an
override/enrichment of the canonical mapping model, not as a wholesale
replacement of the document type.

This matters when migrating custom `fromPack`-style logic toward the modern
`document` converter.

## Runtime Model Changes

### `CompendiumRuntime` is now the core scope object

Nested translation is no longer modeled through loosely passed contextual state.

The explicit scope object is:

```js
const runtime = new CompendiumRuntime({
  globalPacks,
  localPacks,
  currentCompendium,
});
```

Important methods:

- `currentCompendium()`
- `mappedCompendiumFor(collection)`
- `localMappedCompendiumFor(documentType)`
- `translatedPackFor(documentType, data)`
- `child({localPacks, currentCompendium})`

### Scope precedence is stack-like

When nested flows publish local packs, the innermost scope wins.

This affects:

- document-type local lookups
- translated-pack fallback lookups
- Adventure-local document visibility
- nested embedded document translation branches

If your integration previously searched a global registry manually, migrate that
logic to `CompendiumRuntime`.

## Translation Source Discovery

### `TranslationRegistry` owns source discovery and precedence

`TranslationRegistry` is now the authoritative object for translation-source
discovery.

It is responsible for:

- registered module sources
- system translation directory
- configured directory source
- published fallback source for non-GM clients
- source precedence
- discovery deduplication
- canonical `mappings.json` preference over deprecated `mapping.json`

This means external tooling should not duplicate Babele’s discovery logic unless
strictly necessary.

### Source precedence is explicit

Effective source precedence is now source-driven:

1. system translations
2. module translations
3. configured directory translations
4. published fallback only when direct filesystem discovery is not available

Later sources override earlier ones.

## Export Changes Relevant to Developers

### Export flows are now dedicated objects

Export logic is no longer an undifferentiated blob on the facade.

The main flows are:

- single compendium export through `TranslationExport`
- synthetic `_packs-folders` export through `PackFoldersExport`
- bulk directory export through `DirectoryExport`

From the facade you still use:

- `exportTranslationsFile(pack)`
- `exportDataFor(pack, options)`
- `exportPackFoldersFile()`
- `exportPackFoldersData(options)`
- `exportDirectoryTranslations()`
- `exportDirectoryData(options)`

### Dynamic export is now stronger

Because converters now participate coherently in extraction, export can include
structured and embedded data that older Babele versions could only export
through ad hoc external tooling.

This is especially relevant if you maintained helper modules just to generate
starter translation files.

## UI and Foundry v14 Notes

2.8.0 also modernized parts of the UI integration layer for recent Foundry
versions.

Relevant developer-facing changes:

- export dialogs now use `DialogV2`
- the on-demand actor translation flow now uses `DialogV2`
- export progress now uses `ui.notifications.info(..., {progress: true})`
  rather than deprecated `SceneNavigation.displayProgressBar`
- default mappings now include an initial conservative `ActiveEffect` mapping:
  `name` and `description`

If your integration extended or monkey-patched old dialog implementations, you
should review those assumptions against the current `DialogV2`-based flows.

## Practical Migration Guidance

### If you wrote custom converters

Do this:

- keep accepting `tc` for compatibility
- read active context from `runtime.currentCompendium?.()`
- read `params` instead of relying on hidden external configuration
- read `context.runtime` inside `extract`
- use runtime-aware pack resolution for nested lookups

Avoid this:

- assuming `tc` is always the active compendium
- reimplementing embedded document translation manually if `document`
  already models the case
- searching global pack registries directly for nested contextual lookups

### If you used mapping classes directly

Do this:

- think in terms of `DocumentMapping`
- use `DocumentMappings.hierarchyFor(documentType).mappingFor(data)`
- pass runtime at execution time

Avoid this:

- binding compendium context in constructors
- treating subtype mappings as a special-case side channel

### If you built custom matching logic

Do this:

- register custom translation match strategies
- register reusable identity extractors where appropriate
- let `TranslationEntries` remain the place where entry matching happens

Avoid this:

- scattering matching heuristics across converters and compendium code
- replacing the built-in fallback order unless you really mean to

## Quick Checklist

- Migrate low-level mental models from "translated compendium" to
  `MappedCompendium`
- Migrate low-level mental models from "compendium mapping" to
  `DocumentMapping`
- Stop assuming `tc` is the active context in converters
- Use `runtime.currentCompendium()` in new converter code
- Pass and read `params` in function-based converters when configuration is
  needed
- Update `extract` hooks to read `context.runtime`
- Prefer the built-in `document` converter for document-valued fields
- Use `DocumentMappings` and `TranslationEntries` instead of reproducing their
  logic externally
- Register converters, mappings, strategies, and identity extractors before
  `init()`
- Review old dialog hooks if you relied on ApplicationV1-era dialog behavior

## Stability Note

2.8.0 substantially improves the coherence of the internal model, but direct
imports from `module/script/*` are still advanced usage.

The supported long-term direction is:

- explicit runtime context
- document-centric mappings
- translation matching centralized in `TranslationEntries`
- source precedence centralized in `TranslationRegistry`
- embedded document handling through `DocumentConverter`
- UI integration aligned with modern Foundry APIs
