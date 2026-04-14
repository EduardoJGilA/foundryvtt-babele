# Developer Migration Notes for 2.8.0

This document summarizes the API and contract changes introduced during the 2.8.0 refactor cycle.

It is intended for:

- module developers integrating with `game.babele`
- authors of custom converters
- advanced users importing Babele classes directly from `module/script/*`

This is a migration note, not end-user documentation.

## Scope

The main goals of the refactor were:

- separate "mapped pack" concerns from "translated pack" concerns
- make runtime pack visibility explicit
- keep Adventure-local virtual packs scoped to the active translation flow
- make nested translation logic rely on runtime context instead of ad hoc state

As a consequence, some names changed and some low-level contracts became more explicit.

## Compatibility Summary

The following legacy imports still work through compatibility re-exports:

- `TranslatedCompendium` -> re-export of `MappedCompendium`
- `CompendiumMapping` -> re-export of `DocumentMapping`

This means older code may continue to run, but new code should migrate to the canonical names.

## Renamed Classes

### `TranslatedCompendium` -> `MappedCompendium`

Use:

```js
import {MappedCompendium} from "./module/script/mapped-compendium.js";
```

Legacy compatibility import:

```js
import {TranslatedCompendium} from "./module/script/translated-compendium.js";
```

Why this changed:

- a managed compendium may now exist even when no translation file is available
- the object represents mapping, extraction, translation, and reference resolution
- "translated" is now a state of the compendium, not its whole identity

Migration guidance:

- if your code only needs packs that really have translations, keep using `translated` checks or `game.babele.translatedCompendiumFor(pack)`
- if your code needs extraction or mapping support even without translations, use `MappedCompendium` or `game.babele.mappedCompendiumFor(pack)`

### `CompendiumMapping` -> `DocumentMapping`

Use:

```js
import {DocumentMapping} from "./module/script/document-mapping.js";
```

Legacy compatibility import:

```js
import {CompendiumMapping} from "./module/script/compendium-mapping.js";
```

Why this changed:

- the object models the mapping for a Foundry `Document` type
- it is not a container for an entire compendium

## `game.babele` API Changes

### New distinction: mapped vs translated compendiums

`game.babele` now exposes two different retrieval semantics:

```js
const mapped = game.babele.mappedCompendiumFor("dnd5e.items");
const translated = game.babele.translatedCompendiumFor("dnd5e.items");
```

Behavior:

- `mappedCompendiumFor(pack)` returns the managed compendium if Babele supports the pack type, even if it has no translation file
- `translatedCompendiumFor(pack)` returns a compendium only if `compendium.translated === true`

Migration guidance:

- use `mappedCompendiumFor(pack)` for extraction, mapping, field-level translation, and advanced inspection
- use `translatedCompendiumFor(pack)` only when you explicitly require a loaded translation file

### Existing facade methods still exist

These methods remain available on `game.babele`:

- `translateIndex(index, pack)`
- `isTranslated(pack)`
- `translate(pack, data, translationsOnly)`
- `translateField(field, pack, data)`
- `extract(pack, data, options)`
- `extractField(pack, field, data)`

Important semantic note:

- `translate()` and `translateIndex()` still operate only on translated packs
- `extract()` and `translateField()` delegate through the mapped compendium and therefore can work even when no translation file exists, as long as a mapping exists

## Converter Contract Changes

This is the most important migration area for third-party code.

### Translation callback

The converter callback contract is now:

```js
function converter(value, translation, data, tc, allTranslations, runtime) {
  // return translated value
}
```

Notes:

- `runtime` is the authoritative execution context
- `tc` is retained for backward compatibility
- new internal code should prefer `runtime.currentCompendium()` over `tc`

Recommended pattern:

```js
function converter(value, translation, data, tc, allTranslations, runtime = {}) {
  const current = runtime.currentCompendium?.() ?? tc;
  return current?.translateField("name", data, runtime) ?? value;
}
```

### Extraction callback

Dynamic converter extraction now receives a fourth argument with metadata and runtime:

```js
converter.extract(value, data, tc, {
  field,
  path,
  mapping,
  runtime,
});
```

This replaces the old informal pattern where extraction only received the value and parent context.

Migration guidance:

- if your custom converter already ignored extra arguments, it may continue to work unchanged
- if your converter defines `extract`, update it to read `context.runtime`
- prefer `context.runtime.currentCompendium?.()` when you need the active mapped compendium

Recommended pattern:

```js
converter.extract = function (value, data, tc, context = {}) {
  const runtime = context.runtime ?? {};
  const current = runtime.currentCompendium?.() ?? tc;
  return current ? current.extract(data, runtime) : value;
};
```

### `tc` is no longer the source of truth

