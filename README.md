# FoundryVTT - Babele

Babele is a module for runtime translation of Compendium packs.
Babele obtains translation from configuration files in json format and applies them on the original compendium, overwriting the name and description of the entity in memory without altering the original content, in this way it is not necessary to keep a compendium copy with the sole purpose of translating their contents.

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
where id must contain the name of the original entity while name and description are the translations.

Babele loads these files from a directory, created in the data path, that must be set in the module configuration, and associating them with the compendium by the name of the collection (ex. dnd5e.spells.json).
One file per pack is required.

As a reference, see the Italian translation of the dnd5e compendium present in the translations/IT directory of this project.

## Compatibility

Tested on 0.4.3 version.

## Feedback

Every suggestions/feedback are appreciated, if so, please contact me on discord (Simone#6710)

## Acknowledgments

* Thanks to @ariakas81 for the collaboration in the Italian translation of the Dnd 5e SRD.
* Thanks to @Azzurite#2004 for his settings-extender, used in this module. 

## License

FoundryVTT Babele is a module for Foundry VTT by Simone and is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).
