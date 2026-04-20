# Babele GitLab Roadmap

This file turns the current roadmap into a GitLab-ready backlog.

Suggested milestone order:

1. `2.7.8` Stabilization and observability
2. `2.8.0` Foundry 13/14 compatibility layer
3. `3.0.0` Architecture cleanup and public API consolidation

Suggested common labels:

- `type::bug`
- `type::feature`
- `type::refactor`
- `area::core`
- `area::wrapper`
- `area::ui`
- `area::docs`
- `area::tests`
- `area::api`
- `priority::P0`
- `priority::P1`
- `priority::P2`

## Milestone `2.7.8`

Goal: harden the current module behavior without breaking translation files, converter workflows, or existing module/system integrations.

Definition of done:

- Initialization failures are visible and do not leave Babele in a broken pending state.
- JSON loading and mapping discovery are diagnosable.
- Known runtime bugs on falsy values and missing reference packs are fixed.
- Public docs and public API names are aligned enough to reduce support friction.
- The release process is automated enough that a tagged release can publish GitLab and Foundry metadata with minimal manual work.

### Issue: Prevent initialization deadlocks and fail open on bootstrap errors

- Milestone: `2.7.8`
- Suggested labels: `type::bug`, `area::core`, `priority::P0`

Description:

Refactor Babele initialization so unexpected exceptions do not leave `game.babele.init()` permanently pending. The wrapper must fail open and return original compendium data when initialization fails.

Scope:

- Replace the current `new Promise(async ...)` init flow with an internal async method.
- Ensure initialization errors are caught, logged, and surfaced clearly.
- Reset the cached initialization promise when bootstrap fails, so a later retry is possible.
- Ensure wrapper code does not block compendium loading indefinitely.

Acceptance criteria:

- A thrown error during initialization does not leave Babele stuck in a pending state.
- Compendium loading still works with untranslated data if initialization fails.
- A later retry after fixing the cause can initialize successfully.
- Error output clearly identifies the failed bootstrap step.

Dependencies:

- None.

### Issue: Replace silent JSON loading failures with structured diagnostics

- Milestone: `2.7.8`
- Suggested labels: `type::bug`, `area::core`, `area::docs`, `priority::P0`

Description:

Loading translation files and mapping files currently swallows JSON and fetch failures. Replace silent failures with structured diagnostics that report file path, source type, language, pack, and exception details.

Scope:

- Add a centralized logger utility for `debug`, `warn`, and `error`.
- Report failures for translation files and mapping files separately.
- Report successful file loads in debug mode.
- Report skipped files and empty discovery results with actionable messages.

Acceptance criteria:

- Invalid JSON produces a visible, structured error log.
- Missing files and fetch failures produce warnings instead of silent failure.
- Logs identify the affected file and whether it was a translation or mapping source.
- A diagnostic mode can list loaded files and translated packs.

Dependencies:

- None.

### Issue: Fix falsy translation values in field mapping

- Milestone: `2.7.8`
- Suggested labels: `type::bug`, `area::core`, `priority::P0`

Description:

`FieldMapping.map` currently skips valid translated values such as `""`, `0`, and `false` because it only writes mapped output when the translated value is truthy.

Scope:

- Replace truthy checks with explicit `undefined` and `null` checks.
- Review related extractor and converter behavior for the same class of bug.
- Add focused regression tests for falsy values.

Acceptance criteria:

- Empty strings, zeroes, and boolean `false` are preserved when explicitly translated.
- `undefined` and `null` still behave as non-values.
- Regression tests cover at least `""`, `0`, `false`, and `null`.

Dependencies:

- None.

### Issue: Guard missing or invalid reference packs

- Milestone: `2.7.8`
- Suggested labels: `type::bug`, `area::core`, `priority::P0`

Description:

Translation files can declare `reference` packs. Missing, misspelled, or untranslated references should not crash runtime translation.

Scope:

- Add null-safe handling for missing reference packs.
- Log invalid references with the source translation file or pack name.
- Ensure both `hasReferenceTranslations` and `translate` handle absent references safely.

