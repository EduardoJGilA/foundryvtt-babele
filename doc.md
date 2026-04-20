# Babele

Babele is a module for Foundry VTT that translates compendium content at runtime, without modifying the original data shipped by systems or modules.

This point is central to the way Babele is designed. The original compendium remains the authoritative source, while Babele builds a translated runtime view on top of it. In practice, this means you can localize names, descriptions, embedded documents, folder labels, and pack labels without replacing the underlying JSON or maintaining a fork of the original content.

That makes Babele useful in two different but related scenarios:

- a translation module published for other users
- a private or local translation workflow used only inside one world

This documentation describes the current Babele release line for Foundry VTT `13`.

If you are using an older Babele version, refer to the archived documentation shipped with that release line, because some concepts and APIs have changed significantly over time.

## What Babele Does

Babele is designed for two audiences:

- End users who want to install translation packs and use translated compendiums in Foundry.
- Translators and module/system authors who want to publish those translations.

At runtime, Babele:

- loads translation files and optional mapping files
- builds a translated view of supported compendiums
- translates compendium indexes and loaded documents
- translates compendium folders and pack-group folders
- can export starter translation files from existing compendiums

The important design principle is always the same: Babele does not overwrite the original compendium JSON files shipped by systems or modules. It applies translations as a runtime layer, so the original source stays intact and upgrade-safe.

## Requirements

### End Users

- Foundry Virtual Tabletop `13`
- the `Babele` module installed and enabled
- one or more translation modules, or a local translation directory

### Translators and Publishers

- Foundry Virtual Tabletop `13`
- basic knowledge of Foundry module development
- a text editor for JSON files

## Installation and Basic Use

1. Install and enable `Babele` in your world.
2. Install and enable the translation module you want to use, if any.
3. Set Foundry's language in `Configure Settings > Core > Language`.
4. Open a translated compendium. Babele will translate its index and its documents at runtime.

In the simplest scenario, this is all you need to do. If a translation module has been authored correctly and targets the language currently active in Foundry, Babele will discover it during initialization and start using it automatically.

For end users, this is the most important mental model: Babele is not something you use entry by entry. Once configured, it stays in the background and translates supported compendium content as Foundry loads it.

## User Settings

Babele currently exposes these settings:

- `Translation Files Directory`:
  World setting. A local directory for private translations. This is the main entry point for personal or in-development translation files that are not packaged as a module. When changed by the GM, Babele refreshes its sources and reinitializes itself.
- `Enable Translation Export`:
  World setting. Enables the export action in supported compendium UIs. This is mainly intended for translators and maintainers rather than casual users.
- `Show Original Name`:
  Client setting. Shows the original source-language name next to translated compendium entries. Useful when the table is used by people familiar with both the translated and original terminology.
- `Show Translate Option`:
  Client setting. Shows the on-demand translation action on supported Actor sheets. This is mostly useful when a world already contains Actors imported before the translation environment was fully in place.
- `Warn Missing Paths`:
  Client setting. Enables console warnings when a static mapped field points to a source path that does not exist. This is primarily a debugging aid for translators and integrators.

## Features for End Users

### Compendium Translation

When a compendium has an associated translation file, Babele translates:

- the compendium label, if provided
- folder names inside the compendium, if provided
- compendium index entries
- loaded documents

This means that both the compendium list and the document content itself can be localized, while the underlying source data remains untouched. For the user, the result feels like a translated compendium; for the maintainer, it stays an overlay rather than a replacement.

### Original Name Display and Search

If `Show Original Name` is enabled, Babele displays the original source name next to translated compendium entries.

When Foundry is searching only by entry name, Babele also enriches the search with the original name so users can find entries using either the translated or the original label.

This is especially useful when:

- a GM is used to the original SRD/system terminology
- players are using translated names
- a translation is partial and some entries are still easier to identify by the original wording

In practice, this feature reduces friction at the table. It lets people search and recognize content using the wording that makes sense to them, instead of forcing everyone to adopt the same terminology immediately.

### On-Demand Actor Translation

Babele can translate an already-imported Actor on demand from the sheet UI.

This is useful when an Actor was imported before Babele or before a translation module was enabled.

It is also useful when a world already contains imported content and you want to progressively bring it in line with the current Babele setup instead of re-importing everything.

### Translation Export

Babele can export a starter translation ZIP for a compendium.

Current export behavior:

- default format: `compatible`
- deprecated format: `legacy`
- export can include:
  - all entries
  - only entries already present in the translation file
  - only entries missing from the translation file
- export includes translated folder names when folders are present
- export includes embedded documents when the mapping supports them

