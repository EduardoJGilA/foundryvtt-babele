# Codex Context Dump

Last updated: 2026-04-17

This file is a technical handoff for future Codex sessions.
It is not user-facing documentation and should be kept aligned with the current codebase state.

## Primary Reference Files

- `doc.md`: user documentation
- `PRE_ROADMAP_TRIAGE.md`: historical open issues before the roadmap and related triage
- `ROADMAP_GITLAB.md`: roadmap and milestone planning

## Project Context

Repository: `foundryvtt-babele`

Purpose:

- Babele provides translation support for Foundry VTT compendiums.
- It loads translation JSON files and mapping definitions, applies them at runtime, and offers APIs used both internally and by external modules.
- It supports translated compendium indexes, full document translation, runtime translation of imported content, and export of translation starter JSON files.

## Current Milestone Context

The recently completed work closed milestone `2.7.8`.

Current focus moved to milestone `2.8.0`.

Recent roadmap work included:

- release pipeline automation
- `TranslationRegistry` introduction
- compendium translation runtime refactor
- runtime scoping for adventure virtual packs
- `MappedCompendium` and decorator-based architecture
- extensible translation-entry matching via `TranslationEntries`
- imported compendium folder translation
- compendium UI and search fixes for original names

## Important Existing Documents and Concepts

The user has a strong OO preference and specifically dislikes `get*` naming for accessors.

Relevant modeling preferences repeatedly stated by the user:

- prefer behavior-oriented objects over procedural helpers
- avoid exposing internal details when a richer object can own the behavior
- use decorators correctly: a decorator must respect the same public contract as the wrapped object
- avoid unnecessary deprecations for newly introduced internal APIs that have not yet shipped
- keep naming precise: `documentType` is preferred to `entityType`

The user explicitly referenced Yegor Bugayenko's OO style articles to motivate these preferences.

## Current Architecture Snapshot

### Facade

`game.babele` remains the public facade and public API entry point.

It still exposes core translation APIs to other modules and should remain stable where possible.

### Translation Discovery

`TranslationRegistry` is responsible for source discovery and precedence/merge order for translation and mapping files.

Key points:

- the constructor should stay minimal
- discovery/diagnostics are part of the registry contract
- the registry should not depend on `Babel` for generic Foundry context

### Compendium Model

The previous `TranslatedCompendium` naming was reconsidered because a compendium may be managed even without an actual translation payload.

Current direction:

- `MappedCompendium` is the canonical class
- `TranslatedCompendium` remains as a compatibility export/shim
- a `MappedCompendium` can exist even when no translation is currently available
- Babele creates mapped compendiums during init instead of lazily only when translations exist

### Compendium Decoration

Adventure-specific behavior is handled with a proper decorator approach.

Important design constraint:

- the decorator fully replaces the wrapped object from the caller point of view
- the wrapped `MappedCompendium` must not know whether it is decorated
- no `Null*Decorator` pattern was wanted here

### Runtime and Scope

Adventure translation introduced the need for scoped, temporary virtual compendiums.

Current mental model:

- runtime behaves similarly to a thread-local stack
- nested translation operations can create child scopes
- current compendium context matters when converters descend into embedded documents
- adventure-local virtual packs must not leak globally outside the correct translation scope

`CompendiumRuntime` exists to model scoped lookup behavior.

### Translation Matching

`TranslationEntries` is now the object that owns translation-entry normalization and matching.

Important behavior:

- custom translation match strategies can be registered through `game.babele`
- custom strategies run before built-in strategies
- the strategy contract works on a single candidate translation entry at a time
- `context.documentType` is passed to strategies
- the built-in `_id` / `name` / `sourceId` strategies are now an internal detail of `TranslationEntries`
- callers pass only custom strategies; `TranslationEntries` appends its internal defaults itself
- `MappedCompendium.translationMatchStrategies()` now returns only custom strategies, so strategy propagation no longer duplicates built-ins across packs
- `MappedCompendium` now owns a `translationEntries` object instead of a separate resolver

Built-in resolution order remains conceptually:

- `_id`
- `name`
- `sourceId`

with de-duplication of repeated candidate keys.

The user explicitly wanted document-type-aware matching for cases like DnD `Item` documents sharing the same `name` but having different `type`.

