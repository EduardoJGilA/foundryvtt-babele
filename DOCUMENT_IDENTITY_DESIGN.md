# Document Identity Design

Last updated: 2026-04-17

## Goal

Model, in one place, the external identity that Babele uses for a translated
 document:

- how a translation entry key is chosen during export
- which keys are valid during translation lookup
- how document-type-specific identity rules extend the generic defaults

Today this logic is split across:

- `TranslationResolver`
- `ExportKeys`
- a few special converters such as `tableResults`

This document proposes a single source of truth centered on `DocumentMapping`.

## Problem

There are three related but currently disconnected concerns:

1. document identity policy
2. translation lookup
3. export key allocation

Those concerns overlap but are not identical.

### 1. Document identity policy

For a given `DocumentType`, Babele should know:

- what the preferred translation-file key is
- which alternative keys are acceptable when matching an existing translation

Examples:

- `Item`: usually `_id`, `name`, `sourceId`
- `TableResult`: `_id` and `rangeKey`

### 2. Translation lookup

Given a runtime document and a translation payload, Babele must resolve the
 best matching translation entry.

Today this is handled by `TranslationResolver`.

### 3. Export key allocation

Given an original document, Babele must choose the key written into the
 exported translation JSON.

Today this is handled by `ExportKeys`, which also resolves collisions.

## Design Direction

The identity policy should belong to `DocumentMapping`, because it is part of
 the translation model for that `DocumentType`.

`DocumentMapping` already answers:

- which fields are translatable
- how subtype-specific mappings are resolved

It should also answer:

- which identity keys belong to this document type

## Proposed Object Model

### `DocumentMapping`

`DocumentMapping` remains the main translation model for one `DocumentType`.

It gains a new collaborator:

- `DocumentIdentity`

Responsibilities:

- own field mappings
- own subtype field mappings
- own identity policy

### `DocumentIdentity`

New value object that describes the translation identity of a `DocumentType`.

Responsibilities:

- produce the ordered list of candidate match keys for a document
- produce the preferred export key candidate
- expose the fallback order used when collisions happen

Non-responsibilities:

- searching translation payloads
- allocating collision-safe synthetic keys
- translating fields

### `TranslationResolver`

`TranslationResolver` should stop defining identity policy internally.

Responsibilities after the refactor:

- consume candidate keys from `DocumentIdentity`
- resolve the matching translation entry
- still support externally registered custom match strategies

### `ExportKeys`

`ExportKeys` should stop deciding which document key is canonical.

Responsibilities after the refactor:

- consume export key candidates from `DocumentIdentity`
- guarantee uniqueness inside the current export scope
- fall back to synthetic keys only when all identity candidates collide or are missing

## Proposed Contracts

### `DocumentIdentity`

Minimal contract:

```js
class DocumentIdentity {
  exportCandidates(document) {}
  matchCandidates(document) {}
}
```

Where:

- `exportCandidates(document)` returns an ordered array of candidate keys for export
- `matchCandidates(document)` returns an ordered array of candidate keys for lookup

The arrays:

- contain strings only
- are already filtered for missing or empty values
- may differ in order between export and lookup

This keeps the contract explicit and small.

### Why candidates instead of one key

Because export and lookup both need ordered fallback behavior.

Examples:

- export may prefer `name`, then `_id`
- lookup may prefer `_id`, then `name`, then `sourceId`
- `TableResult` may export with `rangeKey`, then `_id`

Returning candidate lists keeps the policy centralized without overloading
 downstream components.

## Mapping Shape Proposal

The identity policy should be declared alongside the field mapping.

One possible shape:

```js
"Item": {
  "_identity": {
    "export": ["name", "_id"],
    "match": ["_id", "name", "sourceId"]
  },
  "name": "name",
  "description": "system.description.value"
}
```

For `TableResult`:

```js
"TableResult": {
  "_identity": {
    "export": ["range", "_id"],
    "match": ["_id", "range"]
  },
  "name": "name",
  "description": "description"
}
```

This is intentionally declarative.

## Identity Tokens

The values inside `_identity.export` and `_identity.match` should not be raw
 arbitrary code. They should be resolved through a small registry of known key
 extractors.

Examples:

- `_id`
- `name`
- `sourceId`
- `range`

This keeps the config expressive but bounded.

### Built-in identity extractors

Initial built-in extractors:

- `_id`
- `id`
- `name`
- `sourceId`

Definitions:

- `_id`: `document._id`
- `id`: `document.id`
- `name`: `document.name`
- `sourceId`: normalized from `flags.core.sourceId` or `_stats.compendiumSource`

### Registered identity extractors

Document-type-specific or domain-specific identities should be registered in
 the identity extractor registry rather than promoted to built-ins.

