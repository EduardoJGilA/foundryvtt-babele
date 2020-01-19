# FoundryVTT - Babele

Babele is a module for runtime translation of Compendium packs.

Babele obtains translation from configuration files in json format and applies them on the original compendium, overwriting the mapped properties of the entity in memory without altering the original content, in this way it is not necessary to keep a compendium copy with the sole purpose of translating their contents.

Since version 1.1 it is possible to provide a mapping of the translated fields, so that you can add different properties based on the pack you want to translate.

## Installation

To install, follow these instructions:

1.  Inside Foundry, select the Game Modules tab in the Configuration and Setup menu.
2.  Click the Install Module button and enter the following URL: https://gitlab.com/riccisi/foundryvtt-babele/raw/master/module/module.json
3.  Click Install and wait for installation to complete.

## Usage Instructions

To work properly, the module needs translation files formatted in this way:

```json
[{
    "label": "Incantesimi (SRD)",
    "entries": [
        { "id": "Haste", "name": "Velocità", "description": "<p>L'incantatore sceglie ..." }
    ]
}]
```

where id must contain the name of the original entity while "name" and "description" are the translations and and will be used to overwrite the original property through a mapping config.
This mapping configuration depends on the type of the entity and by default takes these values:

```json
{
    "Actor": {
        "name": "name",
        "description": "data.details.biography.value"
    },
    "Item": {
        "name": "name",
        "description": "data.description.value"
    },
    "JournalEntry": {
        "name": "name",
        "description": "content"
    }
}
```

This configuration is provided by default but can also be inserted in the translation files, in order to expand or overwrite the supported properties.
Mapppigs could be added like this (ex. spells):
```json
{
    "label": "Incantesimi (SRD)",
    "mapping": {
        "flavor": "data.chatFlavor",
        "material": "data.materials.value"   
    },
    "entries": [{ 
        "id": "Haste", 
        "name": "Velocità", 
        "description": "<p>L'incantatore...", 
        "flavor": "...", 
        "materal": "Una piccola striscia di stoffa bianca." 
    }, 
    ...
```

Babele loads these files from a directory, created in the data path, that must be set in the module configuration, and associating them with the compendium by the name of the collection (ex. dnd5e.spells.json).
One file per pack is required.
Since version 1.1, Babele applies the translation files _according to the language selected in the settings_. It is therefore **necessary** to create one subdirectory per language and insert the translation files inside.

It is also possible to distribute translation files within other modules using a provided registration API.
Registration should be done like this:
```javascript

Hooks.on('init', () => {

    if(typeof Babele !== 'undefined') {
        Babele.get().register({
            module: 'FoundryVTT-dnd5e-it',
            lang: 'it',
            dir: 'compendium'
        });
    }
});

```
where:
* **module**: must be the name of the module (the same inside the module.js file).
* **lang**: the language used for the translation.
* **dir**: the directory inside the module containing the translation files.

Directories and modules can be used simultaneously. If the same compendium is present on both places, the directory will take precedence over the module.

As a reference, see the Italian translation of the dnd5e compendium present in the IT translation module:
[https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it](https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it)

In order not to start from scratch, the translation file can also be extracted directly from the compendium interface by using the button on the window header

## Compatibility

Tested on 0.4.5 version.

## Feedback

Every suggestions/feedback are appreciated, if so, please contact me on discord (Simone#6710)

## Acknowledgments

* Thanks to @ariakas81 for the collaboration in the Italian translation of the Dnd 5e SRD.
* Thanks to @Azzurite#2004 for his settings-extender, used in this module. 
* Thanks to @tposney#1462 for the valuable tips.

## License

FoundryVTT Babele is a module for Foundry VTT by Simone and is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).