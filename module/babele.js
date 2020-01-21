
Hooks.on('init', () => {

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

Hooks.on('ready', () => {

    Babele.get().init();
});


class Babele {

    static SUPPORTED_PACKS = ['Actor', 'Item', 'JournalEntry'];

    static DEFAULT_MAPPINGS = {
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
    };

    static instance = new Babele();

    static get() {
        return this.instance;
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
        const lang = game.settings.get('core', 'language');
        const directory = game.settings.get('babele', 'directory');
        const directories = this.modules.filter(module => module.lang === lang).map(module => `modules/${module.module}/${module.dir}`);

        if(directory && directory.trim()) {
            directories.push(`${directory}/${lang}`);
        }

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
                    } else {
                        game.packs[idx] = new DecoratedCompendium(pack);
                    }
                });
            }
        });
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
        super();
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
        this.metadata = mergeObject(pack.metadata, { label: translations.label });
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
        return this.pack._toEntity(mergeObject(data, translatedData));
    }

}