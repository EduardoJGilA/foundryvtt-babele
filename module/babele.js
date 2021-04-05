
Hooks.once('init', () => {

    game.settings.register('babele', 'directory', {
        name: game.i18n.localize("BABELE.TranslationDirTitle"),
        hint: game.i18n.localize("BABELE.TranslationDirHint"),
        type: window.Azzu.SettingsTypes.DirectoryPicker,
        default: ' ',
        scope: 'world',
        config: true,
        onChange: directory => {
            window.location.reload();
        }
    });

    game.settings.register('babele', 'export', {
        name: game.i18n.localize("BABELE.EnableTranslationExportTile"),
        hint: game.i18n.localize("BABELE.EnableTranslationExportHint"),
        scope: 'world',
        type: Boolean,
        config: true,
        default: true
    });
});

Hooks.once('setup', () => {

    Babele.get().instrument();
    game.babele = Babele.get();
});

Hooks.on('renderActorSheet', (app, html, data) => {
    if(game.user.isGM && data.editable) {
        let title = game.i18n.localize("BABELE.TranslateActorHeadBtn");
        let openBtn = $(`<a class="translate" title="${title}"><i class="fas fa-globe"></i>${title}</a>`);
        openBtn.click(ev => {
            Babele.get().translateActor(app.entity);
        });
        html.closest('.app').find('.translate').remove();
        let titleElement = html.closest('.app').find('.window-title');
        openBtn.insertAfter(titleElement);
    }
});

/**
 *
 */
class Converters {