The exported ZIP contains a single JSON file named after the compendium collection, for example `dnd5e.spells.json`.

This feature exists to reduce manual setup work. Instead of reconstructing the translation file by hand, the translator starts from a file that already mirrors the compendium structure and already contains the fields Babele expects to translate.

## Translation Sources and Precedence

Babele can load translations from four places:

1. system translations registered programmatically
2. module translations registered programmatically
3. the world `Translation Files Directory`
4. published file lists shared by the GM to clients that cannot browse files directly

Effective precedence is:

1. system translations
2. module translations
3. configured translation directory

Later sources override earlier sources.

That means:

- a translation module can override the system baseline
- the local translation directory can override both the system and translation modules

If the GM can browse files, Babele discovers files directly.
If a player cannot browse files, Babele uses the published file list shared by the GM.

This precedence model is important when you combine:

- a system-level baseline translation
- one or more translation modules
- local overrides in a development or testing environment

In that scenario, Babele always resolves the effective translation deterministically from lowest to highest precedence.

This precedence rule is worth remembering because it explains most override behavior. If a translation seems to come from the “wrong” place, the first thing to check is which source is later in the precedence chain.

## File Naming and Placement

### One Translation File Per Collection

Each translated compendium needs one translation file named after the collection:

```text
dnd5e.spells.json
my-module.adventure.json
pf2e.actions.json
```

### Local Translation Directory

If you use the world setting `Translation Files Directory`, the directory must be structured like this:

```text
translations/
  mappings.json
  it/
    dnd5e.spells.json
    dnd5e.items.json
    dnd5e._packs-folders.json
  fr/
    dnd5e.spells.json
```

Rules:

- translation files live under the current language subdirectory
- the global mapping file lives at the root of the configured directory
- the canonical global mapping filename is `mappings.json`
- the old filename `mapping.json` is still recognized but deprecated

This local directory is ideal when:

- you are translating content only for your own world
- you want to test a translation before packaging it as a module
- you need temporary overrides over an existing published translation

It is essentially the most convenient place for experimentation. You can export, translate, test, adjust mappings, and iterate quickly without packaging a module every time.

### Translation Module Registration

Modules register their translation directory programmatically, typically during `babele.init`:

```javascript
Hooks.once("babele.init", (babele) => {
  babele.register({
    module: "my-translation-module",
    lang: "it",
    dir: "compendium/it"
  });
});
```

Important:

- `dir` is used as-is
- Babele does not automatically append a language subdirectory for module sources
- `lang` must match the current Foundry language for the source to be active

In other words, module authors are responsible for exposing the correct directory structure. Babele does not try to infer alternative layouts for module translations, because explicit registration is more predictable than guesswork.

### System Translation Registration

Systems can register their own built-in translation directory:

```javascript
Hooks.once("babele.init", (babele) => {
  babele.setSystemTranslationsDir("babele");
});
```

With that configuration, Babele looks for:

```text
systems/my-system/babele/mappings.json
systems/my-system/babele/it/dnd5e.spells.json
```

System translations are the baseline and have the lowest normal precedence.

This makes them a good place for built-in translations maintained by the system itself, while still allowing modules and local directories to override them when necessary.

## Translation File Format

The canonical format is an object keyed by translation key:

```json
{
  "label": "Spells",
  "folders": {
    "Level 1": "1st Level"
  },
  "mapping": {
    "description": "system.description.value"
  },
  "entries": {
    "Magic Missile": {
      "name": "Dardo Incantato",
      "description": "<p>Three glowing darts...</p>"
    }
  }
}
```

Top-level keys:

- `label`:
  Optional translated label for the compendium.
- `folders`:
  Optional object for folders inside the compendium.
- `mapping`:
  Optional compendium-local mapping override or extension.
- `entries`:
  Required for actual document translations. Contains one translation object per translated document.
- `reference`:
  Optional advanced field. Declares one or more translated packs that can be used as fallback sources for the same document.
- `types`:
  Optional advanced field. Restricts the file to specific semantic subtypes inside the same Foundry document class, for example only some `Item` types.

For most translation files, the essential parts are just `entries` and, when needed, `mapping`. The other top-level keys are optional refinements that become useful in more advanced scenarios such as fallback lookup, subtype restriction, folder translation, or local mapping adjustments.

### Canonical vs Legacy `entries`

Canonical format:

```json
{
  "entries": {
    "Magic Missile": {
      "name": "Dardo Incantato"
    }
  }
}
```

Legacy format, still supported but deprecated:

```json
{
  "entries": [
    {
      "id": "Magic Missile",
      "name": "Dardo Incantato"
    }
  ]
}
```

