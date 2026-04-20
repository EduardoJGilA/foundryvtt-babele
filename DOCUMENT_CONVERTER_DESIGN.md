# DocumentConverter Design Draft

Last updated: 2026-04-16

This document describes the proposed refactor that introduces an OO-based
`DocumentConverter` as a first-class built-in converter alongside
`PrimitiveConverter`.

It is a technical design note, not user-facing documentation.

## Motivation

Babele currently translates document-valued fields through a number of
historical converters such as `fromPack`, `fromDefaultMapping`, `pages`, and
similar specialized implementations.

These converters overlap in responsibility:

- translating embedded or referenced Foundry `Document`s
- resolving `DocumentMapping`s for nested document types
- applying inline translations from the parent payload
- looking up translations from external translated packs
- exposing adventure-local document scopes during nested translation
- exporting embedded documents using ad hoc converter-specific logic

The goal of this refactor is to formalize a generic built-in
`DocumentConverter` and progressively move legacy document-field converters to
thin compatibility adapters over the same mechanism.

## Core Ideas

- distinguish primitive-valued fields from document-valued fields
- make `DocumentMapping` the canonical mapping abstraction for both top-level
  and embedded document types
- model embedded-only document types such as `JournalEntryPage` as valid
  `DocumentMapping` targets even if they never have a top-level compendium
- keep inline field translations as a default capability of document-valued
  fields
- support both `one` and `many` cardinality for document-valued fields
- keep backward compatibility by wrapping legacy function-based converters in a
  `LegacyConverter`
- normalize all registered converters internally to the same OO contract

## Converter Families

The core should converge toward three converter classes:

- `PrimitiveConverter`
- `DocumentConverter`
- `LegacyConverter`

`LegacyConverter` exists only as an adapter layer for pre-existing
function-based converters registered by Babele itself or by third-party
modules.

## OO Converter Contract

All internal converters should expose the same object-oriented contract:

```js
class Converter {
  translate(context) {}
  extract(context) {}
  isDynamic() {}
}
```

This applies to built-in converters and to legacy wrappers after
normalization.

## Converter Context

Converters receive a single context object.

```js
{
  value,             // current field value
  translation,       // translation payload for this field
  source,            // full source document containing the field
  field,             // logical field name
  path,              // source path
  params,            // full field converter declaration / config
  allTranslations,   // full translation payload for the current document
  contextCompendium, // current mapped compendium, if any
  runtime            // active CompendiumRuntime
}
```

`params` is the full JSON declaration of the field, not only the path. This
allows built-in converters to read known options and custom converters to
consume arbitrary configuration without changing the core.

Example:

```js
{
  path: "items",
  converter: "document",
  documentType: "Item",
  cardinality: "many",
  mapping: {
    name: "name",
    description: "system.description.value"
  },
  useRuntimeScope: true,
  lookupExternalPacks: true,
  exposeRuntimeDocuments: false
}
```

Here:

- `params` is the full field declaration
- `params.mapping` is a local mapping override
- `DocumentMapping` remains the canonical mapping abstraction for a document
  type

## DocumentConverter Field Configuration

Minimal declaration:

```js
"pages": {
  "path": "pages",
  "converter": "document",
  "documentType": "JournalEntryPage",
  "cardinality": "many"
}
```

Extended declaration:

```js
"items": {
  "path": "items",
  "converter": "document",
  "documentType": "Item",
  "cardinality": "many",
  "mapping": {
    "name": "name",
    "description": "system.description.value"
  },
  "useRuntimeScope": true,
  "lookupExternalPacks": true,
  "exposeRuntimeDocuments": false
}
```

## Semantic of Built-in Parameters

### `documentType`

The Foundry document type targeted by the field.

Examples:

- `Item`
- `Actor`
- `JournalEntry`
- `JournalEntryPage`

### `cardinality`

Either:

- `one`
- `many`

### `mapping`

Optional local mapping override merged over the canonical `DocumentMapping`
for the target `documentType`.

This must never replace the canonical mapping.

### `useRuntimeScope`

If enabled, the converter may resolve translations from document contexts
already exposed in the active runtime scope.

Typical case:

- documents made visible only inside the scoped runtime of an Adventure

### `lookupExternalPacks`

If enabled, when no inline or runtime-scoped translation is found, the
converter may resolve translations from external translated packs of the same
`documentType`.

This corresponds to the historical behavior of `fromPack`.

### `exposeRuntimeDocuments`

If enabled, the documents handled by this field are exposed into the active
runtime scope so nested translation can see them as local sources.

This corresponds to the historical behavior of `fromDefaultMapping`.

## Resolution Model

For document-valued fields:

