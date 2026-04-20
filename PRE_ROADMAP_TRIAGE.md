# Pre-Roadmap Issue Triage

This file reviews the open GitLab issues labeled `pre_roadmap` as of 2026-04-08.

Source used for the full list:

- GitLab public API for project `16173589`
- Query: `issues?labels=pre_roadmap&state=opened&per_page=100`

Total open `pre_roadmap` issues reviewed: `46`

Triage buckets:

- `close-resolved`: current code appears to already address the issue
- `close-stale`: old support/doc issue, unclear reproduction, or no actionable core bug remains
- `keep-no-milestone`: valid request, but not part of the current roadmap
- `move-2.7.8`: should be folded into the current stabilization milestone
- `move-2.8.0`: should be handled by the compatibility and architecture work
- `move-3.0.0`: long-term API/product work

## Revalidation update for `2.8.0` progress

Review date: `2026-04-14`

The refactors completed during the current `2.8.0` work materially changed the status of several issues that were originally triaged as compatibility-layer work. In particular:

- `TranslationRegistry` is now implemented and tested.
- `TranslationEntries` now centralizes translation-entry normalization and deterministic matching.
- wrapper document loading is now shape-guarded and fail-open.
- nested translation now uses `CompendiumRuntime` and scoped `MappedCompendium` resolution instead of globally leaking Adventure-local virtual packs.
- Adventure embedded translation and `fromPack` fallback behavior are now deterministic enough to justify revisiting some older issues.

### Likely resolved after `2.8.0` work, but should be verified once against a real-world reproduction before closing

### `#54` OnDemandTranslateDialog don't work with translations that use id as keys

- Updated assessment: `likely-resolved`
- Reason: `OnDemandTranslateDialog` now resolves translated packs through the same deterministic lookup path, and translation entry resolution is centralized in `TranslationEntries`.

### `#56` DD5 "multiattack" monster skill issue

- Updated assessment: `likely-resolved`
- Reason: this looked like a nondeterministic embedded translation match. The current runtime-scoped `fromPack` flow and deterministic resolver substantially reduce that failure mode.

### `#65` Spell names are not translated for D&D 3.5

- Updated assessment: `likely-resolved`
- Reason: same family as `#56` and `#71`, where key resolution and pack matching are now centralized and deterministic.

### `#67` Partial and multi-registration compendium translations

- Updated assessment: `likely-resolved`
- Reason: direct fit for the now-implemented `TranslationRegistry` source discovery and precedence model.

### `#71` Using the existing compendium by sourceId

- Updated assessment: `likely-resolved`
- Reason: translation entry matching now explicitly supports `flags.core.sourceId` and `_stats.compendiumSource` in a documented precedence order.

### `#91` Simplify `Actor`s items translation

- Updated assessment: `likely-resolved`
- Reason: the new `CompendiumRuntime` plus runtime-scoped `fromPack` behavior removed most of the previous ambiguity around embedded item translation and nested fallback packs.

### `#92` Loading compendia crashes with babele and lang-de-pf2e

- Updated assessment: `likely-resolved`
- Reason: wrapper reconstruction is now guarded by explicit payload-shape checks and fails open instead of assuming one rigid document shape.

### `#117` `tokenName` does not translate token names in Adventure Packs

- Updated assessment: `likely-resolved`
- Reason: Adventure-local scoped pack translation now preserves the correct current compendium context for nested converter calls, and this exact `tokenName` behavior is covered by automated tests.

### Still open after `2.8.0` work so far

### `#46` Show/search Original Names not working in compendium browser

- Updated assessment: `still-open`
- Reason: UI integration still depends on text matching and DOM manipulation in `renderCompendium`, so this area has not been fully reworked yet.

### `#68` Performance issue when using with Quick Insert

- Updated assessment: `still-open`
- Reason: architecture improved, but there is not yet a specific performance or caching solution for this scenario.

### `#78` Deep Translation Adventure