Use the canonical object format for all new work. It is the default export format and works better with modern translation tooling.

The object format is also easier to review and maintain over time, especially when the translation is managed in Git or synchronized through platforms such as Weblate or Transifex.

## Translation Keys and Matching

By default, Babele resolves a translation entry using this order:

1. `_id`
2. `name`
3. `sourceId`

Practical guidance:

- use `name` when it is unique and stable enough for your workflow
- use `_id` when collisions are possible or when exact matching matters
- `sourceId` is also considered automatically during lookup

If a translation module or integration needs more advanced disambiguation, developers can register custom translation match strategies.

This lookup order gives a good balance between readability and precision:

- `name` is friendlier for translators
- `_id` is safer when collisions are possible
- `sourceId` helps in situations where the logical identity survives better than the visible label

There is no single perfect key for every workflow. Babele deliberately supports more than one identity signal because translators often value readability, while runtime matching sometimes requires something stricter.

## Folder Translation Files

Foundry has two different folder concepts:

- folders inside a compendium
- top-level folders used to group compendiums in the sidebar

The `folders` object inside a normal translation file is for folders inside that compendium.

Top-level compendium-group folders use a special file named:

```text
[package-id]._packs-folders.json
```

Example:

```json
{
  "entries": {
    "Character Building": "Creazione del Personaggio",
    "Roll Tables": "Tabelle Casuali"
  }
}
```

This file translates the folder names used to group packs for the matching system or module.

## Mapping Basics

Babele translates only the fields declared by a mapping.

A mapping associates a translation key with a source path or with a converter configuration.

Simple static example:

```json
{
  "mapping": {
    "description": "system.description.value",
    "materials": "system.materials.value"
  }
}
```

In this example:

- the translation file stores `description`
- Babele reads and writes `system.description.value` in the original document

Mappings are the core of how Babele works. Translation files do not magically know where a value comes from in the original Foundry document: the mapping defines that relationship explicitly.

This is one of the most important ideas in the whole module. A translation file says what the translated value is; the mapping says where that value belongs in the source document.

### Where Mappings Can Be Defined

Mappings can come from three places:

1. Babele built-in defaults
2. global mapping layers from `mappings.json`
3. compendium-local `mapping` inside a translation file

Merge order is:

1. built-in defaults
2. registered and loaded global mappings
3. compendium-local mapping

Compendium-local mappings are the most specific and win last.

This layered model lets you keep most behavior global and reusable while still handling one-off cases in a single compendium when needed. In practice, this means you can define sane defaults once, then refine only the cases that actually need special treatment.

### Global `mappings.json`

The canonical global mapping file is named `mappings.json`.

Example:

```json
{
  "Item": {
    "description": "system.description.value",
    "source": "system.source"
  },
  "Actor": {
    "biography": "system.details.biography.value"
  }
}
```

This enriches the default mapping for all compendiums of those document types.

### Subtype Mappings

Some Foundry document classes have semantic subtypes, for example `Item.weapon` or `RegionBehavior.teleportToken`.

Babele supports subtype-specific mapping keys directly in `mappings.json`:

```json
{
  "Item": {
    "description": "system.description.value"
  },
  "Item.weapon": {
    "damage": "system.damage.base"
  }
}
```

Subtype mappings behave like inheritance:

- the subtype starts from the base document mapping
- subtype-specific fields are added or overridden on top of it

This is especially important in systems where one Foundry document class, such as `Item`, can represent many semantically different things with different translatable fields.

## Built-In Coverage

Babele ships with built-in default mappings for these document classes:

- `Adventure`
- `Actor`
- `Cards`
- `Card`
- `Folder`
- `Item`
- `JournalEntry`
- `JournalEntryPage`
- `Macro`
- `Playlist`
- `PlaylistSound`
- `RollTable`
- `TableResult`
- `Scene`
- `Region`
- `RegionBehavior`

Some of them also define subtype mappings, for example:

- `RegionBehavior.displayScrollingText`
- `RegionBehavior.teleportToken`

For the exact shipped defaults, inspect `module/script/mapping/default-mappings.js` in the Babele source.

## Converter-Based Field Mappings

Static string paths are enough for simple string fields.

Use a converter when the translated field is:

- an embedded Foundry document or collection of documents
- a nested structured value object
- a special legacy case still supported by Babele

Converter mappings use an object instead of a string:

```json
{
  "items": {
    "path": "items",
    "converter": "document",
    "documentType": "Item",
    "cardinality": "many"
  }
}
```

### `document` Converter

Use `document` for embedded Foundry documents.

