import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/rng.js";
import { EventBus } from "../core/eventBus.js";
import { EliteAffixSystem } from "./eliteAffixSystem.js";

describe("EliteAffixSystem", () => {
  it("assigns no affix to regular non-champion creeps", () => {
    const system = new EliteAffixSystem({ rng: new SeededRandom(5), bus: new EventBus() });
    const affix = system.assign({ waveLevel: 20, isChampion: false, isBoss: false });
    expect(affix).toBeNull();
  });

  it("can assign affix to boss and heal regenerating creeps", () => {
    const system = new EliteAffixSystem({ rng: new SeededRandom(2), bus: new EventBus() });
    const affix = {
      id: "regenerating",
      modifiers: { regenRatioPerSec: 0.05 },
    };

    const creep = {
      maxHp: 100,
      currentHp: 50,
      affix,
      isAlive: () => true,
      heal(amount) {
        this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
      },
    };

    system.tick([creep], 1);
    expect(creep.currentHp).toBeGreaterThan(50);
  });
});
