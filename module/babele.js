
Hooks.once('init', () => {

    game.settings.register('babele', 'directory', {
        name: 'Translations Files Directory',
        hint: 'Enter the directory where the compendium\'s translation files are located',
        type: window.Azzu.SettingsTypes.DirectoryPicker,
        default: ' ',
        scope: 'world',
        config: true,
        onChange: directory => {
            window.location.reload();
        }
    });
});

Hooks.once('setup', () => {

    Babele.get().instrument();
    game.babele = Babele.get();
});

/**
 *
 */
class Converters {

    static fromPack(mapping, entityType = 'Item') {
        let dynamicMapping = new CompendiumMapping(entityType, mapping);
        return function(items, translations) {
            return items.map(data => {

                let translation = translations ? translations.find(t => t.id === data._id || t.id === data.name) : null;
                if(translation) {
                    let translatedData = dynamicMapping.map(data, translation);
                    return mergeObject(data, mergeObject(translatedData, { translated: true }));
                }

                let pack = game.packs.find(pack => pack.translated && pack.hasTranslation(data));
                if(pack) {
                    return pack.translate(data);
                }
                return data;
            });
        }
    }
}

class Babele {

    static get SUPPORTED_PACKS() {
        return ['Actor', 'Item', 'JournalEntry'];
    }