- Updated assessment: `still-open`
- Reason: Adventure translation is much healthier, but this issue name is broader than the specific bugs already fixed and still needs validation against representative real-world content.

### `#83` Bug: search for original name does not work

- Updated assessment: `still-open`
- Reason: same area as `#46`; search/original-name UI behavior is not yet stabilized enough to close confidently.

### `#98` Combat Carousel breaks babel translation for DND5e conditions

- Updated assessment: `still-open`
- Reason: no targeted work has been done yet on this integration path.

### `#105` Journal Freeze when Babel is enabled

- Updated assessment: `still-open`
- Reason: the wrapper is safer now, but journal-specific heavy content paths still need targeted verification.

### `#106` Incompatibility between Babele and D&D5-V4.x.x

- Updated assessment: `still-open`
- Reason: system-specific compatibility work is not complete just because the core runtime architecture improved.

### `#108` Imported compendium folders are not translated

- Updated assessment: `still-open`
- Reason: folder export support was added, but world-import/runtime folder translation semantics are a different issue and still need dedicated work.

### `#110` Advancements and Effects not showing in DND5E (2024) modules after translation is loaded

- Updated assessment: `still-open`
- Reason: no targeted audit has yet been done on those modern D&D5e structures.

### `#116` Improve babele flag `hasTranslation` and `translated`

- Updated assessment: `still-open`
- Reason: although semantics are cleaner now, this issue still deserves a dedicated pass on the public meaning and lifecycle of those flags.

## Close as resolved

### `#125` Babel.DEFAULT_MAPPINGS override by CompendiumMapping

- Action: `close-resolved`
- Reason: current [compendium-mapping.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/compendium-mapping.js) uses non-inplace merges and no longer mutates defaults in the old problematic way.

### `#95` `babele.ready` hook is called twice

- Action: `close-resolved`
- Reason: current code emits `babele.dataLoaded` in `init()` and `babele.ready` once in the Foundry `ready` hook. The duplicate `babele.ready` report no longer matches [babele.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/babele.js).

### `#31` Feature request: Create a method to set DEFAULT_MAPPINGS()

- Action: `close-resolved`
- Reason: the practical need is already covered by `registerMapping()` plus external `mapping.json` support.

## Close as stale, support, or non-actionable core bug

### `#129` How to translate tableResults name and description?

- Action: `close-stale`
- Reason: this is a usage/documentation question, not a core runtime bug.

### `#128` Compendium translations stopped working

- Action: `close-stale`
- Reason: report reads as a support/configuration problem mixed with outdated translation files; not enough evidence of a current core bug.

### `#127` Question about translating PF2e Adventure Path journals with Babele

- Action: `close-stale`
- Reason: the example JSON shape does not match Babele’s documented translation file format; this is a docs/support case.

### `#107` Get property mapping for tables

- Action: `close-stale`
- Reason: this is a “how do I map this field” question rather than a bug in current behavior.

### `#101` Compendium Translations doesn't load

- Action: `close-stale`
- Reason: very likely a file placement or language directory problem; not enough evidence of a reproducible core defect.

### `#30` Description of exported items don't work on Forbidden Lands Core

- Action: `close-stale`
- Reason: very old, sparse report, likely system-specific mapping mismatch rather than a current core defect.

### `#22` Missing keys in translation file

- Action: `close-stale`
- Reason: localization housekeeping, not roadmap-critical core behavior.

### `#17` Feats getting bonus lost in translation

- Action: `close-stale`
- Reason: likely system-specific downstream behavior tied to PF2E logic, with no actionable Babele-side reproduction in the issue.

## Keep open, but without milestone for now

### `#15` Translations editor

- Action: `keep-no-milestone`
- Reason: large product feature, outside the current stabilization/compatibility roadmap.

### `#48` Export .json file with needed mapping key by default

- Action: `keep-no-milestone`
- Reason: valid export UX request, but not part of the current roadmap.

