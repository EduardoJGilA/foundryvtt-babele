const fs = require("fs");

const [,, inputPath, outputPath, sourceLang = "en", targetLang = "it"] = process.argv;

if (!inputPath || !outputPath) {
    console.error("Usage: node translate-json.js <input.json> <output.json> [sourceLang] [targetLang]");
    process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8");
const data = JSON.parse(raw);

const SEP = "\n[[[BabeleSep_9f3a6d2c]]]\n";
const MAX_CHARS = 3500;
const PAUSE_MS = 250;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function collectStrings(node, path = "$", acc = []) {
    if (typeof node === "string") {
        if (node.trim()) {
            acc.push({path, text: node});
        }
        return acc;
    }

    if (Array.isArray(node)) {
        node.forEach((value, index) => collectStrings(value, `${path}[${index}]`, acc));
        return acc;
    }

    if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            collectStrings(value, `${path}.${key}`, acc);
        }
    }

    return acc;
}

function parsePath(path) {
    const tokens = [];
    let i = 1;

    while (i < path.length) {
        if (path[i] === ".") {
            i += 1;
            let key = "";
            while (i < path.length && path[i] !== "." && path[i] !== "[") {
                key += path[i];
                i += 1;
            }
            tokens.push(key);
            continue;
        }

        if (path[i] === "[") {
            i += 1;
            let index = "";
            while (i < path.length && path[i] !== "]") {
                index += path[i];
                i += 1;
            }
            i += 1;
            tokens.push(Number(index));
            continue;
        }

        i += 1;
    }

    return tokens;
}

function setAtPath(root, path, value) {
    const tokens = parsePath(path);
    let current = root;

    for (let i = 0; i < tokens.length - 1; i += 1) {
        current = current[tokens[i]];
    }

    current[tokens[tokens.length - 1]] = value;
}

function chunkItems(items) {
    const chunks = [];
    let current = [];
    let currentLength = 0;

    for (const item of items) {
        const extra = item.text.length + (current.length ? SEP.length : 0);
        if (current.length && currentLength + extra > MAX_CHARS) {
            chunks.push(current);
            current = [];
            currentLength = 0;
        }
        current.push(item);
        currentLength += extra;
    }

    if (current.length) {
        chunks.push(current);
    }

    return chunks;
}

async function translateBatch(texts) {
    const q = texts.join(SEP);
    const url = "https://translate.googleapis.com/translate_a/single"
        + `?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t`
        + `&q=${encodeURIComponent(q)}`;

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const translated = payload[0].map(part => part[0]).join("");
    const parts = translated.split(SEP);

    if (parts.length !== texts.length) {
        throw new Error(`Separator mismatch: expected ${texts.length}, got ${parts.length}`);
    }

    return parts;
}

async function main() {
    const strings = collectStrings(data);
    const chunks = chunkItems(strings);
    console.log(`Translating ${strings.length} strings in ${chunks.length} batches...`);

    let processed = 0;
    for (const chunk of chunks) {
        const translated = await translateBatch(chunk.map(item => item.text));
        translated.forEach((text, index) => setAtPath(data, chunk[index].path, text));
        processed += chunk.length;
        console.log(`Processed ${processed}/${strings.length}`);
        await sleep(PAUSE_MS);
    }

    fs.writeFileSync(outputPath, JSON.stringify(data, null, "\t"));
    console.log(`Wrote ${outputPath}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
