function normalizeKey(rawKey) {
  return rawKey
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseValue(rawValue) {
  const value = rawValue.trim();

  if (value === "TRUE") {
    return true;
  }
  if (value === "FALSE") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function splitLines(markdownText) {
  return markdownText.replace(/\r\n/g, "\n").split("\n");
}

export class DocumentationParser {
  parse(markdownText) {
    const lines = splitLines(markdownText);
    const sections = new Map();

    let currentSection = null;
    let currentEntry = null;

    const pushCurrentEntry = () => {
      if (!currentSection || !currentEntry) {
        return;
      }

      const list = sections.get(currentSection) ?? [];
      list.push(currentEntry);
      sections.set(currentSection, list);
      currentEntry = null;
    };

    for (const line of lines) {
      if (line.startsWith("## ")) {
        pushCurrentEntry();
        currentSection = normalizeKey(line.slice(3));
        if (!sections.has(currentSection)) {
          sections.set(currentSection, []);
        }
        continue;
      }

      if (!currentSection) {
        continue;
      }

      if (line.startsWith("### Entree ")) {
        pushCurrentEntry();
        currentEntry = {};
        continue;
      }

      if (line.startsWith("- ")) {
        if (!currentEntry) {
          currentEntry = {};
        }

        const [left, ...rightParts] = line.slice(2).split(":");
        if (!left || rightParts.length === 0) {
          continue;
        }

        const key = normalizeKey(left);
        const value = parseValue(rightParts.join(": "));
        currentEntry[key] = value;
      }
    }

    pushCurrentEntry();

    return {
      sections,
      getEntries: (sectionName) => sections.get(normalizeKey(sectionName)) ?? [],
      getSectionNames: () => Array.from(sections.keys()),
      getSectionCount: (sectionName) => (sections.get(normalizeKey(sectionName)) ?? []).length,
    };
  }
}