Acceptance criteria:

- Invalid `reference` values do not throw.
- The original document remains usable even if its reference pack is invalid.
- Logs clearly identify the broken reference target.

Dependencies:

- None.

### Issue: Align converter registration API with documentation

- Milestone: `2.7.8`
- Suggested labels: `type::feature`, `area::api`, `area::docs`, `priority::P1`

Description:

Documentation describes `registerConverter(name, fn)` while the current code exposes `registerConverters(object)`. Add the single-converter API and keep bulk registration support.

Scope:

- Add `registerConverter(name, fn)` as a public API.
- Implement it as a thin wrapper over `registerConverters`.
- Update docs and examples to reflect both supported forms.
- Mark old or ambiguous examples clearly if needed.

Acceptance criteria:

- External modules can register a single converter with `registerConverter`.
- Existing `registerConverters` users continue to work unchanged.
- Documentation examples match the actual API.

Dependencies:

- None.

### Issue: Align mapping file naming between code and documentation

- Milestone: `2.7.8`
- Suggested labels: `type::bug`, `area::docs`, `area::core`, `priority::P1`

Description:

Documentation mentions `mappings.json`, while current runtime discovery looks for `mapping.json`. This mismatch is a support and adoption problem.

Scope:

- Decide on the canonical filename.
- Support both names during a transition period, or document a deliberate breaking choice for a later release.
- Emit a warning when a deprecated filename is used.
- Update docs and examples accordingly.

Acceptance criteria:

- Users can discover the correct mapping filename from docs and logs without ambiguity.
- Runtime supports the intended filename policy consistently.
- If both names are supported, precedence is documented.

Dependencies:

- None.

### Issue: Add converter-aware export support for translation skeleton generation

- Milestone: `2.7.8`
- Suggested labels: `type::feature`, `area::core`, `area::api`, `area::docs`, `priority::P1`

Description:

`exportTranslationsFile` currently relies on `extract()`, and `CompendiumMapping.extract()` intentionally skips dynamic mapped fields backed by converters. This makes exported translation files incomplete for many document types and effectively empty for content whose translatable data is mostly converter-driven, especially `Adventure` packs. Babele needs a way to export usable translation skeletons even when the mapped field is resolved through converter logic, so exported JSON can be used directly as translator starting points and as test fixtures.

Scope:

- Define a minimal export-time contract for converter-backed fields without breaking the existing runtime converter API.
- Allow built-in converters to provide extraction logic for export, so they can emit the source-language values using the same structural knowledge they already use for translation.
- Keep backward compatibility for existing custom converters that only implement runtime translation behavior.
- Make `exportTranslationsFile` distinguish between static field extraction and converter-aware extraction.
- Ensure Adventure export can include embedded-document translation content instead of producing empty `entries`.
- Add export coverage for built-in dynamic converters such as `fromPack`, Adventure embedded-document converters, `pages`, `tableResults`, `deckCards`, `playlistSounds`, and `sceneRegions`.
- Emit diagnostics when a converter-backed field cannot be exported because no export implementation exists.
- Document the converter export contract and the expected JSON shape for exported dynamic fields.

Acceptance criteria:

- `exportTranslationsFile` no longer produces effectively empty files for `Adventure` packs whose translatable content is converter-backed.
- Built-in dynamic fields export usable source-language skeletons that translators can fill in directly.
- Exported files are usable as starting fixtures for manual and automated tests.
- Runtime translation behavior remains backward compatible for existing modules and custom converters.
- Custom converters that do not support export do not break the export flow; skipped fields are reported clearly.
- Documentation explains how converter authors can opt into export support.

Dependencies:

- None.

### Issue: Add a minimal automated test harness for converters and mapping regressions

- Milestone: `2.7.8`
- Suggested labels: `type::feature`, `area::tests`, `priority::P1`

Description:

Babele needs a small automated safety net before deeper Foundry 14 work. Start with focused tests around the most fragile translation behaviors.