This should continue to be handled through `TranslationEntries` strategy customization rather than ad hoc special cases spread across the codebase.

## Converter Design State

Converters are still an important extension point and may be written by external developers.

Important constraints:

- do not casually break converter signatures
- internal code can move away from legacy parameters more aggressively than public converter contracts
- runtime/current compendium context should do more work than passing ad hoc `tc` state everywhere

`fromPack` and related logic were normalized around the newer runtime concepts.

Intent of `fromPack`:

- handle embedded collections of other documents
- first use embedded/local translation payload when available
- otherwise fall back to translated physical or scoped virtual packs
- resolve matches using the translation resolver and document-type-aware logic

Important user clarification:

- only top-level Foundry documents are treated as compendium-like translation units
- embedded non-document data should not trigger generic compendium resolution logic

Recent cleanup in the current `2.8.0` cycle:

- default internal mappings now prefer the generic `document` converter whenever the embedded value is a real Foundry `Document` collection
- the old internal Adventure aliases (`adventureItems`, `adventureActors`, etc.) are no longer needed by the core default mappings
- `DocumentConverter` now falls back to the parent compendium custom mapping block when a document field omits an inline `mapping`
- `PlaylistSound` is now modeled explicitly as its own `DocumentType` mapping
- `DocumentConverter` is now directly configurable through its constructor; the temporary internal `ConfiguredDocumentConverter` wrapper was removed
- `converters.js` is now logically split between `LegacyConverters` and `SpecialConverters`, with `Converters` kept as the public facade
- export key allocation was centralized in `ExportKeys`
- the old `playlistSounds` converter was removed from the core and its coverage moved to the generic `document` converter plus the `PlaylistSound` mapping
- `Scene.regions` now uses the generic `document` converter with `Region` / `RegionBehavior` mappings; the old core `sceneRegions` special behavior is now modeled through default mappings and subtype mappings instead of hardcoded converter logic
- a first `DocumentIdentity` framework is now implemented:
  - `DocumentMapping` owns identity policy alongside field mappings
  - `DocumentIdentity` and `IdentityExtractorRegistry` exist
  - `TranslationEntries` consumes `matchCandidates` from the mapping context when provided
  - `ExportKeys` consumes `exportKeyCandidates` from the mapping when provided
  - `Babel` now exposes `registerIdentityExtractor()` / `registerIdentityExtractors()`
  - default behavior is unchanged until a mapping declares `_identity` or a custom identity extractor is registered
- `Babel` now registers the core `range` identity extractor at startup so document mappings can declare it without making it a built-in concern of `DocumentIdentity`
- `RollTable.results` no longer relies on the special `tableResults` core logic:
  - default mappings now model results as `converter: "document"` with `documentType: "TableResult"`
  - `TableResult` now has its own `DocumentMapping` with `_identity.export = ["range", "_id"]` and `_identity.match = ["_id", "range"]`
  - the public legacy converter name `tableResults` is now just a backward-compatible alias around the generic `document` converter
  - `tableResultsCollection` is now also just a backward-compatible alias around the generic `document` converter for `RollTable` collections; the old root-collection special wrapper was removed
- `DocumentMapping.extract()` now filters out fields whose extracted value is `undefined`, so generic extract no longer leaks placeholder keys like `{name: undefined}`
- `DocumentConverter` now prepares an explicit `EmbeddedCompendium` object for embedded-document scopes instead of constructing an ad hoc `MappedCompendium` inline
- `EmbeddedCompendium` is intentionally implemented by composition/delegation, not inheritance:
  - it wraps a `MappedCompendium`
  - it keeps the runtime-facing public contract needed by `DocumentConverter`
  - this avoids the `MappedCompendium -> DocumentMapping -> converters -> DocumentConverter -> EmbeddedCompendium` module initialization cycle that appeared when trying subclassing
- `TranslationResolver` has now been removed:
  - `TranslationEntries` replaces it directly
  - it normalizes both compatible and legacy `entries` payloads
  - it owns candidate-key generation and match diagnostics
  - `MappedCompendium` delegates translation lookup and entry snapshots to it
- duplicate `entries` normalization paths were further removed:
  - `EmbeddedCompendium` now reuses `TranslationEntries` instead of keeping its own array/object normalization helper
  - `Babel` no longer keeps a dead private helper for `entries` normalization
