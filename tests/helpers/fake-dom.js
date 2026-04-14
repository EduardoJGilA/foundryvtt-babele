class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    this.parentNode = null;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }

    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  add(...tokens) {
    const classes = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    tokens.forEach((token) => classes.add(token));
    this.owner.className = [...classes].join(" ");
  }

  contains(token) {
    return this.owner.className.split(/\s+/).filter(Boolean).includes(token);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;

    if (!reference) {
      this.children.push(child);
      return child;
    }

    const index = this.children.indexOf(reference);
    if (index < 0) {
      this.children.push(child);
      return child;
    }

    this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }

    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  get nextSibling() {
    if (!this.parentNode) {
      return null;
    }

    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] ?? null;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  get classList() {
    return new FakeClassList(this);
  }

  get textContent() {
    return this.children.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value) {
    this.children = [];
    if (typeof value !== "undefined" && value !== null && value !== "") {
      this.appendChild(new FakeTextNode(String(value)));
    }
  }

  matches(selector) {
    if (!selector) {
      return false;
    }

    if (/^[a-z]+$/i.test(selector)) {
      return this.tagName === selector.toUpperCase();
    }

    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }

    const attrMatch = selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if (attrMatch) {
      const [, name, expected] = attrMatch;
      const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const actual = this.dataset[key];
      return typeof expected === "undefined" ? typeof actual !== "undefined" : actual === expected;
    }

    return false;
  }

  closest(selectorGroup) {
    let current = this;
    while (current) {
      if (matchesSelectorGroup(current, selectorGroup)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selectorGroup) {
    return this.querySelectorAll(selectorGroup)[0] ?? null;
  }

  querySelectorAll(selectorGroup) {
    const matches = [];
    const selectors = selectorGroup.split(",").map((selector) => selector.trim()).filter(Boolean);

    walk(this, (node) => {
      if (!(node instanceof FakeElement)) {
        return;
      }

      if (selectors.some((selector) => matchesSelectorChain(node, selector))) {
        matches.push(node);
      }
    });

    return matches;
  }
}

function walk(node, visit) {
  for (const child of node.children ?? []) {
    visit(child);
    walk(child, visit);
  }
}

function matchesSelectorGroup(node, selectorGroup) {
  return selectorGroup
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean)
    .some((selector) => matchesSelectorChain(node, selector));
}

function matchesSelectorChain(node, selector) {
  const parts = selector.split(/\s+/).filter(Boolean);
  let current = node;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!(current instanceof FakeElement) || !current.matches(parts[index])) {
      return false;
    }

    if (index === 0) {
      return true;
    }

    current = current.parentNode;
    while (current && !(current instanceof FakeElement && current.matches(parts[index - 1]))) {
      current = current.parentNode;
    }
  }

  return true;
}

export function installFakeDom() {
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createTextNode(text) {
      return new FakeTextNode(text);
    },
  };
}

export {FakeElement, FakeTextNode};
