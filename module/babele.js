
Hooks.on('init', () => {

    game.settings.register('babele', 'directory', {
        name: 'Translations Files Directory',
        hint: 'Enter the directory where translation files for compendiums are located',
        type: window.Azzu.SettingsTypes.DirectoryPicker,
        default: ' ',
        scope: 'client',
        config: true,
        onChange: directory => {
            window.location.reload();
        }
    });
});

Hooks.on('ready', () => {

    game.babele = new Babele();
});

class Babele {

    constructor() {
        this.init();   
    }

    init() {
        const directory = game.settings.get('babele', 'directory');
        if(directory && directory.trim()) {
            game.packs.forEach((pack, idx) => {
                fetch(`${directory}/${pack.collection}.json`)
                .then(response => response.json())
                .then(translations => this.decorate(pack, idx, translations))
                .catch(reason => this.undecorate(pack, idx));
            });
        }
    }

    decorate(pack, idx, translations) {
        game.packs[idx] = new TranslatedCompendium(pack, translations);
    }

    undecorate(pack, idx) {
        if(game.packs[idx].decorated) {
            game.packs[idx] = game.packs[idx].pack;
        }    
    }

}

class TranslatedCompendium extends Compendium {

    constructor(pack, translations) {
        super();
        this.decorated = true;
        this.pack = pack;
        this.metadata = mergeObject(pack.metadata, { label: translations.label });
        this.translations = [];
        translations.entries.forEach(t => {
            this.translations[t.id] = { name: t.name, description: t.description };
        });
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

    i18nName(name) {
        return this.translations[name] ? this.translations[name].name : name;
    }

    i18Description(name, description) {
        return this.translations[name] ? this.translations[name].description : description;
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

    _toEntity(entryData) {
        switch(entryData.type) {
            case 'npc': return this.toNpc(entryData);
            default: return this.toItem(entryData);
        }
    }

    toItem(entryData) {
        return this.pack._toEntity(
            mergeObject(entryData, {
                name: this.i18nName(entryData.name),
                data: {
                    description: {
                        value: this.i18Description(entryData.name, entryData.data.description.value)
                    }
                }
            })
        )
    }

    toNpc(entryData) {
        return this.pack._toEntity(
            mergeObject(entryData, {
                name: this.i18nName(entryData.name),
                data: {
                    details: {
                        biography: {
                            value: this.i18Description(entryData.name, entryData.data.details.biography.value)
                        }    
                    }
                }
            })
        )
    }

}