- `Babel.translatedPackFor()` now delegates to `CompendiumRuntime`, so pack lookup precedence is defined in one place only
- export logic has now been extracted from `Babel` into `TranslationExport`:
  - a `TranslationExport` represents the export flow for one compendium pack
  - it owns count computation, source hydration, payload building, pruning, and zip download/progress
  - `Babel.exportTranslationsFile()` and `Babel.exportDataFor()` now only delegate to it
- folder translation logic has now been extracted from `Babel` into `FolderTranslations`:
  - it owns pack-folder translation
  - imported world-folder source resolution
  - system-level `_packs-folders` translation application
  - synthetic metadata reconstruction for special folder translation payloads
  - `Babel` keeps the public methods and delegates to a stable private `FolderTranslations` dependency
- bootstrap/source-loading ownership is now centered on `TranslationRegistry`:
  - `Babel` owns one `TranslationRegistry` directly and no longer routes source loading through an intermediate facade object
  - `TranslationRegistry` owns source registration, discovery, precedence, JSON loading with diagnostics, and fallback to published settings files when browsing is unavailable
  - `PublishedTranslationSource` is now an internal detail of `TranslationRegistry`, not an injected collaborator
  - source registration is explicit through `registerModule(...)`, `registerSystemTranslations(...)`, and `registerConfiguredDirectory()`
  - precedence is source-driven via `weight()` on `TranslationSource` implementations
  - `CompendiumCatalog` owns supported-pack detection and collection-id materialization
  - `MappedCompendiums` depends on `CompendiumCatalog`, not on `Babel`
  - `BabeleRuntimeApplier` depends on `TranslationRegistry`, `FolderTranslations`, and `MappedCompendiums`
  - dead facade relay methods and bootstrap-era bridge objects were removed
- per-compendium translation payload merge has now been extracted from `BabeleBootstrap` into `CompendiumTranslation`:
  - it represents one loaded compendium translation payload
  - it owns the merge semantics across multiple source files contributing to the same collection
  - this is intentionally more precise than introducing a broad `Translations` aggregate too early

## Pilot Translation Findings

Work on the sibling pilot module `foundryvtt-dnd5e-lang-it-it` produced a useful distinction between:

- generic translation patterns that may deserve first-class support in Babele
- system-specific business logic that should remain custom module code

Current conclusion:

- good candidates for native declarative support:
  - simple enum/value translation via a `lookup`-style capability
  - delimited token translation via a `tokenizedLookup`-style capability
- not good candidates for core support:
  - measurement/unit conversion (`weight`, `range`, `movement`, token/light/sight metric conversion)
  - ad hoc string rewriting strongly tied to one system’s wording

This distinction matters because the pilot module still carries several historical converters. The valuable outcome is not “move converters into core”, but “recognize recurring declarative translation patterns and model them explicitly in Babele”.
- a plural aggregate now exists as `CompendiumTranslations`:
  - it indexes `CompendiumTranslation` objects by collection
  - `TranslationRegistry` now uses it instead of scanning arrays with `find(...)`
  - it no longer owns source loading
- document-mapping ownership was further consolidated:
  - `DocumentMappings` now owns the effective default/global mapping layers
  - `DocumentMapping` no longer reads global defaults from `Babel`
  - `MappedCompendium` now materializes its `DocumentMapping` through `DocumentMappings`
  - `Babel.DEFAULT_MAPPINGS` is now only a compatibility getter delegating to `DocumentMappings.DEFAULT_MAPPINGS`
  - `DocumentMappings` is now cloneable and can materialize a candidate aggregate with discovered file-based layers before facade state is swapped
  - `Babel` now swaps in the prepared `DocumentMappings` aggregate as part of state application, keeping mapping-layer semantics inside the aggregate itself
- a new `MappedCompendiums` aggregate now owns runtime compendium materialization:
  - it registers supported Foundry packs as `MappedCompendium`
  - it also registers synthetic `_packs-folders` compendiums when their translation payload exists
  - the old bootstrap/anemic handoff objects introduced during the intermediate refactor were removed
  - `Babel` now coordinates `TranslationRegistry`, `DocumentMappings`, `MappedCompendiums`, and `FolderTranslations` directly
  - old `packs` compatibility on the facade has been removed; internal/runtime call sites now use `mappedCompendiums` or `mappedCompendiumFor(...)` directly
  - `CompendiumTranslations` and `MappedCompendiums` now use their own encapsulated collaborators during `load()` instead of receiving all dependencies as method parameters at call time
