# FoundryVTT - Babele

Babele is a module for runtime translation of Compendium packs.

Babele obtains translation from configuration files in json format and applies them on the original compendium,
overwriting the mapped properties of the entity in memory without altering the original content, in this way it is not
necessary to keep a compendium copy with the sole purpose of translating their contents.

Since version 1.1 it is possible to provide a mapping of the translated fields, so that you can add different properties
based on the pack you want to translate.

## Installation

To install, follow these instructions:

1. Inside Foundry, select the Game Modules tab in the Configuration and Setup menu.
2. Click the Install Module button and enter the following
   URL: https://gitlab.com/riccisi/foundryvtt-babele/raw/master/module/module.json
3. Click Install and wait for installation to complete.

## Usage Instructions

### Translation File (JSON)

To work properly, the module needs translation files formatted in this way:

```json
{
    "label": "Incantesimi (SRD)",
    "entries": [
        {
            "id": "Haste",
            "name": "Velocità",
            "description": "<p>L'incantatore sceglie ..."
        }
    ]
}
```

Where id must contain the **name** or the **id** of the original entity, while "name" and "description" are the
translations and will be used to overwrite the original property through a **Transation Mapping** config.\
Be careful to correctly enter the original name (or the id) of the entity because Babel will use it to match the
translation to be applied.\
Babel expects and searches (using a naming convention described below) a translation file for each translated
compendium.

Babele supports another format for the translation file, which guarantees greater compatibility
with localization platforms such as Weblate or Transifex.\
With the new format, the list of entries can no longer be declared as an array but as a JSON object, where the id used
for the match with the original entity coincides with the name of the object property and the value with the content of
the translation:

```json
{
    "label": "Incantesimi (SRD)",
    "entries": {
        "Haste": {
            "name": "Velocità",
            "description": "<p>L'incantatore sceglie ..."
        }
    }
}
```

## Translation Mapping

The rules for applying translations to an entity are called **Translation Mapping** (mapping), and can be defined using
a JSON where the property corresponds to the key of the rule and the value corresponds to the path to the entity data
value that will be replaced by the translation.

```json
{
    "description": "data.details.biography.value"
}
```

If they are not configured, Babele applies predefined mappings based on the entity's type of the compendium.\
These default mappings are as follows:

```json
{
    "Adventure": {
        "name": "name",
        "description": "description",
        "caption": "caption",
        "folders": {
            "path": "folders",
            "converter": "nameCollection"
        },
        "journals": {
            "path": "journal",
            "converter": "adventureJournals"
        },
        "scenes": {
            "path": "scenes",
            "converter": "nameCollection"
        },
        "macros": {
            "path": "macros",
            "converter": "nameCollection"
        },
        "playlists": {
            "path": "playlists",
            "converter": "adventurePlaylists"
        },
        "tables": {
            "path": "tables",
            "converter": "tableResultsCollection"
        },
        "items": {
            "path": "items",
            "converter": "fromPack"
        },
        "actors": {
            "path": "actors",
            "converter": "adventureActors"
        },
        "cards": {
            "path": "cards",
            "converter": "adventureCards"
        }
    },
    "Actor": {
        "name": "name",
        "description": "system.details.biography.value",
        "items": {
            "path": "items",
            "converter": "fromPack"
        },
        "tokenName": {
            "path": "prototypeToken.name",
            "converter": "name"
        }
    },
    "Cards": {
        "name": "name",
        "description": "description",
        "cards": {
            "path": "cards",
            "converter": "deckCards"
        }
    },
    "Item": {
        "name": "name",
        "description": "system.description.value"
    },
    "JournalEntry": {
        "name": "name",
        "description": "content",
        "pages": {
            "path": "pages",
            "converter": "pages"
        }
    },
    "Macro": {
        "name": "name"
    },
    "Playlist": {
        "name": "name",
        "description": "description",
        "sounds": {
            "path": "sounds",
            "converter": "playlistSounds"
        }
    },
    "RollTable": {
        "name": "name",
        "description": "description",
        "results": {
            "path": "results",
            "converter": "tableResults"
        }
    },
    "Scene": {
        "name": "name"
    }
}
```

This configuration is provided by default but can also be inserted in the translation files, in order to expand or
overwrite the supported properties.\
Mappigs could be added like this (ex. spells):

```json
{
    "label": "Incantesimi (SRD)",
    "mapping": {
        "flavor": "data.chatFlavor",
        "material": "data.materials.value"
    },
    "entries": [
        {
            "id": "Haste",
            "name": "Velocità",
            "description": "<p>L'incantatore...",
            "flavor": "...",
            "materal": "Una piccola striscia di stoffa bianca."
        },
        ...
```

Babele loads these files from a directory, created in the data path, that must be set in the module configuration, and
associating them with the compendium by the name of the collection (ex. `dnd5e.spells.json`). One file per pack is
required.