Example:

- `range`: `"{start}-{end}"` when `document.range` is a valid ascending pair

This keeps the core bounded to truly generic identities while still letting
 `DocumentMapping` declare richer document-specific identity policies.

## Default Policy

If a `DocumentMapping` does not define `_identity`, Babele should use the
 current generic defaults.

Recommended default:

- export candidates: `["name", "_id", "id"]`
- match candidates: `["_id", "name", "sourceId"]`

This preserves current behavior for most existing document types.

## Subtype Policy

Subtype-specific mappings should be able to refine identity when needed.

Example:

```js
"TableResult.document": {
  "_identity": {
    "match": ["_id", "range"]
  }
}
```

However, subtype identity should be optional.

The resolution order should mirror field mappings:

1. base `DocumentType` identity
2. default subtype identity
3. custom subtype identity

If no subtype identity exists, inherit the base identity unchanged.

## Proposed `DocumentMapping` API

New methods:

```js
identity(data) {}
exportKeyCandidates(data) {}
matchKeyCandidates(data) {}
```

Behavior:

- `identity(data)` returns the effective `DocumentIdentity` for the document subtype
- `exportKeyCandidates(data)` delegates to `identity(data).exportCandidates(data)`
- `matchKeyCandidates(data)` delegates to `identity(data).matchCandidates(data)`

This keeps consumers from knowing about subtype resolution internals.

## Proposed `TranslationResolver` Integration

Current state:

- `TranslationResolver` owns default key resolution logic
- custom strategies may replace the built-in behavior too aggressively

Proposed state:

1. ask the current `DocumentMapping` for `matchKeyCandidates(document)`
2. try direct key matches in order
3. run custom registered match strategies
4. return empty match

This means built-in direct key matching becomes data-driven by `DocumentIdentity`.

### Note on custom strategies

Global custom strategies should no longer replace the default candidate-based
 resolution model.

They should enrich it.

Recommended order:

1. direct candidate key lookup from `DocumentIdentity`
2. custom global strategies
3. optional final built-in heuristics, if still needed

## Proposed `ExportKeys` Integration

Current state:

- `ExportKeys` chooses `name`, then `_id`, then `id`

Proposed state:

1. ask `DocumentMapping` for `exportKeyCandidates(document)`
2. return the first non-colliding candidate
3. if all candidates collide or are absent, generate a synthetic fallback

Example:

```js
keys.keyFor(document, mapping)
```

Where:

- `mapping.exportKeyCandidates(document)` provides the identity policy
- `allocator` only ensures uniqueness

This keeps export collision handling separate from identity definition.

## `TableResult` Example

### Data

```js
{
  _id: "result-1",
  type: "text",
  range: [1, 1],
  description: "<p>Wolf</p>"
}
```

### Mapping

```js
"TableResult": {
  "_identity": {
    "export": ["range", "_id"],
    "match": ["_id", "range"]
  },
  "name": "name",
  "description": "description"
}
```

### Export

- first candidate: `"1-1"`
- fallback: `"result-1"`

### Lookup

The translation entry may be found by:

- `_id`
- range key

This absorbs the current `tableResults` identity logic without keeping it in a
 dedicated special converter.

## `Item` Example

### Mapping

```js
"Item": {
  "_identity": {
    "export": ["name", "_id"],
    "match": ["_id", "name", "sourceId"]
  },
  "name": "name",
  "description": "system.description.value"
}
```

### Effect

- export prefers human-readable keys
- lookup remains deterministic and stable

This matches the current mental model without special-case code.

## What This Design Does Not Solve

This identity refactor does not by itself solve:

- deriving a field value from a referenced document, such as `TableResult.name`
  from `documentUuid`
- legacy shorthand payloads where a translation entry string means
  `"description"`
- arbitrary semantic matching rules beyond declared identity candidates

Those are separate concerns.

## Follow-up Work for `TableResult`

After identity is centralized, `RollTable.results` can move much closer to the
 generic `document` converter.

Remaining special behavior to isolate separately:

1. `name` fallback from `documentUuid`
2. legacy string payload compatibility

This suggests:

- `TableResult` should become a normal `DocumentMapping`
- `RollTable.results` should use `converter: "document"`
- the old `tableResults` converter can survive only as a compatibility alias

## Migration Strategy

Recommended incremental path:

1. introduce `DocumentIdentity`
2. make `DocumentMapping` own identity
3. teach `TranslationResolver` to consume identity candidates
4. teach `ExportKeys` to consume identity candidates
5. move `TableResult` to `DocumentMapping`
6. keep `tableResults` as a legacy alias until the refactor is validated

This keeps risk controlled and lets the identity model be verified before the
 entire `RollTable` stack is rewritten.
