import { describe, expect, it } from "vitest";
import { DataRegistry } from "../data/dataRegistry.js";
import { MetaProgressionSystem } from "./metaProgressionSystem.js";

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

describe("MetaProgressionSystem", () => {
  it("awards xp and sagesse points after a winning run", () => {
    const registry = new DataRegistry();
    const storage = createMemoryStorage();
    const system = new MetaProgressionSystem({ registry, storage });
    system.load();

    const before = system.state.sagessePoints;
    const result = system.applyRunResult({ won: true, wave: 15, kills: 80, score: 1200 });

    expect(result.xpGain).toBeGreaterThan(0);
    expect(system.state.runs).toBe(1);
    expect(system.state.wins).toBe(1);
    expect(system.state.sagessePoints).toBeGreaterThan(before);
  });

  it("invests sagesse into bonuses", () => {
    const registry = new DataRegistry();
    const storage = createMemoryStorage();
    const system = new MetaProgressionSystem({ registry, storage });
    system.load();

    system.state.sagessePoints = 2;
    const ok = system.invest("economy");
    expect(ok).toBe(true);

    const bonuses = system.getRunBonuses();
    expect(bonuses.bonusStartingGold).toBeGreaterThan(0);
  });

  it("migrates legacy wisdom fields into sagesse and knowledge levels", () => {
    const registry = new DataRegistry();
    const storage = createMemoryStorage();
    storage.setItem(
      "wizitd_meta_v1",
      JSON.stringify({
        wisdomPoints: 4,
        wisdomSpent: { economy: 2, offense: 1, defense: 3 },
        bestWave: 22,
      }),
    );

    const system = new MetaProgressionSystem({ registry, storage });
    system.load();

    expect(system.state.sagessePoints).toBe(4);
    expect(system.state.knowledgeLevels.economy).toBe(2);
    expect(system.state.knowledgeLevels.offense).toBe(1);
    expect(system.state.knowledgeLevels.defense).toBe(3);
    expect(system.state.highestWaveEver).toBe(22);
  });

  it("grants sagesse for new waves and recurring 25-wave milestones", () => {
    const registry = new DataRegistry();
    const storage = createMemoryStorage();
    const system = new MetaProgressionSystem({ registry, storage });
    system.load();

    expect(system.completeWave(24).sagesseGain).toBe(1);
    expect(system.completeWave(25).sagesseGain).toBe(2);
    expect(system.completeWave(25).sagesseGain).toBe(1);
    expect(system.state.sagessePoints).toBe(4);
  });
});