Supported parameters:

- `path`:
  Source path in the parent document.
- `converter`:
  Must be `"document"`.
- `documentType`:
  The embedded Foundry document class, for example `Item`, `JournalEntryPage`, `TableResult`, `PlaylistSound`.
- `cardinality`:
  `"many"` or `"one"`.
- `mapping`:
  Optional embedded mapping override. It is merged with the canonical mapping for that document type, not replaced.
- `expose`:
  Optional advanced flag. Defaults to `false`. Controls whether the embedded runtime pack is exposed for sibling lookup during translation.

Example:

```json
{
  "Actor": {
    "items": {
      "path": "items",
      "converter": "document",
      "documentType": "Item",
      "cardinality": "many",
      "mapping": {
        "rarity": "system.rarity"
      }
    }
  }
}
```

This is the modern way to express “this field contains other documents that should be translated according to their own document type and mapping”. It replaces much of the older ad-hoc converter logic with a more uniform model.

### `structured` Converter

Use `structured` for nested plain objects that are not Foundry documents.

Supported parameters:

- `path`
- `converter`: must be `"structured"`
- `cardinality`: `"many"` or `"one"`
- `mapping`: local field mapping for the nested structure
- `key`: optional key used when the translation object is keyed by one property of each nested object
- `compact`: optional flag used when exporting arrays and omitting empty extracted entries

Example:

```json
{
  "Card": {
    "faces": {
      "path": "faces",
      "converter": "structured",
      "cardinality": "many",
      "compact": true,
      "mapping": {
        "img": "img",
        "name": "name",
        "text": "text"
      }
    }
  }
}
```

Use `structured` when the nested value has a clear internal structure but is not itself a real Foundry `Document`.

### Legacy Converter Names

Babele still accepts a set of compatibility converter names for existing translations and custom mappings:

- `fromPack`
- `name`
- `nameCollection`
- `textCollection`
- `pages`
- `tableResults`
- `tableResultsCollection`
- `sceneRegions`

They are still supported, but new mappings should prefer the generic modern converters:

- `document`
- `structured`

The legacy names remain available to avoid breaking older translation packs, but they should be considered compatibility shims rather than the preferred modeling approach. When starting new work, prefer describing the data shape clearly with `document` or `structured`.

## Validation and Fail-Open Behavior

Babele is intentionally defensive.

### Static Fields

For a static field mapping:

- if the source path does not exist, Babele skips the field
- if `Warn Missing Paths` is enabled, it also logs a warning
- if the translated payload changes the structural type of the source value, Babele skips the field

This means:

- a source string must stay a string
- a source number must stay a number
- a source boolean must stay a boolean
- you should not inject arbitrary object trees into a static field just because the JSON shape happens to allow it

If you need nested objects or nested document collections, use a converter.

This defensive behavior is intentional. Babele is not meant to be used as a blunt JSON replacement tool; it is meant to localize known translatable fields while preserving the overall document structure.

### Dynamic Fields

For converter-based fields:

- missing converters fail open
- converter failures fail open
- unsupported dynamic export fields are skipped during export and logged in the console

So when something goes wrong, Babele prefers to leave the original value untouched instead of corrupting the document or throwing a hard failure in normal use. In other words, Babele tries to fail open and preserve playability.

## Multiple Files for the Same Collection

Babele supports multiple translation sources contributing to the same compendium collection.

When that happens:

- files are loaded in source precedence order
- `entries`, `mapping`, and `folders` are merged
- later sources override earlier keys

Practical recommendation:

- keep collection-level metadata such as `label`, `reference`, and `types` in one place
- use later sources only to extend or override translations and mappings intentionally

This feature is powerful, but it should be used deliberately. If too many layers override the same collection, the final result becomes harder to reason about, review, and debug.

## Advanced Fields: `reference` and `types`

### `reference`

`reference` declares one or more translated packs that may provide fallback translations for the same document.

Example:

```json
{
  "reference": ["dnd5e.items"]
}
```

This is useful when a pack contains embedded or repeated content that can also be translated by another translated pack.

### `types`

`types` restricts the translation file to a subset of semantic subtypes inside the same Foundry document class.

Example:

```json
{
  "types": ["weapon", "spell"]
}
```

This is an advanced feature and is mainly useful when one translation file is intended to cover only part of an `Item` or similar collection.

## Programmatic API for Translators and Integrations

Babele exposes `game.babele` as its public API.

Important lifecycle rule:

- all `register*` customizations should happen before `game.babele.init()`
- if the runtime configuration changes after initialization, the correct approach is to rebuild Babele through `reinitialize()` or `refreshTranslationSources()`, not to mutate live runtime objects in place

