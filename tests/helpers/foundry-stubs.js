function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }

  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepClone(item)]));
  }

  return value;
}

function mergeObject(original = {}, other = {}, options = {}) {
  const target = options.inplace ? original : deepClone(original);

  for (const [key, value] of Object.entries(other ?? {})) {
    if (isObject(value) && isObject(target[key])) {
      target[key] = mergeObject(target[key], value, {inplace: true});
    } else {
      target[key] = deepClone(value);
    }
  }

  return target;
}

class TestCollection extends Map {
  find(predicate) {
    for (const value of this.values()) {
      if (predicate(value)) {
        return value;
      }
    }
    return undefined;
  }

  filter(predicate) {
    return [...this.values()].filter(predicate);
  }
}

export function installFoundryStubs() {
  const hookRegistry = new Map();
  const hookEntries = (hook) => hookRegistry.get(hook) ?? [];

  globalThis.Hooks = {
    once(hook, fn) {
      const entries = hookEntries(hook);
      entries.push({fn, once: true});
      hookRegistry.set(hook, entries);
    },
    on(hook, fn) {
      const entries = hookEntries(hook);
      entries.push({fn, once: false});
      hookRegistry.set(hook, entries);
    },
    callAll(hook, ...args) {
      const entries = [...hookEntries(hook)];
      for (const entry of entries) {
        entry.fn(...args);
      }
      hookRegistry.set(
        hook,
        hookEntries(hook).filter((entry) => !entry.once),
      );
    },
  };

  globalThis.Dialog = class {};
  globalThis.renderTemplate = async () => "";
  globalThis.FormDataExtended = class {
    constructor() {
      this.object = {};
    }
  };
  globalThis.ui = {
    notifications: {
      notify() {},
      error() {},
    },
    compendium: {
      async render() {},
    },
  };
  globalThis.libWrapper = {
    register() {},
  };
  globalThis.window = {};
  globalThis.saveAs = () => {};
  globalThis.JSZip = class {};
  globalThis.SceneNavigation = {
    displayProgressBar() {},
  };

  class DialogV2 {
    constructor(config = {}) {
      this.config = config;
    }

    render(options = {}) {
      this.renderOptions = options;
      return this;
    }

    static async input() {
      return null;
    }
  }

  globalThis.foundry = {
    utils: {
      mergeObject,
      parseUuid(uuid) {
        if (!uuid) {
          return null;
        }

        const id = String(uuid).split(".").pop();
        return {id, collection: {collection: String(uuid)}};
      },
      logCompatibilityWarning() {},
      Collection: TestCollection,
    },
    applications: {
      handlebars: {
        async renderTemplate() {
          return "";
        },
      },
      api: {
        DialogV2,
      },
      ux: {
        FormDataExtended: globalThis.FormDataExtended,
      },
      apps: {
        FilePicker: {
          async browse() {
            return {files: []};
          },
        },
      },
    },
    documents: {
      collections: {
        CompendiumCollection: function () {},
      },
    },
  };

  globalThis.game = {
    babele: {
      converters: {},
      mappedCompendiums: null,
      translations: [],
      translatedPackFor(documentType, data, options = {}) {
        const registry = options.registry ?? this.mappedCompendiums;
        if (registry?.find) {
          return registry.find((pack) => pack.translated && pack.hasTranslation(data, documentType)) ?? null;
        }

        const packs = registry?.values?.() ? [...registry.values()] : [];
        return packs.find((pack) => pack.translated && pack.hasTranslation(data, documentType)) ?? null;
      },
      getCollection(metadata) {
        const prefix = metadata.packageType === "world" ? "world" : metadata.packageName;
        return `${prefix}.${metadata.name}`;
      },
      translateField() {
        return null;
      },
    },
    settings: {
      register() {},
      get() {
        return "";
      },
      set() {},
    },
    modules: {
      get() {
        return {active: true};
      },
    },
    user: {
      isGM: true,
      hasPermission() {
        return true;
      },
    },
    i18n: {
      localize(key) {
        return key;
      },
    },
    packs: new TestCollection(),
    data: {
      packs: [],
      folders: [],
    },
    collections: new Map(),
    scenes: [],
    actors: {
      get() {
        return null;
      },
    },
    system: {
      id: "test-system",
    },
  };

  return {mergeObject, TestCollection};
}
