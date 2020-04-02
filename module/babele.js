
Hooks.once('init', () => {

    game.settings.register('babele', 'directory', {
        name: 'Translations Files Directory',
        hint: 'Enter the directory where translation files for compendiums are located',
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

    CONFIG.ui.compendium = BabeleCompendiumDirectory;
});

class BabeleCompendiumDirectory extends CompendiumDirectory {

    async getData(options) {
        await Babele.get().init();
        return super.getData(options);
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
    }

    static get() {
        if(typeof game.babele === 'undefined') {
            game.babele = new Babele();
        }
        return game.babele;
    }

    constructor() {
        this.modules = [];
        this.converters = {};
    }

    register(module) {
        this.modules.push(module);
    }

    registerConverters(converters) {
        this.converters = mergeObject(this.converters, converters);
    }

    supported(pack) {
        return Babele.SUPPORTED_PACKS.includes(pack.entity);
    }

    init() {
        return new Promise((resolve, reject )=> {

            const lang = game.settings.get('core', 'language');
            const directory = game.settings.get('babele', 'directory');
            const directories = this.modules
                .filter(module => module.lang === lang)
                .map(module => `modules/${module.module}/${module.dir}`);

            if(directory && directory.trim()) {
                directories.push(`${directory}/${lang}`);
            }

            let allTranslations = [];
            game.packs.forEach((pack, idx) => {
                if(this.supported(pack)) {
                    let translations;
                    Promise.all(directories.map(directory =>
                        fetch(`${directory}/${pack.collection}.json`)
                            .then(response => response.json())
                            .catch(error => console.log(`Babele | No translations files for ${pack.collection} pack found in ${directory} directory`))
                    ))
                    .then(translations => {
                        let translation;
                        translations.forEach(t => {
                            if(t) {
                                translation = t; // the last valid
                            }
                        });

                        if(translation) {
                            game.packs[idx] = new TranslatedCompendium(pack, translation);
                            allTranslations.push(mergeObject(translation, { collection: pack.collection }));
                        } else {
                            game.packs[idx] = new DecoratedCompendium(pack);
                        }

                        if(idx === game.packs.length -1) {
                            resolve(allTranslations);
                        }
                    });
                }
            });

        });
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
        let value = this.converter ? this.converter(this.extract(data), translations) : translations[this.field];
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
        this.mapping = mergeObject(mapping || {}, Babele.DEFAULT_MAPPINGS[entityType]);
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
        this.public = pack.public;
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
        Promise.all(index.map(entry => this.getEntity(entry.id))).then(entities => {
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
        translations.entries.forEach(t => {
            this.translations[t.id] = t;
        });
    }

    i18nName(name) {
        return this.translations[name] ? this.translations[name].name : name;
    }

    getIndex() {
        return new Promise((resolve, reject) => {
            this.pack.getIndex().then(index => {
                this.index = index
                    .map(idx => mergeObject(idx, { name: this.i18nName(idx.name) }))
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

    _toEntity(data) {
        let translatedData = this.mapping.map(data, this.translations[data.name] || {});
        let translated = !!this.translations[data.name];
        return this.pack._toEntity(mergeObject(data, mergeObject(translatedData, { translated: translated })));
    }

}