- converter registration ownership was further consolidated:
  - `ConverterRegistry` now owns converter normalization and named registration
  - `Babel` no longer stores or normalizes converter maps directly
  - `FieldMapping` named converter lookup now prefers `game.babele.converterNamed(...)`
  - `Babel.converters` remains only as a frozen compatibility view over the registry
  - direct mutation of `game.babele.converters` is now explicitly unsupported by design rather than incidentally tolerated

## Verification Snapshot

Latest full test run: `2026-04-17`

- `npm test`
- Result: `133/133` passing
- built-in converter registration is no longer modeled as a static utility class:
  - `Converters` is now a concrete built-in converter catalog object
  - it composes a `LegacyConverterFactory` that owns the historical function-signature adapters
  - this preserves the public `Converters.*` surface used by tests and by `Babel.registerDefaultConverters()`, but removes the previous static-utility-class shape
  - `fromPack`, `fromDefaultMapping`, `pages`, `deckCards`, and `sceneRegions` now build from that composed legacy factory rather than static helper classes

Still intentionally custom for now:

- `TableResult`, because export keys are range-aware and not simple document keys
- `Card`, because faces/back use nested non-document payloads

Current assessment of the remaining special converters:

- `tableResults` / `tableResultsCollection` still encode two distinct behaviors that the generic document model does not yet cover: range-based keys and document-uuid name fallback
- `deckCards` is structurally close to a document converter at the top level, but `faces` and `back` still behave like nested value objects rather than embedded Foundry documents
- `sceneRegions` no longer needs special core logic; `RegionBehavior` now uses subtype mappings with flat translation field names mapped to deep source paths

Foundry v13 source verification completed:

- `JournalEntryPage` is a real `Document`
- `PlaylistSound` is a real `Document`
- `Card` is a real `Document`
- `Region` is a real `Document`
- `RegionBehavior` is a real `Document`
- `Card.back` and `Card.faces[]` are not `Document`s; they are schema-based nested value objects

This implies:

- `StructuredDataConverter` is mainly justified by `Card.back` / `Card.faces`-like cases
- `sceneRegions` should likely evolve through richer `DocumentMapping` expressivity for `RegionBehavior`, not by treating behaviors as non-document structured data

See also:

- `STRUCTURED_DATA_CONVERTER_DESIGN.md`
- `DOCUMENT_IDENTITY_DESIGN.md`

## Export Behavior

`exportTranslationsFile` was enhanced so it can generate useful starter JSON also for compendiums whose translatable fields are converter-based, including adventures.

Key design choice:

- extraction can delegate to converters because only the converter knows how the original value should be derived in some cases

Additional improvements already made:

- empty/no-result export fields were pruned
- compendium folders are now included in export output
- folders should appear before entries in exported JSON

## Release Automation Context

Release automation was added recently.

Current release flow is intended to automate:

- version handling from tag
- release notes generation from milestone issues
- GitLab release creation
- Foundry package publication through API
- milestone closure

Important release details established during the work:

- Foundry `Version Number` comes from the git tag
- manifest URL should point to the tagged raw source manifest:
  `https://gitlab.com/riccisi/foundryvtt-babele/raw/{version}/module/module.json`
- release notes URL should point to:
  `https://gitlab.com/riccisi/foundryvtt-babele/-/releases/{version}`
- minimum/verified/maximum core version come from `module.json` compatibility fields

Lessons learned from `2.7.8` and `2.7.9`:

- release tests must not hardcode old tag numbers
- artifact and manifest URLs must be validated carefully
- if a tag release goes wrong, the fix path was to delete and recreate the tag, then rerun the pipeline
- protected variables matter in GitLab CI even when tags are not protected

## Foundry v13 Integration Notes

The codebase increasingly distinguishes between:

- supported Foundry APIs
- unsafe/private/internal hooks or wrappers that exist only because Foundry offers no official extension point

There was explicit work to reduce accidental coupling between wrapper code and business logic.

Design direction:

- the wrapper should know how Foundry internals are intercepted
- core Babele objects should receive normalized information, not raw Foundry interception details

## UI Integration Notes

### Original Name Rendering

