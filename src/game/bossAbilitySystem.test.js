import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/rng.js";
import { EventBus } from "../core/eventBus.js";
import { BossAbilitySystem } from "./bossAbilitySystem.js";

describe("BossAbilitySystem", () => {
  it("keeps lives unchanged when no alive boss is present", () => {
    const system = new BossAbilitySystem({ rng: new SeededRandom(4), bus: new EventBus() });
    const result = system.tick({ creeps: [], towers: [], dt: 1, portalLives: 20 });
    expect(result).toBe(20);
  });

  it("can apply boss abilities and never return negative lives", () => {
    const bus = new EventBus();
    const events = [];
    bus.on("boss:ability", (e) => events.push(e));

    const system = new BossAbilitySystem({ rng: new SeededRandom(1), bus });

    const boss = {
      id: 1,
      bossMeta: { thresholds: [0.66, 0.33] },
      bossPhase: 3,
      speed: 100,
      isAlive: () => true,
    };

    const towers = [
      {
        applyBossDebuff: () => {},
      },
    ];

    let lives = 2;
    for (let i = 0; i < 6; i += 1) {
      lives = system.tick({ creeps: [boss], towers, dt: 10, portalLives: lives });
    }

    expect(lives).toBeGreaterThanOrEqual(0);
    expect(events.length).toBeGreaterThan(0);
  });
});