Scope:

- Introduce a lightweight test harness suitable for the module codebase.
- Cover `FieldMapping`, `pages`, `tableResults`, `deckCards`, and `sceneRegions`.
- Add regression coverage for missing references and falsy mapped values.

Acceptance criteria:

- Tests run in CI or via a documented local command.
- The first suite covers the known regression-prone converters and field mapping behavior.
- The suite is small enough to maintain but strong enough to protect refactors.

Dependencies:

- None.

### Issue: Automate tagged release publication to GitLab and Foundry

- Milestone: `2.7.8`
- Suggested labels: `type::feature`, `area::api`, `area::docs`, `priority::P1`

Description:

The current release flow still requires several manual steps after tagging: creating the GitLab Release, writing or copying release notes, publishing the new version on Foundry's package page, and closing the milestone. Babele should automate as much of this process as possible so the next release can be produced from the tag pipeline with predictable metadata and minimal manual intervention.

Scope:

- Keep the git tag as the human release trigger and treat the tag name as the authoritative version number.
- Extend CI so tagged pipelines create or update the GitLab Release automatically after the build artifacts are ready.
- Generate release notes from the closed issues of the milestone whose title matches the tag, with an override file such as `release-notes/<tag>.md` if a hand-curated note is present.
- Publish the same release to Foundry through the Package Release API using the per-package release token stored in CI variables.
- Support a Foundry `dry-run` validation step before the real publish call.
- Close the GitLab milestone automatically only after GitLab release creation and Foundry publish succeed.
- Document the required CI/CD variables and the expected operator workflow.

Acceptance criteria:

- Creating a version tag is sufficient to trigger a full release pipeline.
- The pipeline produces a GitLab Release for the tagged version without manual use of the GitLab web UI.
- Release notes are generated automatically from the matching milestone when no manual override file is provided.
- The pipeline can publish the tagged release to Foundry using a stored secret token.
- A failed Foundry publish does not silently pass and does not close the milestone.
- Documentation explains the required secrets, the dry-run option, and the expected tagging workflow.

Dependencies:

- Tagged manifest generation from `2.7.8`.

## Milestone `2.8.0`

Goal: make Babele robust across Foundry 13 and 14, with explicit adapters around the unstable integration points.

Current status review as of `2026-04-14`:

- `done`: Introduce TranslationRegistry for source discovery and merge precedence
- `done`: Introduce TranslationResolver for deterministic key resolution
- `done`: Include folder translations in exported translation files
- `done`: Harden wrapper integration around compendium document loading
- `open`: Rework compendium and sheet UI integration for ApplicationV2-safe behavior
- `open`: Replace settings reload with cache invalidation and guided reinitialization
- `open`: Complete Foundry 14 scene region coverage

Recommended roadmap additions based on the work already completed during `2.8.0`:

- formalize the runtime-scoped compendium model (`CompendiumRuntime`, branch-local `currentCompendium`, and deterministic nested pack precedence)
- formalize Adventure virtual pack scope isolation as a tracked issue instead of leaving it implicit inside broader Adventure work
- track the developer migration and API transition documentation delivered with the `MappedCompendium` / `DocumentMapping` rename work

Definition of done:

- Babele behavior is stable on Foundry `13.351` and a target Foundry `14.x` build.
- Wrapper and UI integration points are isolated enough to evolve without touching translation semantics.
- Runtime translation of nested content is deterministic and observable.

### Issue: Introduce TranslationRegistry for source discovery and merge precedence

- Milestone: `2.8.0`
- Suggested labels: `type::refactor`, `area::core`, `priority::P1`
- Status: `done`

Description:

Extract translation file and mapping discovery into a dedicated registry responsible for source discovery, merge order, and effective configuration reporting.

Scope:

- Centralize translation source discovery from modules, systems, and local directories.
- Centralize mapping file discovery and merge order.
- Expose an internal view of effective sources per language and per pack.
- Prepare the ground for cache invalidation and diagnostics.

Acceptance criteria:

- Translation and mapping source discovery no longer live as loosely coupled logic inside the main facade.
- Effective translation sources and mapping sources can be inspected for diagnostics.
- Merge precedence is explicit in code and documented.

Dependencies:

- `2.7.8` diagnostics work.

### Issue: Introduce TranslationResolver for deterministic key resolution

- Milestone: `2.8.0`
- Suggested labels: `type::refactor`, `area::core`, `priority::P1`
- Status: `done`

Description:

Centralize how Babele decides which translation entry applies to a document, including `_id`, `name`, `flags.core.sourceId`, `_stats.compendiumSource`, and reference packs.

Scope:

- Resolve translation keys in one place.
- Cache resolved keys where safe.
- Make nested document translation deterministic instead of relying on the first matching translated pack.
- Add diagnostics to explain why a translation entry matched.

Acceptance criteria:

- Translation lookup logic is not duplicated across `TranslatedCompendium` and converters.
- Embedded document translation is deterministic and reproducible.
- Key resolution order is documented and test-covered.

Dependencies:

- `TranslationRegistry`.

### Issue: Include folder translations in exported translation files

- Milestone: `2.8.0`
- Suggested labels: `type::feature`, `area::core`, `area::docs`, `priority::P1`
- Status: `done`

Description:

`exportTranslationsFile` currently exports only document `entries`. When a compendium also contains translatable folders, the exported JSON does not include the `folders` section, so translators do not get a complete starting file and must add folder translations manually. Babele should export folder translation skeletons together with entries whenever folders are present.

Scope:

- Extend `exportTranslationsFile` so exported compendium JSON includes a `folders` section when the source compendium contains folders.
- Export folder names using the same JSON shape already supported at runtime: original folder name as key, source-language name as value.
- Keep existing `entries` export behavior unchanged.
- Ensure folder export works together with both legacy and object-style `entries` export modes.
- Document that folder translations are exported only for compendium-internal folders, not for separate `_packs-folders.json` files unless explicitly requested by a future issue.
- Add regression coverage for compendium exports that include both `folders` and `entries`.

Acceptance criteria:

- Exported translation files include a `folders` object whenever the compendium contains folders.
- Folder names in the export use the original/source-language names as both key and initial value.
- Existing `entries` export output remains backward compatible.
- Documentation explains when and how `folders` appear in exported translation files.
- Automated tests cover export of a compendium with folders.

Dependencies:

- None.

### Issue: Harden wrapper integration around compendium document loading

- Milestone: `2.8.0`
- Suggested labels: `type::refactor`, `area::wrapper`, `priority::P1`
- Status: `done`

Description:

The wrapper around compendium loading is the most upgrade-sensitive part of Babele. Make it shape-safe, adapter-based, and easier to test across Foundry versions.

Scope:

- Extract translation of loaded documents into dedicated functions.
- Validate result shapes before reconstructing document instances.
- Isolate Foundry version differences inside an adapter layer.
- Test `getIndex`, `getDocuments`, `getDocument`, and `indexDocument` flows.

Acceptance criteria:

- Wrapper code has explicit guards around assumptions on payload shape.
- Behavior is verified on both index and full document loads.
- The module fails open if a wrapper assumption no longer holds.

Dependencies:

- `2.7.8` bootstrap hardening.

### Issue: Rework compendium and sheet UI integration for ApplicationV2-safe behavior

- Milestone: `2.8.0`
- Suggested labels: `type::refactor`, `area::ui`, `priority::P1`
- Status: `open`

Description:

Current UI integration still depends on direct DOM manipulation and `innerHTML` append patterns. Move to safer DOM creation and isolate UI hooks into a dedicated bridge.

Scope:

- Replace `innerHTML +=` usage with DOM node creation.
- Isolate header button injection behind a single UI bridge.
- Audit pop-out behavior and duplicate render behavior.
- Reduce reliance on direct text matching for compendium entries where possible.

Acceptance criteria:

- Original-name rendering no longer uses `innerHTML +=`.
- Header control injection is consistent across old and new sheet APIs.
- Duplicate renders do not create duplicate controls.
- Pop-out and rerender behavior remain stable.

Dependencies:

- None.

### Issue: Replace settings reload with cache invalidation and guided reinitialization

- Milestone: `2.8.0`
- Suggested labels: `type::feature`, `area::core`, `area::ui`, `priority::P1`
- Status: `open`

Description:

Changing the translation directory currently forces a full browser reload. Replace that with explicit invalidation and a guided reinitialization path.

Scope:

- Introduce invalidation for discovered translation files, mapping files, and resolved caches.
- Re-run initialization when translation sources change.
- Provide a notification if a full refresh is still required in edge cases.

Acceptance criteria:

- Changing Babele settings does not immediately call `window.location.reload()`.
- Relevant caches are invalidated and rebuilt.
- Users receive a clear status message after changing settings.

Dependencies:

- `TranslationRegistry`.

### Issue: Complete Foundry 14 scene region coverage

- Milestone: `2.8.0`
- Suggested labels: `type::feature`, `area::core`, `priority::P1`
- Status: `open`

Description:

Scene regions are already partially supported, but behavior coverage is still narrow. Expand support so v14 scene workflows are translated as first-class content.

Scope:

- Audit text-bearing fields inside `RegionBehavior`.
- Extend the `sceneRegions` converter where necessary.
- Verify support against real region-based scene data.
- Document the supported translation shape for region behaviors.

Acceptance criteria:

- Scene region names and relevant behavior text fields are translated reliably.
- Unsupported region behavior fields are explicitly documented.
- Tests cover at least one realistic v14 region/behavior payload.

Dependencies:

- `2.7.8` converter tests.

### Issue: Modernize export dialog and add translation-aware export modes

- Milestone: `2.8.0`
- Suggested labels: `type::feature`, `area::ui`, `area::core`, `area::docs`, `priority::P1`
- Status: `open`

Description:

Babele's export flow needs a final modernization pass before the `2.8.0` release.

The current export dialog still uses ApplicationV1, defaults to the legacy output format, and always exports source-language content even when translations already exist for the current compendium. This limits the usefulness of export both for translators and for maintenance workflows.

The export flow should be updated so it is aligned with the current UI architecture, clearer about format direction, and aware of the current translation state of the compendium being exported.

Scope:

- Replace the current export dialog implementation with an ApplicationV2-based UI.
- Make the `compatible` export format the default selection.
- Mark the `legacy` format as deprecated in the UI and documentation, with explicit notice that it will be removed in a future major version.
- Make export aware of whether the current compendium already has translations loaded.
- Add export-content selection modes:
  - all entries
  - translated entries only
  - untranslated entries only
- Define clearly what “translated entries only” means:
  - include only entries for which Babele resolves a translation entry
  - export the translated payload rather than always exporting the original source payload
- Keep export behavior deterministic for converter-backed fields and embedded Adventure content.
- Improve the dialog layout and wording so the export options are easier to understand and visually cleaner.

Acceptance criteria:

- The export dialog uses ApplicationV2.
- The default export type is `compatible`.
- The `legacy` option is still available for now, but clearly marked as deprecated.
- If the current compendium has loaded translations, the dialog exposes export modes based on translation presence.
- Export can produce:
  - all entries
  - translated entries only
  - untranslated entries only
- “Translated entries only” exports translated values for the selected entries, not the original source values.
- Existing export behavior for converter-backed fields remains compatible.
- Documentation explains the new default format, the deprecation of legacy export, and the new translation-aware export modes.

Dependencies:

- converter-aware export support
- ApplicationV2-safe UI work

## Milestone `3.0.0`

Goal: make Babele easier to extend, easier to debug, and less coupled to Foundry internals for future majors.

Definition of done:

- Translation precedence and invalidation are explicit and testable.
- Public APIs are coherent and documented.
- Major internal responsibilities are separated cleanly enough to lower the cost of future Foundry migrations.

### Issue: Define and expose effective mapping precedence