Historically many converters assumed the fourth parameter was the active compendium context.

This is no longer a safe assumption in nested translation scenarios.

You should now assume:

- `tc` exists for backward compatibility
- `runtime.currentCompendium()` is the active context for the current translation branch
- when Babele falls back from one root compendium to another, the runtime is re-branched so the destination compendium becomes the current one

This matters for:

- `fromPack`-style converters
- nested Adventure translation
- converters that call `translateField`, `extractField`, or inspect `customMapping`

## Runtime-Aware Pack Resolution

### New low-level object: `CompendiumRuntime`

Nested translation flows now use an explicit runtime object:

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

Migration guidance for advanced integrations:

- use `runtime.translatedPackFor(documentType, data)` instead of iterating `game.babele.packs` manually
- use `runtime.currentCompendium()` instead of assuming the current parent is passed as `tc`
- when you create a nested translation branch, prefer `runtime.child(...)`

### Scope precedence is now stack-like

When child scopes add local packs, the innermost scope wins for:

- document-type lookups
- translated pack fallback lookups

This is especially relevant for Adventure-local virtual packs and other nested translation branches.

## Adventure Virtual Packs

Adventure embedded documents are now handled through runtime-local virtual compendiums.

What changed conceptually:

- Adventure-local packs are no longer meant to be treated as globally visible registries
- they exist inside the active runtime scope of the translated Adventure entry
- nested `fromPack` resolution can see them through runtime lookup

Migration guidance:

- do not rely on `game.babele.packs` containing Adventure entry virtual packs
- inside converters, use the provided runtime to resolve contextual packs
- if you need the current embedded context, read `runtime.currentCompendium()`

## Direct Class Constructor Changes

These are low-level changes. They mostly matter if your code instantiates Babele internals directly.

### `DocumentMapping`

Old mental model:

```js
new CompendiumMapping(entityType, mapping, tc)
```

Current form:

```js
new DocumentMapping(documentType, mapping)
```

Changes:

- `entityType` was renamed to `documentType`
- the compendium instance is no longer passed into the constructor
- runtime is passed when calling `map`, `translateField`, `extractField`, or `extract`

### `FieldMapping`

Old mental model:

```js
new FieldMapping(field, mapping, tc)
```

Current form:

```js
new FieldMapping(field, mapping)
```

Changes:

- no compendium binding in the constructor
- active compendium is resolved from runtime
- `bind()` was removed

If your code imported `FieldMapping` directly and relied on constructor-time compendium binding, move that logic to runtime-aware calls instead.

## Translation Source Discovery

`TranslationRegistry` is now the object responsible for source discovery and precedence.

Main methods:

- `discover()`
- `translationSources()`
- `mappingSources()`
- `sourcesFor(collection)`
- `diagnostics()`

Notes:

- `discover()` is an optional warm-up step
- the registry is source-oriented: it discovers files and precedence, not document-level translations
- canonical `mappings.json` is preferred over deprecated `mapping.json`

If you built custom tooling around Babele file discovery, prefer `TranslationRegistry` instead of reproducing directory scanning logic yourself.

## Recommended Migration Patterns

### If you wrote custom converters

Do this:

- keep accepting `tc` for compatibility
- read active context from `runtime.currentCompendium?.()`
- read `context.runtime` inside `extract`
- use runtime-aware pack resolution for nested lookups

Avoid this:

- assuming `tc` is always the active compendium
- searching `game.babele.packs` directly for nested contextual packs
- assuming Adventure-local virtual packs are globally visible

### If you used translated compendium objects directly

Do this:

- migrate imports from `TranslatedCompendium` to `MappedCompendium`
- use `translated` as state, not class identity
- call `game.babele.mappedCompendiumFor(pack)` when you need extraction without a translation file

### If you used mapping classes directly

Do this:

- migrate imports from `CompendiumMapping` to `DocumentMapping`
- rename `entityType` concepts to `documentType`
- pass runtime at execution time instead of binding compendium state in constructors

## Quick Checklist

- Replace `TranslatedCompendium` imports with `MappedCompendium`
- Replace `CompendiumMapping` imports with `DocumentMapping`
- Stop assuming `tc` is the active context in converters
- Use `runtime.currentCompendium()` in new converter code
- Update `extract` implementations to read `context.runtime`
- Prefer `game.babele.mappedCompendiumFor(pack)` when extraction must work without translations
- Do not rely on Adventure virtual packs being globally registered

## Stability Note

The compatibility re-exports exist to ease migration, but new integrations should move to the canonical names and runtime-aware patterns immediately.

Future work will continue in the direction introduced here:

- explicit runtime context
- source discovery via `TranslationRegistry`
- clearer separation between mapped, translated, and scoped compendium behavior