`originalName` is rendered again in compendium entries after adapting to newer v13 markup.

Notable details:

- markup now often uses anchors like `.entry-name.ellipsis`
- some compendium roots are `ol.subdirectory` rather than the older `.directory-list` root only
- index data can arrive as arrays, `.contents`, or `Collection`-backed values

### Original Name Search

Issue context: search by original untranslated name did not work even when original names were displayed.

Confirmed root cause in Foundry v13:

- Foundry compendium search no longer searches rendered row HTML text
- it searches `DocumentDirectory` index data
- in name-only mode it checks only `entry.name`

Fix implemented:

- Babele wraps `DocumentDirectory._matchSearchEntries`
- when `showOriginalName` is enabled and the search is in name-only mode, it also matches `entry.originalName`
- the wrapper must only add genuine original-name matches
- it must not reuse Foundry's existing matched `folderIds` in a way that drags unrelated siblings into the result set

This bug was actually observed and fixed after comparing screenshots.

## Imported Content Translation

Recently added behavior:

- imported compendium folders are translated, not only system/world pack folders
- source pack resolution tries:
  - compendium source metadata
  - contained document source ids
  - fallback by matching imported folder id against source pack folder ids

This was confirmed to work by the user in real Foundry usage.

## Flags and Semantics Clarified

The user clarified the intended meaning of translation flags:

- `translated`: the document was actually changed by Babele
- `hasTranslation`: a translation entry exists for the document, even if the final merged payload is identical to the original

These values may differ and should not be conflated.

## Tests and Validation

At the time of this dump:

- `npm test` passes
- latest observed result after removing the internal `Babel` bridge from source/bootstrap loading: `136/136`

Important test coverage added in recent work includes:

- release automation scripts
- fail-open wrapper behavior
- `TranslationRegistry`
- `TranslationEntries`
- adventure runtime scoping
- imported compendium folders
- compendium original-name rendering
- compendium original-name search without sibling leakage

## Known User-Verified Behaviors

The user explicitly confirmed the following recent features as working:

- adventure translation export generation
- imported compendium folder translation
- original-name rendering in compendium entries
- original-name search after the final sibling-leak fix

## Source Layout

The source tree under `module/script` is now organized by responsibility:

- `babele.js` remains at root as the public facade and conceptual entrypoint
- `foundry/` contains Foundry integration concerns (`wrapper`, settings registration, runtime apply)
- `ui/` contains dialogs, UI bridge, and DOM helpers
- `translation/` contains source discovery and loaded translation aggregates
- `compendium/` contains runtime compendium models and folder translation behavior
- `mapping/` contains document/field mapping models and built-in default mappings
- `converter/` contains converter contracts, registry, built-ins, and legacy adapters
- `identity/` contains identity extraction and export-key allocation
- `export/` contains translation export orchestration

## Current Open/Recent Topic Area

Immediately before this dump, the active topic was continuing the bootstrap/init cleanup around `Babel`, `TranslationRegistry`, and `MappedCompendiums`.

That cleanup has now progressed further:

- dead facade/test-only compatibility around `packs` has been removed
- folder-translation bridge methods now always resync against the current `mappedCompendiums`
- `TranslationRegistry` owns its published fallback source internally
- tests were moved to the explicit `mappedCompendiums` model instead of mutating deprecated facade state

Suggested next action after resuming from this dump:

- continue with the next issue in milestone `2.8.0`

## Worktree Notes

Be careful: the repository may be intentionally dirty.

Observed during this session:

- modified: `module/script/adventure-embedded-mappings.js`
- untracked:
  - `PRE_ROADMAP_TRIAGE.md`
  - `ROADMAP_GITLAB.md`
  - `TEST_MATRIX_120.md`
  - `doc.md`
  - `the-island-adventure.adventure.it.json`
  - `the-island-adventure.adventure.json`

Do not revert or overwrite these unless explicitly requested by the user.

## Practical Resume Checklist

When resuming in a future session:

1. Read `doc.md`, `PRE_ROADMAP_TRIAGE.md`, and `ROADMAP_GITLAB.md`.
2. Read this file for the recent architectural and milestone context.
3. Inspect `git status` before editing anything.
4. Preserve the current OO modeling direction and naming preferences.
5. Prefer extending existing architecture cleanly over adding ad hoc conditionals.