Babele applies the translation files _according to the language selected in the settings_. It is therefore **necessary**
to create one subdirectory per language and insert the translation files inside.

It is also possible to distribute translation files within other modules using a provided registration API.
Registration should be done like this:

```javascript
Hooks.on('init', () => {
    if (typeof Babele !== 'undefined') {
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

Directories and modules can be used simultaneously. If the same compendium is present on both places, the directory will
take precedence over the module.

It is possible for system developers to distribute translations made with babele together with the distribution of their
own system. It is sufficient to use the following API to provide Babel with the system directory in which to find,
divided into folders one for each language, the JSON files of the translated compendia:

```javascript
Babele.get().setSystemTranslationsDir("packs/translations");
```

### Use converters

It is possible to map a property value using a `converter`, a function that allows to change the
original data dynamically, instead of using static text.\
A converter is a standard javascript function with the following signature:

```javascript
function converter(value, translations) {
...
}
```

where:

* **value**: the original untranslated propery value.
* **translations**: the full entry list of the translation file.

Converters must be registered in this way:

```javascript
Babele.get().registerConverters({
    "lbToKg": (value) => {
        return parseInt(value) / 2
    }
});
```

and they can be referenced in the mapping:

```json
{
    "label": "Oggetti (SRD)",
    "mapping": {
        "flavor": "data.chatFlavor",
        "weight": {
            "path": "data.weight",
            "converter": "lbToKg"
        }
    }
}
```

#### Included converters

Some converters are already in Babele and can be used for your own needs.

##### `fromPack`

The converter `fromPack` is used to get translation from another pack, by default `Item`.

`Actor` mapping allows automatic translation of owned items based on translations already present in the other
compendiums, as shown below:

```json
{
    "Actor": {
        "name": "name",
        "description": "system.details.biography.value",
        "items": {
            "path": "items",
            "converter": "fromPack"
        },
        "tokenName": {
            "path": "prototypeToken.name",
            "converter": "name"
        }
    }
}
```

The `fromPack` converter also allows you to overwrite any item if the translation from its translated compendium is not
adequate or if some items are present and others are not. To overwrite (or add) owned items translations, simply provide
them as under translation under "items":

```json
{
    "label": "Mostri (SRD)",
    "entries": [
        {
            "id": "Acolyte",
            "name": "Accolito",
            "description": "...",
            "items": [
                {
                    "id": "Club",
                    "name": "Randello dell'accolito",
                    "description": "Il randello dell'accolito è un'arma molto potente..."
                }
            ]
        }
    ]
}
```

In the example above, the "Club" item will be overwritten with the provided custom translation while the one from the
item compendium will be skipped.

The other items not overwritten will be translated by taking the translations from the relative compendium (if any).   
Of course, the transifex-compatible format is also supported:

```json
{
    "label": "Mostri (SRD)",
    "entries": {
        "Acolyte": {
            "name": "Accolito",
            "description": "...",
            "items": {
                "Club": {
                    "name": "Randello dell'accolito",
                    "description": "Il randello dell'accolito è un'arma molto potente..."
                }
            }
        }
    }
}
```

##### `name`

The converter `name` always return the translated name of the actual entity.

In the `Actor` default mapping it’s used to "synchronize" the actor translated name with the token name.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "Acolyte": {
            "name": "Accolito"
        }
    }
}
```

##### `nameCollection`

The converter `nameCollection` works like `name`, but is used for a collection of name.

For example, it’s used in adventures scenes name translation:

```json
{
    "Adventure": {
        ...
        "scenes": {
            "path": "scenes",
            "converter": "nameCollection"
        },
        ...
    }
}
```

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "scenes": {
                "A - Gauntlight Cupola": "A - Coupole de Mornelueur",
                "A - Gauntlight Ruins": "A - Ruines de Mornelueur"
            }
        }
    }
}
```

##### `tableResults`

The `tableResults` converter automatically translate roll table results if they are "entity" from an already translated
compendium while the translations of the text-type elements can be provided in the translation file under the "results"
property, mapped as a key-value where the key corresponds to the associated "range".

For example, considering a table of this type:

<div align="center">

![example0](./rolltable-example.jpg?raw=true)

</div>

The associated JSON translation file could be:

```json
{
    "label": "Tabelle di prova",
    "entries": [
        {
            "id": "Test",
            "name": "Prova",
            "description": "Descrizione tradotta",
            "results": {
                "1-1": "Testo tradotto"
            }
        }
    ]
}
```

Obtaining the following result:

<div align="center">

![example0](./rolltable-example-2.jpg?raw=true)

</div>

As you can see, the text associated with the `1-1` range has been translated by retrieving the content from the file,
while the entities have been automatically translated by retrieving their respective translations from the associated
translated compendiums.

##### `tableResultsCollection`

The converter `tableResultsCollection` works like `tableResults`, but is used for a collection of roll tables.

For example, it’s used in adventures roll tables translation:

```json
{
    "Adventure": {
        ...
        "tables": {
            "path": "tables",
            "converter": "tableResultsCollection"
        },
        ...
    }
}
```

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "tables": {
                "Fetid Lake Encounters": {
                    "name": "Rencontres au lac fétide",
                    "results": {
                        "1-4": "Pas de rencontre",
                        "5-20": "Créatures du lac"
                    }
                },
                "Quiet Lake Encounters": {
                    "name": "Rencontres au lac tranquille",
                    "results": {
                        "1-10": "Pas de rencontre",
                        "11-20": "Créatures du lac"
                    }
                }
            }
        }
    }
}
```

