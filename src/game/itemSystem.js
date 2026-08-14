export class ItemSystem {
  constructor({ registry, rng }) {
    this.registry = registry;
    this.rng = rng;
    this.recipeCooldown = 0;
  }

  static get RARITY_ORDER() {
    return ["unique", "legendary", "rare", "uncommon", "common"];
  }

  static compareItemsByRarity(left, right) {
    const order = ItemSystem.RARITY_ORDER;
    const leftIndex = order.indexOf(String(left?.rarity ?? "common").toLowerCase());
    const rightIndex = order.indexOf(String(right?.rarity ?? "common").toLowerCase());
    const normalizedLeftIndex = leftIndex >= 0 ? leftIndex : order.length;
    const normalizedRightIndex = rightIndex >= 0 ? rightIndex : order.length;
    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }
    return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "fr", { sensitivity: "base" });
  }

  static localizeName(rawName, sourceId = "") {
    const explicitMap = {
      resin: "Résine",
      core: "Noyau",
      late: "Fragment tardif",
      early: "Fragment précoce",
      legend_sun: "Noyau solaire",
      legend_gale: "Crête des vents",
      legend_root: "Racine ancienne",
      crafted_orb: "Orbe d'artisanat",
    };
    const sourceKey = String(sourceId ?? "").trim().toLowerCase();
    if (explicitMap[sourceKey]) {
      return explicitMap[sourceKey];
    }

    const name = String(rawName ?? "Objet")
      .replace(/crafted/gi, "Artisanat")
      .replace(/orb/gi, "orbe")
      .replace(/core/gi, "noyau")
      .replace(/resin/gi, "résine")
      .replace(/shard/gi, "éclat")
      .replace(/flame/gi, "flamme")
      .replace(/frost/gi, "givre")
      .replace(/storm/gi, "tempête")
      .replace(/shadow/gi, "ombre")
      .replace(/light/gi, "lumière")
      .replace(/gale/gi, "vents")
      .replace(/crest/gi, "crête")
      .replace(/sun/gi, "solaire")
      .replace(/ancient/gi, "ancien")
      .replace(/mana-touched/gi, "imprégné de mana")
      .replace(/greater/gi, "supérieur")
      .replace(/small/gi, "petit")
      .replace(/large/gi, "grand")
      .replace(/[()]/g, "")
      .replace(/_/g, " ")
      .trim();

    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  static sortItems(items) {
    return [...items].sort(ItemSystem.compareItemsByRarity);
  }

  static get LEGENDARY_SHOP_ENTRIES() {
    return [
      { id: "legend_sun", name_english: "Sun Core", rarity: "legendary" },
      { id: "legend_gale", name_english: "Gale Crest", rarity: "legendary" },
      { id: "legend_root", name_english: "Ancient Root", rarity: "legendary" },
    ];
  }

  static get RESERVE_UNIQUE_LEGENDARY_NAMES() {
    return [
      "Lampe d'Aladin",
      "Excalibur",
      "Mjollnir",
      "Sceau de Salomon",
      "Gungnir",
      "Pierre Philosophale",
      "Toison d'or",
      "Saint Graal",
      "Gant de l'infini",
      "Anneau Unique",
    ];
  }

  _buildDeterministicSeed(key) {
    const text = String(key ?? "item");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _nextSeed(seed) {
    return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }

  _getDeterministicRoll(key, step) {
    let seed = this._buildDeterministicSeed(`${key}:${step}`);
    seed = this._nextSeed(seed);
    return seed / 0x100000000;
  }

  getRarityModifiers(rarity, identityKey = "") {
    const rarityConfigs = {
      common: { baseDamage: 2, baseRange: 0, baseSpeed: 1, bonusPoints: 3 },
      uncommon: { baseDamage: 3, baseRange: 4, baseSpeed: 2, bonusPoints: 10 },
      rare: { baseDamage: 5, baseRange: 7, baseSpeed: 3, bonusPoints: 15 },
      legendary: { baseDamage: 6, baseRange: 8, baseSpeed: 4, bonusPoints: 19 },
      unique: { baseDamage: 7, baseRange: 9, baseSpeed: 5, bonusPoints: 25 },
    };

    const config = rarityConfigs[String(rarity ?? "common").toLowerCase()] ?? rarityConfigs.common;
    const distribution = {
      damage: config.baseDamage,
      range: config.baseRange,
      speed: config.baseSpeed,
    };
    const distributionKey = `${String(rarity ?? "common").toLowerCase()}:${identityKey}`;

    for (let point = 0; point < config.bonusPoints; point += 1) {
      const roll = this._getDeterministicRoll(distributionKey, point);
      if (roll < 1 / 3) {
        distribution.damage += 1;
        continue;
      }
      if (roll < 2 / 3) {
        distribution.range += 1;
        continue;
      }
      distribution.speed += 1;
    }

    return {
      damageMul: 1 + distribution.damage / 100,
      rangeFlat: distribution.range,
      attackSpeedMul: 1 + distribution.speed / 100,
    };
  }

  _getReserveUniqueLegendaryEntries() {
    return ItemSystem.RESERVE_UNIQUE_LEGENDARY_NAMES.map((name, index) => ({
      id: `reserve_unique_legendary_${index + 1}`,
      name_english: name,
      rarity: "unique",
      isReserveUniqueLegendary: true,
      reserveIndex: index,
      reserveBonusPoints: index < 5 ? 15 : 20,
      reserveSellValueBonus: index < 5 ? 200 : 300,
    }));
  }

  getDropWeightForRarity(rarity) {
    const normalized = String(rarity ?? "common").toLowerCase();
    if (normalized === "common") {
      return 60;
    }
    if (normalized === "uncommon") {
      return 28;
    }
    if (normalized === "rare") {
      return 11;
    }
    if (normalized === "unique") {
      return 1;
    }
    return 0;
  }

  getDropChanceForWave(waveLevel, difficulty = "medium") {
    const wave = Math.max(1, Math.floor(Number(waveLevel) || 1));
    const diff = String(difficulty ?? "medium").toLowerCase();

    const tier = wave >= 500
      ? "500+"
      : wave >= 400
        ? "400-499"
        : wave >= 300
          ? "300-399"
          : wave >= 200
            ? "200-299"
            : wave >= 100
              ? "100-199"
              : "1-99";

    const chances = {
      "1-99": { extreme: 0.02, hard: 0.03, medium: 0.05, easy: 0.07 },
      "100-199": { extreme: 0.04, hard: 0.05, medium: 0.07, easy: 0.09 },
      "200-299": { extreme: 0.05, hard: 0.06, medium: 0.08, easy: 0.1 },
      "300-399": { extreme: 0.07, hard: 0.08, medium: 0.1, easy: 0.12 },
      "400-499": { extreme: 0.09, hard: 0.1, medium: 0.12, easy: 0.14 },
      "500+": { extreme: 0.14, hard: 0.16, medium: 0.2, easy: 0.25 },
    };

    const normalized = diff === "difficile" ? "hard" : diff === "normal" ? "medium" : diff;
    return chances[tier]?.[normalized] ?? chances[tier]?.medium ?? 0.05;
  }

  _pickEntry(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    const rawIndex = Math.floor(this.rng.range(0, entries.length));
    const safeIndex = Math.max(0, Math.min(entries.length - 1, rawIndex));
    return entries[safeIndex] ?? null;
  }

  _pickWeightedEntry(entries) {
    const weightedEntries = entries
      .map((entry) => ({ entry, weight: this.getDropWeightForRarity(entry?.rarity) }))
      .filter((entry) => entry.weight > 0);
    if (weightedEntries.length === 0) {
      return null;
    }

    const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.rng.range(0, totalWeight);
    for (const candidate of weightedEntries) {
      roll -= candidate.weight;
      if (roll <= 0) {
        return candidate.entry;
      }
    }

    return weightedEntries[weightedEntries.length - 1]?.entry ?? null;
  }

  getDropPoolForWave(waveLevel) {
    const bucket = this.registry.buckets?.get("doc_items");
    if (!bucket) {
      return [];
    }

    return Array.from(bucket.values()).filter((item) => {
      const req = Number.isFinite(item.required_wave_level) ? item.required_wave_level : 0;
      const rarity = String(item.rarity ?? "common").toLowerCase();
      return req <= waveLevel && rarity !== "legendary";
    });
  }

  getEntriesByRarity(rarity) {
    const normalized = String(rarity ?? "common").toLowerCase();
    const bucket = this.registry.buckets?.get("doc_items");
    const registryEntries = bucket
      ? Array.from(bucket.values()).filter((item) => String(item?.rarity ?? "common").toLowerCase() === normalized)
      : [];

    if (registryEntries.length > 0) {
      return registryEntries;
    }

    if (normalized === "legendary") {
      return ItemSystem.LEGENDARY_SHOP_ENTRIES;
    }

    return [];
  }

  _normalizeExcludedUniqueIds(excludedUniqueSourceIds = []) {
    return new Set(
      Array.from(excludedUniqueSourceIds ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
  }

  _pickUniqueEntry(excludedUniqueSourceIds = []) {
    const excluded = this._normalizeExcludedUniqueIds(excludedUniqueSourceIds);
    const basePool = this.getEntriesByRarity("unique").filter((entry) => !excluded.has(String(entry?.id ?? "")));
    if (basePool.length > 0) {
      return this._pickEntry(basePool);
    }

    const reservePool = this._getReserveUniqueLegendaryEntries().filter((entry) => !excluded.has(String(entry?.id ?? "")));
    return this._pickEntry(reservePool);
  }

  _buildUniqueFallbackItem(mode = "shop", shopKey = "") {
    const normalized = String(mode ?? "shop").toLowerCase();
    if (normalized === "drop") {
      const legendaryEntry = this._pickEntry(this.getEntriesByRarity("legendary"));
      if (!legendaryEntry) {
        return null;
      }
      return this._toRuntimeItem(legendaryEntry, "drop-fallback-legendary");
    }

    if (this.rng.next() < 0.5) {
      return {
        id: `shop-fallback-gold-${Math.floor(this.rng.range(1000, 9999))}`,
        sourceId: "shop-fallback-gold-500",
        name: "+500 or",
        rarity: "special",
        type: "gold",
        amount: 500,
        cost: 0,
      };
    }

    const legendaryEntry = this._pickEntry(this.getEntriesByRarity("legendary"));
    if (!legendaryEntry) {
      return {
        id: `shop-fallback-gold-${Math.floor(this.rng.range(1000, 9999))}`,
        sourceId: "shop-fallback-gold-500",
        name: "+500 or",
        rarity: "special",
        type: "gold",
        amount: 500,
        cost: 0,
      };
    }
    return this._toRuntimeItem(legendaryEntry, `shop-${shopKey || "fallback-legendary"}`);
  }

  buildReplacementUnique(excludedUniqueSourceIds = [], idPrefix = "item") {
    const entry = this._pickUniqueEntry(excludedUniqueSourceIds);
    if (!entry) {
      return null;
    }
    return this._toRuntimeItem(entry, idPrefix);
  }

  buildShopItemByRarity(rarity, shopKey = "", options = {}) {
    const excludedUniqueSourceIds = options?.excludedUniqueSourceIds ?? [];
    const fallbackChains = {
      unique: ["unique"],
      legendary: ["legendary", "rare", "uncommon", "common"],
      rare: ["rare", "uncommon", "common"],
      uncommon: ["uncommon", "common"],
      common: ["common"],
    };
    const normalized = String(rarity ?? "common").toLowerCase();
    const chain = fallbackChains[normalized] ?? fallbackChains.common;

    for (const candidateRarity of chain) {
      if (candidateRarity === "unique") {
        const uniqueEntry = this._pickUniqueEntry(excludedUniqueSourceIds);
        if (uniqueEntry) {
          return this._toRuntimeItem(uniqueEntry, `shop-${shopKey || candidateRarity}`);
        }
        return this._buildUniqueFallbackItem(options?.uniqueFallbackMode ?? "shop", shopKey);
      }

      const entry = this._pickEntry(this.getEntriesByRarity(candidateRarity));
      if (entry) {
        return this._toRuntimeItem(entry, `shop-${shopKey || candidateRarity}`);
      }
    }

    return null;
  }

  rollDrop(waveLevel, options = {}) {
    const pool = this.getDropPoolForWave(waveLevel);
    if (pool.length === 0) {
      return null;
    }

    const baseChance = this.getDropChanceForWave(waveLevel, options?.difficulty ?? "medium");
    if (this.rng.next() > baseChance) {
      return null;
    }

    const excludedUniqueSourceIds = this._normalizeExcludedUniqueIds(options?.excludedUniqueSourceIds ?? []);
    const filteredPool = pool.filter((entry) => {
      const rarity = String(entry?.rarity ?? "common").toLowerCase();
      return rarity !== "unique" || !excludedUniqueSourceIds.has(String(entry?.id ?? ""));
    });
    const entry = this._pickWeightedEntry(filteredPool);
    if (!entry) {
      return null;
    }
    if (String(entry?.rarity ?? "common").toLowerCase() === "unique") {
      const fallback = this._buildUniqueFallbackItem("drop");
      if (fallback) {
        return fallback;
      }
    }
    return this._toRuntimeItem(entry);
  }

  _toRuntimeItem(entry, idPrefix = "item") {
    const rarity = String(entry.rarity ?? "common").toLowerCase();
    const isReserveUniqueLegendary = !!entry?.isReserveUniqueLegendary;
    const itemName = isReserveUniqueLegendary
      ? String(entry.name_english ?? `Objet ${entry.id}`)
      : ItemSystem.localizeName(entry.name_english ?? `Objet ${entry.id}`, entry.id);
    const mods = this.getRarityModifiers(rarity, entry.id ?? itemName);

    if (isReserveUniqueLegendary) {
      const distribution = {
        damage: 0,
        range: 0,
        speed: 0,
      };
      const bonusPoints = Math.max(0, Number(entry.reserveBonusPoints ?? 0));
      const distributionKey = `${String(entry?.id ?? itemName)}:reserve`;
      for (let point = 0; point < bonusPoints; point += 1) {
        const roll = this._getDeterministicRoll(distributionKey, point);
        if (roll < 1 / 3) {
          distribution.damage += 1;
          continue;
        }
        if (roll < 2 / 3) {
          distribution.range += 1;
          continue;
        }
        distribution.speed += 1;
      }

      mods.damageMul += distribution.damage / 100;
      mods.rangeFlat += distribution.range;
      mods.attackSpeedMul += distribution.speed / 100;
    }

    return {
      id: `${idPrefix}-${entry.id}-${Math.floor(this.rng.range(1000, 9999))}`,
      sourceId: entry.id,
      name: itemName,
      rarity,
      isReserveUniqueLegendary,
      sellValueBonus: isReserveUniqueLegendary ? Number(entry.reserveSellValueBonus ?? 0) : 0,
      modifiers: { ...mods },
    };
  }

  craftFromRecipes(stash) {
    if (!Array.isArray(stash) || stash.length < 2) {
      return null;
    }

    if (this.recipeCooldown > 0) {
      this.recipeCooldown -= 1;
      return null;
    }

    const recipes = this.registry.buckets?.get("doc_recipes");
    if (!recipes || recipes.size === 0) {
      return null;
    }

    const recipe = Array.from(recipes.values()).find((r) => Number(r.usable_count ?? 0) >= 2) ?? null;
    if (!recipe) {
      return null;
    }

    if (this.rng.next() > 0.22) {
      return null;
    }

    const first = stash.shift();
    const second = stash.shift();
    if (!first || !second) {
      return null;
    }

    this.recipeCooldown = 3;

    const crafted = {
      id: `crafted-${recipe.id}-${Math.floor(this.rng.range(1000, 9999))}`,
      sourceId: recipe.id,
      name: `Artisanat (${first.name}+${second.name})`,
      rarity: "rare",
      modifiers: {
        ...this.getRarityModifiers("rare", `crafted:${recipe.id}:${first.name}:${second.name}`),
      },
    };

    return { recipeId: recipe.id, item: crafted };
  }
}