    static fromPack(mapping, entityType = 'Item') {
        let dynamicMapping = new CompendiumMapping(entityType, mapping);
        return function(items, translations) {
            return items.map(data => {

                if(translations) {
                    let translation;
                    if(Array.isArray(translations)) {
                        translation = translations.find(t => t.id === data._id || t.id === data.name);
                    } else {
                        translation = translations[data._id] || translations[data.name];
                    }
                    if(translation) {
                        let translatedData = dynamicMapping.map(data, translation);
                        return mergeObject(data, mergeObject(translatedData, { translated: true }));
                    }
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

        if(directory && directory.trim && directory.trim()) {
            directories.push(`${directory}/${lang}`);
        }

        const files = [];
        for(let i=0; i<directories.length; i++) {
            let result = await FilePicker.browse("data", directories[i]);
            result.files.forEach(file => files.push(file));
        }

        let allTranslations = [];
        if(files.length === 0) {
            console.log(`Babele | no compendium translation files found for ${lang} language.`);
        } else {
            const keys = game.packs.keys();
            for (const key of keys) {
                let pack = game.packs.get(key);
                if(this.supported(pack)) {
                    const urls = files.filter(file => file.endsWith(`${pack.collection}.json`));
                    if(urls.length === 0) {
                        console.log(`Babele | no translation file found for ${pack.collection} pack`);
                    } else {
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
                            console.log(`Babele | translation for ${pack.collection} pack successfully loaded`);
                            allTranslations.push(mergeObject(translation, { collection: pack.collection }));
                        }
                    }
                }
            }
        }
        return allTranslations;
    }

    importCompendium(folderName, compendiumName) {
        let compendium = game.packs.find(p => p.collection === compendiumName);
        let folder = game.folders.entities.filter((f) => f.data.name === folderName)[0];
        if (compendium && folder) {
            compendium.getIndex().then(index => {
                index.forEach(entity => {
                    compendium.getEntity(entity._id)
                        .then(entity => {
                            console.log(entity.data);
                            if (!entity.data.hasTranslation) {
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

    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
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

    isDynamic() {
        return this.converter != null;
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
            if(!field.isDynamic()) {
                data[key] = field.extract(entity.data);
            }
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
        const buttons = super._getHeaderButtons();
        const exportEnabled = game.settings.get('babele', 'export');
        if(game.user.isGM && exportEnabled) {
            buttons.unshift({
                label: game.i18n.localize("BABELE.CompendiumTranslations"),
                class: "import",
                icon: "fas fa-download",
                onclick: ev => {
                    this.exportTranslationsFile();
                }
            });
        }
        return buttons;
    }

    async exportTranslationsFile() {

        ExportTranslationsDialog.create(this).then(async conf => {

            if (conf) {
                let file = {
                    label: this.metadata.label,
                    entries: conf.format === 'legacy' ? [] : {}
                };

                let index = await this.pack.getIndex();
                Promise.all(index.map(entry => this.getEntity(entry._id))).then(entities => {
                    entities.forEach((entity, idx) => {
                        if (conf.format === 'legacy') {
                            let entry = mergeObject({id: index[idx].name}, this.mapping.extract(entity));
                            file.entries.push(entry);
                        } else {
                            file.entries[`${index[idx].name}`] = this.mapping.extract(entity);
                        }
                    });

                    let dataStr = JSON.stringify(file, null, '\t');
                    let exportFileDefaultName = this.collection + '.json';

                    var zip = new JSZip();
                    zip.file(exportFileDefaultName, dataStr);
                    zip.generateAsync({type: "blob"})
                            .then(content => {
                                saveAs(content, this.collection + ".zip");
                            });
                });
            }
        });
    }
}

class TranslatedCompendium extends DecoratedCompendium {

    constructor(pack, translations) {
        super(pack, translations.mapping);
        pack.metadata = mergeObject(pack.metadata, { label: translations.label });
        this.translations = [];
        this.translated = true;
        this.reference = translations.reference;
        if(translations.entries) {
            if(Array.isArray(translations.entries)) {
                translations.entries.forEach(t => {
                    this.translations[t.id] = t;
                });
            } else {
                this.translations = translations.entries;
            }
        }
    }

    i18nName(idx) {
      let translation =
              this.translations[idx._id] ||
              this.translations[idx.id] ||
              this.translations[idx.name] ||
              { name: this.referenceI18Name(idx) || idx.name };
      return translation.name;
    }

    referenceI18Name(idx) {
        let name = null;
        if(this.reference) {
            let referencePack = game.packs.get(this.reference);
            if(referencePack.translated) {
                name = referencePack.i18nName(idx);
            }
        }
        return name;
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

    getEntry(entryId) {
        return new Promise((resolve, reject) => {
            this.pack.getEntry(entryId).then(data => {
                resolve(this.translate(data));
            });
        });
    }

    hasTranslation(data) {
        return !!this.translations[data._id] || !!this.translations[data.name] || this.hasReferenceTranslations(data);
    }

    hasReferenceTranslations(data) {
        if(this.reference) {
            let referencePack = game.packs.get(this.reference);
            return referencePack.translated && referencePack.hasTranslation(data);
        }
        return false;
    }

    translate(data, translationsOnly) {

        if(data == null) {
            return data;
        }

        if(data.translated) {
            return data;
        }

        let translatedData = this.mapping.map(data, this.translations[data._id] || this.translations[data.name] || {});

        if(this.reference) {
            let referencePack = game.packs.get(this.reference);
            if(referencePack.translated) {
                let fromReference = referencePack.translate(data, true);
                translatedData = mergeObject(fromReference, translatedData);
            }
        }

        if(translationsOnly) {
            return translatedData;
        } else {
            return mergeObject(
                data,
                mergeObject(
                    translatedData, {
                        translated: true,
                        hasTranslation: this.hasTranslation(data),
                        originalName: data.name,
                        flags: {
                            babele: {
                                translated: true,
                                hasTranslation: this.hasTranslation(data),
                                originalName: data.name
                            }
                        }
                    },
                    {inplace: false}
                ),
                { inplace: false }
            );
        }
    }

    _toEntity(data) {
        return this.pack._toEntity(this.translate(data));
    }

}

class ExportTranslationsDialog extends Dialog {

    constructor(pack, dialogData={}, options={}) {
        super(dialogData, options);
        this.pack = pack;
    }

    static async create(pack) {
        const html = await renderTemplate("modules/babele/templates/export-translations-dialog.html", pack);

        return new Promise((resolve) => {
            const dlg = new this(pack, {
                title: pack.metadata.label + ': ' + game.i18n.localize("BABELE.ExportTranslationTitle"),
                content: html,
                buttons: {
                    exp: {
                        icon: `<i class="fas fa-download"></i>`,
                        label: game.i18n.localize("BABELE.ExportTranslationBtn"),
                        callback: html => {
                            const fd = new FormDataExtended(html[0].querySelector("form"));
                            resolve(fd.toObject());
                        }
                    }
                },
                default: "exp",
                close: () => resolve(null)
            });
            dlg.render(true);
        });
    }
}

class OnDemandTranslateDialog extends Dialog {

    constructor(actor) {
        super({
            title: game.i18n.localize("BABELE.TranslateActorTitle"),
            content:
                `<p>${game.i18n.localize("BABELE.TranslateActorHint")}</p>
                <textarea rows="10" cols="50" id="actor-translate-log" style="font-family: Courier, monospace"></textarea>`,
            buttons: {
              translate: {
                  icon: '<i class="fas fa-globe"></i>',
                  label: game.i18n.localize("BABELE.TranslateActorBtn"),
                  callback: async () => {
                      let area = $('#actor-translate-log');
                      area.append(`start...\n`);
                      let items = actor.items.entries.length;
                      let translated = 0;
                      let untranslated = 0;
                      for (let idx = 0; idx < items; idx++) {
                          let item = actor.items.entries[idx];
                          let data = item.data;
                          let pack = game.packs.find(pack => pack.translated && pack.hasTranslation(data));
                          if(pack) {
                              let translatedData = pack.translate(data, true);
                              await actor.updateOwnedItem(mergeObject(translatedData, { _id: item._id }));
                              area.append(`${data.name.padEnd(68,'.')}ok\n`);
                              translated++;
                          } else {
                              area.append(`${data.name.padEnd(61,'.')}not found\n`);
                              untranslated++;
                          }
                      }
                      area.append(`\nend. tot items: ${items}, tot translated: ${translated}, tot untranslated: ${untranslated}  
                      \n`);
                  }
              }
            },
            default: "translate"
        });
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 600
        });
    }

    submit(button) {
        try {
            button.callback();
        } catch(err) {
            ui.notifications.error(err);
            throw new Error(err);
        }
    }

}