This lifecycle rule is important. Babele builds an internal coherent translation state during initialization. If you change the configuration later, the correct mental model is “rebuild the state from scratch”, not “patch the already built runtime objects”.

### Public Registration APIs

These are the main public extension points:

```javascript
Hooks.once("babele.init", (babele) => {
  babele.register({module: "my-module", lang: "it", dir: "compendium/it"});
  babele.setSystemTranslationsDir("babele");
  babele.registerMapping({
    Item: {
      rarity: "system.rarity"
    }
  });
  babele.registerConverter("myConverter", myConverter);
  babele.registerTranslationMatchStrategy(myStrategy);
  babele.registerIdentityExtractor("range", myExtractor);
});
```

### Custom Translation Match Strategies

Custom strategies extend how translation entries are matched.

Strategy shape:

```javascript
{
  name: "entry-type",
  keyFor(data, context) {
    return null;
  },
  matches(data, key, entry, context) {
    return context.documentType === "Item" && entry.type === data?.type;
  }
}
```

Notes:

- custom strategies are evaluated before the built-in `_id`, `name`, and `sourceId` strategies
- they are meant for advanced cases such as name collisions that also require another semantic discriminator

For example, this can be useful in systems where two `Item` entries share the same visible name but differ by semantic subtype or some other identifying property.

### Custom Identity Extractors

Identity extractors can be referenced from mappings through `_identity`.

Example:

```json
{
  "TableResult": {
    "_identity": {
      "export": ["range", "_id"],
      "match": ["_id", "range"]
    },
    "description": "description"
  }
}
```

The built-in `range` extractor is already registered by Babele and is used by default for `TableResult`.

### Custom Converters

`registerConverter()` accepts either:

- a function-based converter
- a converter object

Function-based converters are the lightest option and remain fully supported. They are a good fit for straightforward value transformations where a full object would add no real value.

Example:

```javascript
function metersToFeet(value) {
  return typeof value === "number" ? value * 3.28084 : value;
}
```

Converter objects are more appropriate when the converter needs optional lifecycle hooks such as preparation or export.

Preferred object contract:

```javascript
const myConverter = {
  translate(context) {
    return context.value;
  },
  prepare(context) {
    return undefined;
  },
  extract(context) {
    return context.value;
  }
};
```

The `context` object contains:

- `value`: current field value
- `translation`: translation fragment for that field
- `source`: current source document
- `field`: translation field name
- `path`: mapped source path
- `params`: the full field mapping declaration
- `allTranslations`: full translation payload for the current document
- `contextCompendium`: current mapped compendium
- `runtime`: current runtime scope

Use a function when the job is simply “take a value and return another value”.
Use an object when you also need `prepare` and/or `extract`.

In general, custom converters should be reserved for cases where a plain mapping path or the built-in `document` / `structured` converters are not expressive enough. If a built-in converter already models the data honestly, use it instead of creating a custom one.

## Recommended Workflow for Translation Modules

1. Decide the target language and compendiums to support.
2. Register your translation source in `babele.init`.
3. Export starter files from Foundry when useful.
4. Translate the exported entries in canonical format.
5. Add `mappings.json` only when the built-in defaults are not enough.
6. Use `document` or `structured` converters for nested data instead of encoding whole source JSON structures directly in translation files.
7. Test in Foundry with the target language active.
8. If settings or file sources change after initialization, rebuild Babele instead of expecting live mutation.

This workflow tends to scale well because it starts from the simplest possible setup and adds complexity only where the data actually requires it.

## Practical Recommendations

- Prefer the canonical object format for `entries`.
- Prefer `name` keys for readability when they are unique enough.
- Switch to `_id` when ambiguity exists.
- Keep translation values structurally compatible with the source data.
- Prefer generic converters over legacy shorthand converters in new mappings.
- Keep advanced metadata such as `reference` and `types` centralized rather than spread across multiple source files.
- Treat `mappings.json` as a global layer and per-pack `mapping` as the local final override.

Following these conventions will make your translation packs easier to understand, easier to maintain, and less fragile when Foundry systems evolve.

## Summary

Babele's current model is:

- translation sources are discovered and merged by precedence
- mappings are layered and resolved by document type and subtype
- translations are applied at runtime through mapped compendiums
- embedded documents are translated through the same model using the `document` converter
- configuration is registered before initialization, while runtime changes are handled by full rebuilds

If you keep those five ideas in mind, most of Babele's behavior becomes predictable. That is the current contract to target when publishing or maintaining translations for Foundry VTT with Babele.