### `#61` Export translation keys in alphabetical order

- Action: `keep-no-milestone`
- Reason: useful quality-of-life improvement, but not roadmap-critical.

### `#64` Switch original/translation per player

- Action: `keep-no-milestone`
- Reason: legitimate product feature, but not part of the current technical roadmap.

### `#85` Translate back to original language

- Action: `keep-no-milestone`
- Reason: product/UX feature request, not part of current stabilization work.

### `#109` Support reading from a YAML file

- Action: `keep-no-milestone`
- Reason: format preference request; no current roadmap need.

### `#119` Allow overwriting Foundry sort key for localized journal entries

- Action: `keep-no-milestone`
- Reason: reasonable feature request, but not roadmap-critical.

## Move to `2.7.8`

These are the historical issues that most strongly justify adding or extending `2.7.8` work beyond the initial roadmap.

### `#120` `fromPack` converter breaks if translation JSON has multiple Adventure entries

- Action: `move-2.7.8`
- Reason: current code in [babele.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/babele.js) builds `${collection}-items` for Adventure entries inside a loop, reusing the same key and effectively overwriting prior adventure-specific embedded item translations. This is a concrete current bug.
- Suggested roadmap addition: new `2.7.8` issue for Adventure embedded-translation aggregation.

### `#121` Foundry v12 installs incompatible version (2.7.*) by default

- Action: `move-2.7.8`
- Reason: current [module.json](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/module.json) still points `manifest` to `master` and `download` to the latest release artifact, so the packaging concern appears still valid.
- Suggested roadmap addition: new `2.7.8` issue for manifest/release channel safety.

### `#126` Incompatibility with the "Spellbook" module

- Action: `move-2.7.8`
- Reason: even if the external module contributes to the problem, Babele currently allows converter failures during index translation to break consumers. This supports fail-open hardening and converter exception logging.
- Suggested roadmap link: extend the `2.7.8` hardening work to include converter exception isolation.

### `#88` Issue when translating Compendium: `m.replace is not a function`

- Action: `move-2.7.8`
- Reason: same family as `#126` and `#82`: converter exceptions should not take down the whole compendium load.
- Suggested roadmap link: fail-open on converter exceptions.

### `#82` When I import translated Bestiaries from Pack folder,it import an empty folder

- Action: `move-2.7.8`
- Reason: although the visible stack points into an external converter, it exposes a real Babele hardening gap: one converter error can break import.
- Suggested roadmap link: fail-open on converter exceptions during import and translation.

### `#123` Babele tried to load translation for the same pack multiple times

- Action: `move-2.7.8`
- Reason: at minimum this belongs in diagnostics and observability. Even if some duplication is intentional due to merged sources, the current behavior is opaque and easy to misdiagnose as a bug.
- Suggested roadmap link: structured diagnostics for discovered and loaded files.

## Move to `2.8.0`

These issues map directly to the compatibility-layer and translation-resolution work already planned.

### `#46` Show/search Original Names not working in compendium browser

- Action: `move-2.8.0`
- Reason: compendium UI integration is currently fragile and text-driven.

### `#54` OnDemandTranslateDialog don't work with translations that use id as keys

- Action: `move-2.8.0`
- Reason: belongs with key resolution and actor item translation semantics.

### `#56` DD5 "multiattack" monster skill issue

- Action: `move-2.8.0`
- Reason: classic symptom of non-deterministic `fromPack` matching.

### `#65` Spell names are not translated for D&D 3.5

- Action: `move-2.8.0`
- Reason: likely another translation resolution / pack matching problem.

### `#66` Export Roll Table results

- Action: `move-2.8.0`
- Reason: still open feature gap around dynamic/exported content. Could also live in `3.0.0`, but it is close to current converter coverage.

### `#67` Partial and multi-registration compendium translations

- Action: `move-2.8.0`
- Reason: direct fit for `TranslationRegistry` and source precedence work.

