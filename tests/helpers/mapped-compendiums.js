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
      return this.get(pack)?.extract?.(data, options) ?? data;
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
  if (!Object.hasOwn(babele, "translateIndex")) {
    babele.translateIndex = (index, pack) => mappedCompendiums.translateIndex(index, pack);
  }
  if (!Object.hasOwn(babele, "isTranslated")) {
    babele.isTranslated = (pack) => !!mappedCompendiums.translated(pack);
  }
  if (!Object.hasOwn(babele, "translate")) {
    babele.translate = (pack, data, translationsOnly) => mappedCompendiums.translate(pack, data, translationsOnly);
  }
  if (!Object.hasOwn(babele, "translateField")) {
    babele.translateField = (field, pack, data) => mappedCompendiums.translateField(pack, field, data);
  }
  if (!Object.hasOwn(babele, "extract")) {
    babele.extract = (pack, data, options = {}) => mappedCompendiums.extract(pack, data, options);
  }
  if (!Object.hasOwn(babele, "extractField")) {
    babele.extractField = (pack, field, data) => mappedCompendiums.extractField(pack, field, data);
  }
  if (!Object.hasOwn(babele, "translatedCompendiumFor")) {
    babele.translatedCompendiumFor = (pack) => mappedCompendiums.translated(pack);
  }
  if (!Object.hasOwn(babele, "mappedCompendiumFor")) {
    babele.mappedCompendiumFor = (pack) => mappedCompendiums.get(pack);
  }
  if (!Object.hasOwn(babele, "translatedPackFor")) {
    babele.translatedPackFor = (documentType, data) => {
    const packs = [...mappedCompendiums.values()];
    return packs.findLast((pack) => {
      if (pack?.translated !== true) return false;
      if (documentType && pack.metadata?.type && pack.metadata.type !== documentType) return false;
      if (pack.types && !pack.types.includes(data?.type)) return false;
      return pack.hasTranslation?.(data, documentType) !== false;
    }) ?? null;
    };
  }
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

    allTranslations() {
      return [...packs.values()].reduce(
        (translations, pack) => Object.assign(translations, pack.entries ?? {}),
        {},
      );
    },
  };
}

export function assignPackFolderTranslations(babele, entries = []) {
  const packFolderTranslations = mockPackFolderTranslations(entries);
  babele.packFolderTranslations = packFolderTranslations;
  return packFolderTranslations;
}
