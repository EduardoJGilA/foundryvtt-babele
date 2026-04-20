# StructuredDataConverter Design Draft

Last updated: 2026-04-16

This document describes a possible refactor that separates:

- generic translation of structured nested data
- translation of real Foundry `Document` instances

It is a technical design note, not user-facing documentation.

## Verified Foundry v13 Model Boundary

The design should follow the actual Foundry model, not assumptions.

Confirmed from the Foundry v13 source tree:

- `JournalEntryPage` is a `Document`
- `PlaylistSound` is a `Document`
- `Card` is a `Document`
- `Region` is a `Document`
- `RegionBehavior` is a `Document`

Also confirmed:

- `Card.back` is a `SchemaField`, not a `Document`
- `Card.faces[]` entries are `SchemaField` objects, not `Document`s

Therefore:

- `JournalEntryPage`, `PlaylistSound`, `Region`, and `RegionBehavior` are legitimate `DocumentConverter` targets
- `Card.back` and `Card.faces[]` are not `DocumentConverter` targets and need a different abstraction

## Motivation

The current `DocumentConverter` already contains two conceptually different responsibilities:

1. translate a structured nested object or collection using a mapping
2. add document-specific behavior:
   - `MappedCompendium`
   - runtime scope publication
   - sibling lookup
   - external translated pack fallback
   - `TranslationResolver` semantics for document identity

Only the second set is truly document-specific.

The first set is generic and should be reusable for nested non-document data.

## Proposed Split

Introduce a lower-level converter:

- `StructuredDataConverter`

Then specialize it:

- `DocumentConverter extends StructuredDataConverter`

The idea is:

- `StructuredDataConverter` handles structured object translation and extraction
- `DocumentConverter` adds runtime, compendium, and document identity behavior

## Converter Families After Refactor

Target family structure:

- `PrimitiveConverter`
- `StructuredDataConverter`
- `DocumentConverter`
- `LegacyConverter`

Where:

- `PrimitiveConverter` handles scalar field replacement
- `StructuredDataConverter` handles nested mapped objects and collections that are not Foundry `Document`s
- `DocumentConverter` handles real Foundry `Document` values
- `LegacyConverter` remains only as compatibility glue for historical function-based converters

## StructuredDataConverter Contract

It should preserve the same OO converter contract:

```js
class StructuredDataConverter {
  prepare(context) {}
  translate(context) {}
  extract(context) {}
  isDynamic() {}
}
```

But unlike `DocumentConverter`, it should not:

- create `MappedCompendium`
- publish runtime-local compendiums
- resolve external translated packs
- assume `documentType`
- use `TranslationResolver` as document identity logic

It should only:

- normalize cardinality
- match nested values against inline translations
- translate/extract according to a structural mapping

## Structured Mapping Configuration

Minimal idea:

```json
{
  "faces": {
    "path": "faces",
    "converter": "structured",
    "cardinality": "many",
    "mapping": {
      "img": "img",
      "name": "name",
      "text": "text"
    }
  },
  "back": {
    "path": "back",
    "converter": "structured",
    "cardinality": "one",
    "mapping": {
      "img": "img",
      "name": "name",
      "text": "text"
    }
  }
}
```

This is intentionally close to the `document` converter declaration:

- `path`
- `cardinality`
- `mapping`

The difference is semantic:

- `structured` means "nested mapped data"
- `document` means "real Foundry document"

## Matching Semantics for Structured Data

The open design question is how to match individual objects inside a structured collection.

For `DocumentConverter`, the answer is `TranslationResolver`.

For `StructuredDataConverter`, the simplest starting point would be:

- object collections are matched by position by default
- optional `key` configuration may declare a stable matching field

Example:

```json
{
  "faces": {
    "path": "faces",
    "converter": "structured",
    "cardinality": "many",
    "key": "name",
    "mapping": {
      "img": "img",
      "name": "name",
      "text": "text"
    }
  }
}
```

This avoids pretending value objects have document identity when they do not.

Suggested initial policy:

- `one`: just translate the single object
- `many`:
  - if `key` exists, match by key
  - otherwise match by index

## Extraction Semantics

Extraction should mirror the same model:

- `one` -> one structured object
- `many` -> keyed object if `key` exists, otherwise array

This is the main place where design must be chosen carefully.

A conservative option:

- keep export arrays for index-matched structured collections
- use keyed objects only for explicitly keyed structured collections

That keeps extraction honest about how translation matching works.

## Relationship With DocumentConverter

`DocumentConverter` should become a specialization over the same structural engine.

Possible layering:

```js
class StructuredDataConverter {
  translate(context) {
    // normalize value
    // resolve effective mapping
    // apply inline translation
    // return structured result
  }
}

class DocumentConverter extends StructuredDataConverter {
  translate(context) {
    // prepare mapped compendium
    // expose runtime scope if needed
    // translate via inline / runtime / external pack resolution
  }
}
```

What they share:

- cardinality normalization
- structural mapping traversal
- extraction of nested mapped fields

What only `DocumentConverter` adds:

- `documentType`
- `MappedCompendium`
- runtime publication
- sibling lookup
- external pack fallback
- document-aware match semantics

## RegionBehavior Implication

The verification from Foundry changes the interpretation of `sceneRegions`.

`RegionBehavior` is a real `Document`, so in principle it belongs under `DocumentConverter`.

This means `sceneRegions` is not special because behaviors are non-documents.
It is special because the current behavior mappings are:

- type-specific
- sparse
- nested

So the likely direction for `RegionBehavior` is not `StructuredDataConverter`.
It is a richer `DocumentMapping` model.

## Candidate Next Step for Document Mappings

For document types like `RegionBehavior`, the mapping model may need to support type-specific nested field declarations more cleanly.

One possible direction:

```json
{
  "RegionBehavior.displayScrollingText": {
    "name": "name",
    "text": "system.text"
  },
  "RegionBehavior.teleportToken": {
    "name": "name",
    "dialog.revealed": "system.dialog.revealed",
    "dialog.unrevealed": "system.dialog.unrevealed"
  }
}
```

This is conceptually already close to the subtype mapping mechanism used for
`Item.spell` or `Actor.hero`, just applied to a Foundry document type that is
itself embedded.

## Immediate Refactor Roadmap

Recommended order:

1. keep `DocumentConverter` unchanged in behavior for now
2. extract the shared structural logic into `StructuredDataConverter`
3. prototype `structured` mappings against `Card.back` and `Card.faces`
4. separately enrich `DocumentMapping` subtype support for `RegionBehavior`
5. only then revisit remaining special converters

## Expected Payoff

If this design works:

- `deckCards` becomes much smaller or disappears as a special converter
- `DocumentConverter` becomes conceptually cleaner
- nested structured translations gain a first-class contract
- document-specific runtime semantics remain isolated where they belong