##### `pages`

From version 10, in Foundry, the data structure of the `Journal` has been enriched with pages. Babele supports this new
structure throught the converter `pages`, automatically mapped to the `Journal Document`.

It is therefore possible to translate the pages of a journal using a JSON of this type:

```json
{
    "label": "Regole (SRD)",
    "entries": {
        "Chapter 1: Beyond 1st Level": {
            "name": "Capitolo 1: Oltre il 1° Livello",
            "pages": {
                "Beyond 1st Level": {
                    "name": "Oltre il 1° Livello",
                    "text": "..."
                },
                "Another page": {
                    "name": "Un'altra pagina",
                    "text": "..."
                }
            }
        },
        ...
    }
}
```

As a reference, see the Italian translation of the dnd5e compendium present in the IT translation module:
[https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it](https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it)

In order not to start from scratch, the translation file can also be extracted directly from the compendium interface by
using the button on the window header

##### `adventureJournals`

The converter `adventureJournals` works like `pages`, but is used for journals inside adventures.

For example, it’s used in adventures roll tables translation:

```json
{
    "Adventure": {
        ...
        "journals": {
            "path": "journal",
            "converter": "adventureJournals"
        },
        ...
    }
}
```

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "journals": {
                "Campaign Background": {
                    "name": "Background",
                    "pages": {
                        "Campaign Timeline": {
                            "name": "Chronologie de la campagne",
                            "text": "..."
                        },
                        "Starting point": {
                            "name": "Point de départ",
                            "text": "..."
                        }
                    }
                }
            }
        }
    }
}
```

##### `playlistSounds`

The converter `playlistSounds` is used to translate the sounds of a playlist.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My playlist": {
            "sounds": {
                "First sound": {
                    "name": "My first sound",
                    "description": "..."
                }
            }
        }
    }
}
```

##### `adventurePlaylists`

The converter `adventurePlaylists` is used for playlists inside adventures.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "playlists": {
                "My playlist": {
                    "name": "My edited playlist",
                    "sounds": {
                        "First sound": {
                            "name": "My first sound",
                            "description": "..."
                        }
                    }
                }
            }
        }
    }
}
```

##### `adventureActors`

The converter `adventureActors` is used to translate `Actors` within adventures. The used mapping is the same as
default `Actor`.

As a bonus, when the import of an adventure will be finished, all tokens on the map will be processed in order to update
their name, according to the translation.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "actors": {
                "Bite Bite": {
                    "name": "Bouffe-Bouffe",
                    "tokenName": "Bouffe-Bouffe"
                }
            }
        }
    }
}
```

##### `deckCards`

The converter `deckCards` is used to translate all types of `Cards`.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "Deck of cards": {
            "name": "Translated deck of cards",
            "desription": "...",
            "face": [
                {
                    "name": "First face",
                    "text": "..."
                },
                {
                    "name": "Second face",
                    "text": "..."
                }
            ],
            "back": {
                "name": "Back of the card",
                "text": "..."
            }
        }
    }
}
```

##### `adventureCards`

The converter `adventureCards` works like `deckCards`, but is used for decks inside adventures.

**Example of translation file**

```json
{
    "label": "My translation",
    "entries": {
        "My adventure": {
            "cards": {
                "Deck": {
                    "name": "Translated deck",
                    "cards": {
                        "Card 1": {
                            "name": "Card one",
                            "description": "...",
                            "faces": [
                                {
                                    "name": "Face 1",
                                    "text": "..."
                                },
                                {
                                    "name": "Face 2"
                                }
                            ],
                            "back": {
                                "name": "Back",
                                "text": "..."
                            }
                        },
                        "Card 2": {
                            "name": "Card two"
                        }
                    }
                }
            }
        }
    }
}
```

## Feedback

Every suggestion/feedback are appreciated, if so, please contact me on discord (Simone#6710)

## Acknowledgments

* Thanks to @ariakas81 for the collaboration in the Italian translation of the Dnd 5e SRD.
* Thanks to @Azzurite#2004 for his settings-extender, used in this module.
* Thanks to @tposney#1462 for the valuable tips.

## License

FoundryVTT Babele is a module for Foundry VTT by Simone and is licensed under
a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual
Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).
