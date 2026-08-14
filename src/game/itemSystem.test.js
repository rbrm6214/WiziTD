import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/rng.js";
import { DataRegistry } from "../data/dataRegistry.js";
import { ItemSystem } from "./itemSystem.js";

describe("ItemSystem", () => {
  it("sorts items by rarity descending and localizes names in French", () => {
    const items = [
      { id: "1", name: "Rare", rarity: "rare" },
      { id: "2", name: "Commun", rarity: "common" },
      { id: "3", name: "Unique", rarity: "unique" },
      { id: "4", name: "Legendaire", rarity: "legendary" },
    ];

    const sorted = ItemSystem.sortItems(items);

    expect(sorted.map((item) => item.rarity)).toEqual(["unique", "legendary", "rare", "common"]);
    expect(ItemSystem.localizeName("Sun Core", "legend_sun")).toBe("Noyau solaire");
    expect(ItemSystem.localizeName("Gale Crest", "legend_gale")).toBe("Crête des vents");
    expect(ItemSystem.localizeName("Ancient Root", "legend_root")).toBe("Racine ancienne");
  });

  it("craft an item when recipe resources are available", () => {
    const registry = new DataRegistry();
    registry.registerMany(
      "doc_items",
      [
        { id: "resin", name: "Resin", category: "resource", rarity: "common", dropLevelMin: 1, dropChance: 1 },
        { id: "core", name: "Core", category: "resource", rarity: "common", dropLevelMin: 1, dropChance: 1 },
        {
          id: "crafted_orb",
          name: "Crafted Orb",
          category: "crafted",
          rarity: "rare",
          effects: { damage: 5 },
          dropLevelMin: 1,
          dropChance: 0,
        },
      ],
      "id",
    );
    registry.registerMany(
      "doc_recipes",
      [
        {
          id: "r_orb",
          resultItemId: "crafted_orb",
          usable_count: 2,
          ingredients: [
            { itemId: "resin", qty: 1 },
            { itemId: "core", qty: 1 },
          ],
        },
      ],
      "id",
    );

    const itemSystem = new ItemSystem({
      registry,
      rng: {
        next: () => 0.1,
        range: () => 1234,
      },
    });
    const stash = [
      { id: "resin", name: "Resin", modifiers: {} },
      { id: "core", name: "Core", modifiers: {} },
      { id: "extra", name: "Extra", modifiers: {} },
    ];

    const crafted = itemSystem.craftFromRecipes(stash);
    expect(crafted).toBeTruthy();
    expect(crafted.recipeId).toBe("r_orb");
    expect(crafted.item.id).toBe("crafted-r_orb-1234");
    expect(crafted.item.sourceId).toBe("r_orb");
    expect(stash.map((x) => x.id)).toEqual(["extra"]);
  });

  it("rolls a drop only when at least one eligible item exists", () => {
    const registry = new DataRegistry();
    registry.registerMany(
      "doc_items",
      [
        { id: "late", name: "Late", category: "resource", rarity: "common", dropLevelMin: 5, dropChance: 1 },
        { id: "early", name: "Early", category: "resource", rarity: "common", dropLevelMin: 1, dropChance: 1 },
      ],
      "id",
    );

    const itemSystem = new ItemSystem({ registry, rng: new SeededRandom(3) });
    expect(itemSystem.rollDrop(1)).toBeTruthy();
    expect(itemSystem.rollDrop(0)).toBeNull();
  });

  it("never includes legendary items in creep drop pools", () => {
    const registry = new DataRegistry();
    registry.registerMany(
      "doc_items",
      [
        { id: "legend", name_english: "Sun Core", rarity: "legendary", required_wave_level: 1 },
        { id: "common", name_english: "Resin", rarity: "common", required_wave_level: 1 },
      ],
      "id",
    );

    const itemSystem = new ItemSystem({ registry, rng: new SeededRandom(5) });
    const pool = itemSystem.getDropPoolForWave(10);

    expect(pool.map((item) => item.id)).toEqual(["common"]);
  });

  it("builds deterministic modifiers per item identity within rarity bounds", () => {
    const itemSystem = new ItemSystem({ registry: new DataRegistry(), rng: new SeededRandom(9) });

    const first = itemSystem.getRarityModifiers("rare", "r1");
    const second = itemSystem.getRarityModifiers("rare", "r1");
    const other = itemSystem.getRarityModifiers("rare", "r2");

    expect(first).toEqual(second);
    expect(other).not.toEqual(first);

    expect(first.damageMul).toBeGreaterThanOrEqual(1.05);
    expect(first.damageMul).toBeLessThanOrEqual(1.2);
    expect(first.rangeFlat).toBeGreaterThanOrEqual(7);
    expect(first.rangeFlat).toBeLessThanOrEqual(22);
    expect(first.attackSpeedMul).toBeGreaterThanOrEqual(1.03);
    expect(first.attackSpeedMul).toBeLessThanOrEqual(1.18);
  });

  it("rerolls a unique item when the excluded unique is already owned", () => {
    const registry = new DataRegistry();
    registry.registerMany(
      "doc_items",
      [
        { id: "unique_a", name_english: "Alpha Core", rarity: "unique", required_wave_level: 1 },
        { id: "unique_b", name_english: "Beta Core", rarity: "unique", required_wave_level: 1 },
      ],
      "id",
    );

    const itemSystem = new ItemSystem({
      registry,
      rng: {
        next: () => 0,
        range: (min, max) => (min === 1000 && max === 9999 ? 1234 : 0),
      },
    });

    const rerolled = itemSystem.buildReplacementUnique(["unique_a"], "item-reroll");

    expect(rerolled).toBeTruthy();
    expect(rerolled.sourceId).toBe("unique_b");
    expect(rerolled.name).toBe("Beta noyau");
    expect(rerolled.id).toBe("item-reroll-unique_b-1234");
  });
});