    static get DEFAULT_MAPPINGS() {
        return {
                "Actor": {
                "name": "name",
                "description": "data.details.biography.value",
                "items": {
                    "path": "items",
                    "converter": "fromPack"
                }
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
    }

    static get() {
        if(!Babele.instance) {
            Babele.instance = new Babele();
        }
        return Babele.instance;
    }

    constructor() {
        this.modules = [];
        this.converters = {};
        this.translations = null;
        this.registerDefaultConverters();
    }

    /**
     * Register the default provided converters.
     */
    registerDefaultConverters() {
        this.registerConverters({
            "fromPack": Converters.fromPack()
        })
    }

    /**
     * Apply the aspects on the necessary game pointcuts.
     */
    instrument() {
        game.initializePacks = this.initializePacks();
    }

    /**
     *
     * @param module
     */
    register(module) {
        this.modules.push(module);
    }

    /**
     *
     * @param converters
     */
    registerConverters(converters) {
        this.converters = mergeObject(this.converters, converters);
    }

    /**
     *
     * @param pack
     * @returns {boolean}
     */
    supported(pack) {
        return Babele.SUPPORTED_PACKS.includes(pack.entity);
    }

    /**
     * Decoration (aspect) of the original initializePacks.
     * Decorate the original compendiums with the Babele translated compendiums after downloading the translated files.
     *
     * @returns {function(*=): *}
     */
    initializePacks() {
        let original = game.initializePacks;
        let me = this;
        return async function () {
            await original.apply(game, arguments);
            if(!me.translations) {
                me.translations = await me.loadTranslations();
            }
            let newpack = [];
            game.packs.forEach((pack, idx) => {
                let new_compendium = pack;
                if(me.supported(pack)) {
                    let translation = me.translations.find(t => t.collection === pack.collection);
                    if(translation) {
                      new_compendium = new TranslatedCompendium(pack, translation);
                    } else {
                      new_compendium = new DecoratedCompendium(pack);
                    }
                }
                newpack.push( [idx, new_compendium] );
            });
            game.packs = new Collection(newpack);
        }
    }

    /**
     *
     * @returns {Promise<[]>}
     */
    async loadTranslations() {
        const lang = game.settings.get('core', 'language');
        const directory = game.settings.get('babele', 'directory');
        const directories = this.modules
            .filter(module => module.lang === lang)
            .map(module => `modules/${module.module}/${module.dir}`);

        if(directory && directory.trim()) {
            directories.push(`${directory}/${lang}`);
        }

        let allTranslations = [];
        const keys = game.packs.keys()
        for (const key of keys) {
          let pack = game.packs.get( key );
          if(this.supported(pack)) {
              console.log("Translation loaded", key, pack);
              const urls = directories.map(directory => `${directory}/${pack.collection}.json`);
              const [translations] = await Promise.all(
                  [Promise.all(urls.map((url) => fetch(url).then((r) => r.json()).catch(e => {})))]
              );

              let translation;
              translations.forEach(t => {
                if(t) {
                  translation = t; // the last valid
                }
              });
              if(translation) {
                console.log(`Babele | Translation for ${pack.collection} pack successfully loaded`);
                allTranslations.push(mergeObject(translation, { collection: pack.collection }));
              }
              //console.log(`Babele | No translations files for ${pack.collection} pack found in ${directory} directory`)
            }
        };
        return allTranslations;
    }

    importCompendium(folderName, compendiumName) {
        let compendium = game.packs.find(p => p.collection === compendiumName);
        let folder = game.folders.entities.filter((f) => f.data.name === folderName)[0];
        if (compendium && folder) {
            compendium.getIndex().then(index => {
                index.forEach(entity => {
                    compendium.getEntity(entity.id)
                        .then(entity => {
                            console.log(entity.data);
                            if (!entity.data.translated) {
                                entity.constructor.create(
                                    mergeObject(entity.data, {
                                        folder: folder.id
                                    }),
                                    {displaySheet: false}
                                ).then(
                                    e => {
                                        e.setFlag('world', 'name', entity.data.name);
                                        console.log(e);
                                    }
                                );
                            }
                        })
                        .catch(err => {
                            console.error(`Unable import entity... ${err}`);
                        });
                });
            });
        }
    }
}

class FieldMapping {

    constructor(field, mapping) {
        this.field = field;
        if(typeof mapping === "object") {
            this.path = mapping["path"];
            this.converter = Babele.get().converters[mapping["converter"]];
        } else {
            this.path = mapping;
            this.converter = null;
        }
    }

    map(data, translations) {
        let map = {};
        let value = this.converter ? this.converter(this.extract(data), translations[this.field]) : translations[this.field];
        if(value) {
            this.path.split('.').reduce((a,f,i,r) => { a[f] = (i<r.length-1) ? {} : value; return a[f]; }, map);    
        }
        return map;    
    }

    extract(data) {
        return this.path.split('.').reduce((o, k) => {return o && o[k]; }, data); 
    }
}

class CompendiumMapping {

    constructor(entityType, mapping) {
        this.mapping = mergeObject(Babele.DEFAULT_MAPPINGS[entityType], mapping || {});
    }

    map(originalData, translatedData) {
        let mapped = {};
        Object.keys(this.mapping).forEach(key => {
            let field = new FieldMapping(key, this.mapping[key]);
            mapped = mergeObject(mapped, field.map(originalData, translatedData));
        });
        return mapped;
    }

    extract(entity) {
        let data = {};
        Object.keys(this.mapping).forEach(key => {
            let field = new FieldMapping(key, this.mapping[key]);
            data[key] = field.extract(entity.data);
        });
        return data;
    }

}

class DecoratedCompendium extends Compendium {

    constructor(pack, mapping) {
        super(pack.metadata, pack.options);
        this.decorated = true;
        this.pack = pack;
        this.metadata = pack.metadata;
        this.locked = pack.locked;
        this.private = pack.private;
        this.mapping = new CompendiumMapping(pack.entity, mapping);
    }

    get title() {
        return this.pack.title;
    }

    get collection() {
        return this.pack.collection;
    }

    get entity() {
        return this.pack.entity;
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons.unshift({
            label: "translations",
            class: "import",
            icon: "fas fa-download",
            onclick: ev => {
                this.exportTranslationsFile();
            }
        });
        return buttons;
    }


    async exportTranslationsFile() {
        let file = {
            label: this.metadata.label,
            entries: []
        };

        let index = await this.pack.getIndex();
        Promise.all(index.map(entry => this.getEntity(entry._id))).then(entities => {
            entities.forEach((entity, idx) => {
                let entry = mergeObject({ id: index[idx].name }, this.mapping.extract(entity));
                file.entries.push(entry);
            });

            let dataStr = JSON.stringify(file, null, '\t');
            let exportFileDefaultName = this.collection + '.json';

            var zip = new JSZip();
            zip.file(exportFileDefaultName, dataStr);
            zip.generateAsync({type:"blob"})
                .then(content => {
                    saveAs(content, this.collection + ".zip");
                });
        });
    }
}

class TranslatedCompendium extends DecoratedCompendium {

    constructor(pack, translations) {
        super(pack, translations.mapping);
        pack.metadata = mergeObject(pack.metadata, { label: translations.label });
        this.translations = [];
        this.translated = true;
        translations.entries.forEach(t => {
          this.translations[t.id] = t;
        });
    }

    i18nName(idx) {
      let translation = this.translations[idx._id] || this.translations[idx.id] || this.translations[idx.name] || { name: idx.name };
      return translation.name;
    }

    getIndex() {
        return new Promise((resolve, reject) => {
            this.pack.getIndex().then(index => {
                this.index = index
                    .map(idx => mergeObject(idx, { name: this.i18nName(idx) }))
                    .sort((a, b) => {
                        if (a.name < b.name)
                            return -1;
                        if (a.name > b.name)
                            return 1;
                        return 0;
                    });
                resolve(this.index);
            });
        });
    }

    hasTranslation(data) {
        return !!this.translations[data._id] || !!this.translations[data.name];
    }

    translate(data) {
        let translatedData = this.mapping.map(data, this.translations[data._id] || this.translations[data.name] || {});
        return mergeObject(data, mergeObject(translatedData, { translated: this.hasTranslation(data) }));
    }

    _toEntity(data) {
        return this.pack._toEntity(this.translate(data));
    }

}
