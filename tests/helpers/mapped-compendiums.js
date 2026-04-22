export function mockMappedCompendiums(entries = []) {
  const packs = new foundry.utils.Collection(entries);

  const view = {
    get(pack) {
      return packs.get(pack) ?? null;
    },

    translated(pack) {
      const compendium = packs.get(pack);
      return compendium?.translated ? compendium : null;
    },

    translateIndex(index, pack) {
      return this.translated(pack)?.translateIndex(index) ?? index;
    },

    translate(pack, data, translationsOnly) {
      return this.translated(pack)?.translate(data, translationsOnly) ?? data;
    },

    translateField(pack, field, data) {
      return this.get(pack)?.translateField(field, data) ?? null;
    },

    extract(pack, data, options = {}) {
      return this.get(pack)?.extract(data, options);
    },

    extractField(pack, field, data) {
      return this.get(pack)?.extractField(field, data);
    },

    values() {
      return packs.values();
    },

    matching(predicate) {
      return [...packs.values()].filter(predicate);
    },
  };

  return view;
}

export function assignMappedCompendiums(babele, entries = []) {
  const mappedCompendiums = mockMappedCompendiums(entries);
  babele.mappedCompendiums = mappedCompendiums;
  return mappedCompendiums;
}

export function mockPackFolderTranslations(entries = []) {
  const packs = new foundry.utils.Collection(entries);

  return {
    get(collection) {
      return packs.get(collection) ?? null;
    },

    values() {
      return packs.values();
    },

    matching(predicate) {
      return [...packs.values()].filter(predicate);
    },
  };
}

export function assignPackFolderTranslations(babele, entries = []) {
  const packFolderTranslations = mockPackFolderTranslations(entries);
  babele.packFolderTranslations = packFolderTranslations;
  return packFolderTranslations;
}