- inline field translations are always considered first
- runtime-scoped sources are optional and controlled by `useRuntimeScope`
- external translated packs are optional and controlled by
  `lookupExternalPacks`

This keeps inline translations as a default capability and avoids introducing
an unnecessary opt-in flag for a behavior that should almost always be
available.

## DocumentConverter Behavior

For a document-valued field, `DocumentConverter` should:

1. read the value from the configured field path
2. normalize the value according to `cardinality`
3. resolve the effective `DocumentMapping`
4. read inline translations from the parent translation payload
5. optionally expose the current document set into the runtime scope
6. translate each document using the configured resolution policy
7. restore the original cardinality shape on output

More concretely:

1. start from the canonical mapping for `documentType`
2. merge any local `params.mapping` override on top of it
3. normalize the source value:
   - `one` -> zero or one normalized element
   - `many` -> normalized array
4. collect inline translations from the current field translation payload
5. if `exposeRuntimeDocuments=true`, publish the current document set into the
   active runtime scope
6. for each document:
   - try inline translation first
   - if `useRuntimeScope=true`, try runtime-scoped sources
   - if `lookupExternalPacks=true`, try external translated packs
   - otherwise fail open
7. restore the output to the declared cardinality

## Cardinality Handling

Internally, `DocumentConverter` may normalize everything to arrays.

- `one` -> `[value]` or `[]`
- `many` -> array form

Then:

- `translate` returns a single value for `one`, or an array/collection-shaped
  value for `many`
- `extract` returns a single fragment or a keyed object according to the field
  semantics

This removes the historical assumption that document-valued fields are always
collections.

## LegacyConverter

`LegacyConverter` adapts the historical function-based contract to the new OO
contract.

```js
class LegacyConverter {
  constructor(fn) {
    this.fn = fn;
  }

  translate(context) {
    return this.fn(
      context.value,
      context.translation,
      context.source,
      context.contextCompendium,
      context.allTranslations,
      context.runtime,
      context.params
    );
  }

  extract(context) {
    if (typeof this.fn.extract !== "function") {
      return undefined;
    }

    return this.fn.extract(
      context.value,
      context.source,
      context.contextCompendium,
      {
        field: context.field,
        path: context.path,
        params: context.params,
        runtime: context.runtime,
      }
    );
  }

  isDynamic() {
    return true;
  }
}
```

This keeps legacy compatibility while allowing the internals to work only with
OO converters.

## Converter Registration Boundary

`babele.registerConverter(name, converter)` should accept either:

- a legacy function
- an OO converter object

Suggested normalization:

```js
registerConverter(name, converter) {
  this.registerConverters({ [name]: converter });
}

registerConverters(converters) {
  const normalized = Object.fromEntries(
    Object.entries(converters).map(([name, converter]) => [name, this.#normalizeConverter(converter)])
  );

  this.converters = foundry.utils.mergeObject(this.converters, normalized);
}

#normalizeConverter(converter) {
  if (typeof converter === "function") {
    return new LegacyConverter(converter);
  }

  if (converter && typeof converter.translate === "function") {
    return converter;
  }

  throw new Error("Invalid converter registration. Expected legacy function or OO converter.");
}
```

This turns converter registration into the compatibility boundary and allows
the rest of the system to speak only the OO formalism.

## Relationship With Existing Legacy Converters

The historical converters should remain available for backward compatibility,
but progressively become adapters over `DocumentConverter`.

### `fromPack`

Legacy semantic:

- document-valued field
- inline translations available
- runtime scope may be used
- external translated pack lookup enabled
- runtime exposure disabled

### `fromDefaultMapping`

Legacy semantic:

- document-valued field
- inline translations available
- runtime scope may be used
- external translated pack lookup enabled
- runtime exposure enabled
- local mapping override typically derived from parent configuration

### `pages`

This should become a declarative use of `DocumentConverter` rather than a
specialized ad hoc converter.

## Incremental Migration Strategy

1. Introduce OO converter normalization and `LegacyConverter`.
2. Rename the current primitive path-based built-in converter to
   `PrimitiveConverter`.
3. Introduce `DocumentConverter`.
4. Migrate one canonical use case, such as `JournalEntry.pages`.
5. Re-implement `fromPack` and `fromDefaultMapping` as compatibility adapters.
6. Evaluate which specialized converters can become declarative configuration
   and which should remain domain-specific.

## Open Design Questions

- whether `extract` should be mandatory for OO converters from day one, or
  only strongly encouraged at first
- the exact output shape for `cardinality: "one"` extraction in edge cases
- whether additional built-in parameters should be standardized for document
  resolution, or left entirely to `params`
- whether some existing non-document converters could later be unified under a
  broader configurable framework
