import { describe, expect, it } from "vitest";
import { EventBus } from "../core/eventBus.js";
import { PathMap } from "./pathMap.js";
import { Creep } from "./creep.js";

describe("Creep", () => {
  function makePathMap() {
    return new PathMap({
      routes: [
        {
          id: "r1",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      ],
      spawnPoints: [{ id: "s1", routeId: "r1" }],
    });
  }

  it("emits leakDamage when reaching the end", () => {
    const bus = new EventBus();
    const pathMap = makePathMap();

    let reached = null;
    bus.on("creep:reached-end", (payload) => {
      reached = payload;
    });

    const creep = new Creep({
      id: 1,
      speed: 100,
      hp: 100,
      armor: 0,
      pathMap,
      bus,
      spawnPointId: "s1",
      leakDamage: 4,
    });

    creep.update(1);
    creep.update(1);
    creep.update(1);

    expect(reached).toBeTruthy();
    expect(reached.id).toBe(1);
    expect(reached.leakDamage).toBe(4);
  });

  it("emits boss phase change when thresholds are crossed", () => {
    const bus = new EventBus();
    const pathMap = makePathMap();

    const phases = [];
    bus.on("boss:phase-changed", ({ phase }) => {
      phases.push(phase);
    });

    const creep = new Creep({
      id: 2,
      speed: 1,
      hp: 100,
      armor: 0,
      pathMap,
      bus,
      spawnPointId: "s1",
      bossMeta: {
        thresholds: [0.66, 0.33],
      },
    });

    creep.takeDamage(40, "T1", "physical");
    creep.takeDamage(40, "T1", "physical");

    expect(phases).toContain(2);
    expect(phases).toContain(3);
  });

  it("applies burn damage over time and burn kills grant no tower source", () => {
    const bus = new EventBus();
    const pathMap = makePathMap();

    let killed = null;
    bus.on("creep:killed", (payload) => {
      killed = payload;
    });

    const creep = new Creep({
      id: 3,
      speed: 0,
      hp: 2,
      armor: 999,
      pathMap,
      bus,
      spawnPointId: "s1",
    });

    creep.addBurnStacks(2);
    creep.update(1.01);

    expect(creep.isAlive()).toBe(false);
    expect(killed).toBeTruthy();
    expect(killed.id).toBe(3);
    expect(killed.sourceTowerId).toBeNull();
  });

  it("multiplies ice and poison slow effects when both are active", () => {
    const bus = new EventBus();
    const pathMap = makePathMap();

    const creep = new Creep({
      id: 4,
      speed: 100,
      hp: 100,
      armor: 0,
      pathMap,
      bus,
      spawnPointId: "s1",
    });

    creep.applyIceSlowOrBurnReduction({ duration: 5, slowMul: 0.5, burnReduction: 0 });
    creep.applyPoison({ stacks: 1, slowDuration: 5, slowMul: 0.75 });

    expect(creep.getSpeedMultiplier()).toBeCloseTo(0.375, 6);
  });

  it("life armor blocks burn and poison effects", () => {
    const bus = new EventBus();
    const pathMap = makePathMap();

    const creep = new Creep({
      id: 5,
      speed: 100,
      hp: 100,
      armor: 0,
      armorType: "life",
      pathMap,
      bus,
      spawnPointId: "s1",
    });

    creep.addBurnStacks(2);
    creep.applyPoison({ stacks: 2, slowDuration: 5, slowMul: 0.75 });

    expect(creep.burnStacks).toBe(0);
    expect(creep.poisonStacks).toBe(0);
  });

  it("evolving revives once at 80 percent hp and gains a bonus power", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    const bus = new EventBus();
    const pathMap = makePathMap();
    const creep = new Creep({
      id: 6,
      speed: 100,
      hp: 100,
      armor: 0,
      pathMap,
      bus,
      spawnPointId: "s1",
      specialEffects: { evolving: true },
    });

    creep.takeDamage(200, "T1", "piercing");

    expect(creep.isAlive()).toBe(true);
    expect(creep.currentHp).toBeGreaterThanOrEqual(80);
    expect(creep.isInvisible || creep.shieldMaxHp > 0).toBe(true);

    Math.random = originalRandom;
  });
});