- Milestone: `3.0.0`
- Suggested labels: `type::refactor`, `area::core`, `area::api`, `priority::P2`

Description:

Mapping precedence is currently spread across defaults, global mappings, and per-pack mappings. Make the resolution order explicit and inspectable.

Scope:

- Define precedence across default mappings, external mappings, system mappings, translation-file mappings, and runtime overrides.
- Expose an effective mapping view for diagnostics.
- Document override behavior clearly for maintainers of translation modules.

Acceptance criteria:

- Effective mapping precedence is explicit in code and documentation.
- Users can inspect the final mapping applied to a pack or document type.
- Refactors no longer rely on hidden in-place mutation of defaults.

Dependencies:

- `TranslationRegistry`.

### Issue: Add formal cache and invalidation strategy

- Milestone: `3.0.0`
- Suggested labels: `type::feature`, `area::core`, `priority::P2`

Description:

Babele already caches discovered files, but it does not yet expose a formal strategy for caching resolved translation lookups and invalidating them safely.

Scope:

- Add cache layers for resolved translation keys and effective mappings where appropriate.
- Invalidate caches on language change, directory change, system translation dir change, and mapping registration.
- Document cache boundaries and invalidation triggers.

Acceptance criteria:

- Cache behavior is explicit rather than incidental.
- Cache invalidation is triggered by all relevant configuration changes.
- Debug output can show when caches were hit or invalidated.

Dependencies:

- `TranslationResolver`.
- `TranslationRegistry`.

### Issue: Consolidate and document the public Babele API

- Milestone: `3.0.0`
- Suggested labels: `type::feature`, `area::api`, `area::docs`, `priority::P2`

Description:

Consolidate the public API around the actual integration needs of systems and translation modules, then document it as a stable contract.

Scope:

- Define supported public methods and deprecations.
- Include converter registration, mapping registration, translation source registration, translation resolution helpers, and cache invalidation.
- Add deprecation warnings where legacy access patterns remain supported.

Acceptance criteria:

- Public APIs are documented in one place with examples.
- Deprecated APIs emit clear compatibility warnings.
- External module authors can rely on a stable integration contract.

Dependencies:

- `registerConverter` support from `2.7.8`.
- Registry and resolver work from `2.8.0`.

### Issue: Build a support matrix and verification checklist for release validation

- Milestone: `3.0.0`
- Suggested labels: `type::feature`, `area::tests`, `area::docs`, `priority::P2`

Description:

Babele should ship with a documented validation matrix for the Foundry versions and content types it officially supports.

Scope:

- Define the official Foundry support matrix.
- Define representative content fixtures: Adventure, Journal pages, RollTable results, Scene regions, Cards, owned items.
- Add a release checklist for compatibility verification.

Acceptance criteria:

- Releases are validated against a documented support matrix.
- The checklist covers the most fragile translation scenarios.
- Version support statements in `module.json` are backed by repeatable checks.

Dependencies:

- Test harness from `2.7.8`.

## Recommended issue order

1. Prevent initialization deadlocks and fail open on bootstrap errors
2. Replace silent JSON loading failures with structured diagnostics
3. Fix falsy translation values in field mapping
4. Guard missing or invalid reference packs
5. Align converter registration API with documentation
6. Align mapping file naming between code and documentation
7. Add converter-aware export support for translation skeleton generation
8. Add a minimal automated test harness for converters and mapping regressions
9. Automate tagged release publication to GitLab and Foundry
10. Introduce TranslationRegistry for source discovery and merge precedence
11. Introduce TranslationResolver for deterministic key resolution
12. Harden wrapper integration around compendium document loading
13. Rework compendium and sheet UI integration for ApplicationV2-safe behavior
14. Replace settings reload with cache invalidation and guided reinitialization
15. Complete Foundry 14 scene region coverage
16. Define and expose effective mapping precedence
17. Add formal cache and invalidation strategy
18. Consolidate and document the public Babele API
19. Build a support matrix and verification checklist for release validation