### `#68` Performance issue when using with Quick Insert

- Action: `move-2.8.0`
- Reason: aligns with index/wrapper/cache hardening and performance diagnostics.

### `#71` Using the existing compendium by sourceId

- Action: `move-2.8.0`
- Reason: direct fit for the centralized translation-entry matching model.

### `#78` Deep Translation Adventure

- Action: `move-2.8.0`
- Reason: fits the v14/adventure coverage audit.

### `#83` Bug: search for original name does not work

- Action: `move-2.8.0`
- Reason: compendium UI/search semantics remain incomplete.

### `#91` Simplify `Actor`s items translation

- Action: `move-2.8.0`
- Reason: same family as `fromPack` and embedded-document resolution work.

### `#92` Loading compendia crashes with babele and lang-de-pf2e

- Action: `move-2.8.0`
- Reason: wrapper shape assumptions are still too rigid and the current wrapper still calls `data.toObject()` unconditionally.

### `#98` Combat Carousel breaks babel translation for DND5e conditions

- Action: `move-2.8.0`
- Reason: likely an ordering / lazy-loading integration issue around translated compendium data and reference resolution.

### `#105` Journal Freeze when Babel is enabled

- Action: `move-2.8.0`
- Reason: journal loading is still one of the most fragile areas because of `pages` translation and wrapper/index assumptions.

### `#106` Incompatibility between Babele and D&D5-V4.x.x

- Action: `move-2.8.0`
- Reason: fits the broader D&D5e modern data compatibility audit.

### `#108` Imported compendium folders are not translated

- Action: `move-2.8.0`
- Reason: folder translation behavior remains split across pack UI and world-import scenarios.

### `#110` Advancements and Effects not showing in DND5E (2024) modules after translation is loaded

- Action: `move-2.8.0`
- Reason: modern system data compatibility issue, likely tied to structured fields and merge assumptions.

### `#116` Improve babele flag `hasTranslation` and `translated`

- Action: `move-2.8.0`
- Reason: belongs with cleanup of translation semantics and diagnostics.

### `#117` `tokenName` does not translate token names in Adventure Packs

- Action: `move-2.8.0`
- Reason: fits the Adventure import and actor/token translation audit.

## Move to `3.0.0`

### `#94` Allow translating structured data through API or inside CONFIG

- Action: `move-3.0.0`
- Reason: needs a broader public API and non-compendium translation contract.

### `#118` Actor's Translate button should take into account user changes

- Action: `move-3.0.0`
- Reason: this is behavior design around user overrides and merge policy.

### `#122` Move translate actor dialog logic to an API function

- Action: `move-3.0.0`
- Reason: direct fit for public API consolidation.

## Recommended additions to the roadmap

The historical issue review surfaced three concrete gaps that were not explicit enough in the original roadmap:

1. `2.7.8`: fail-open on converter exceptions during index translation, document translation, and import flows.
2. `2.7.8`: fix Adventure embedded translation aggregation so multiple Adventure entries do not overwrite each other.
3. `2.7.8`: fix packaging/manifest release behavior so older Foundry installs do not pick an incompatible latest release.

## Suggested bulk cleanup plan

1. Close resolved: `#95`, `#125`, `#31`
2. Close stale/support: `#129`, `#128`, `#127`, `#107`, `#101`, `#30`, `#22`, `#17`
3. Keep open without milestone for now: `#15`, `#48`, `#61`, `#64`, `#85`, `#109`, `#119`
4. Move to `2.7.8`: `#120`, `#121`, `#126`, `#88`, `#82`, `#123`
5. Move to `2.8.0`: `#46`, `#54`, `#56`, `#65`, `#66`, `#67`, `#68`, `#71`, `#78`, `#83`, `#91`, `#92`, `#98`, `#105`, `#106`, `#108`, `#110`, `#116`, `#117`
6. Move to `3.0.0`: `#94`, `#118`, `#122`
