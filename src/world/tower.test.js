import { describe, expect, it } from "vitest";
import { Tower } from "./tower.js";

const bus = { emit: () => {} };

describe("Tower progression", () => {
  it("upgrades stats when level increases", () => {
    const tower = new Tower({ id: "T1", x: 0, y: 0, damage: 50, attackCd: 1, range: 200, bus });

    const upgraded = tower.upgrade();

    expect(upgraded).toBe(true);
    expect(tower.level).toBe(2);
    expect(tower.damage).toBeGreaterThan(50);
    expect(tower.range).toBe(200);
    expect(tower.attackCd).toBeLessThan(1);
  });

  it("grants xp and can level up automatically", () => {
    const tower = new Tower({ id: "T1", x: 0, y: 0, damage: 40, attackCd: 1, range: 180, bus });

    const leveled = tower.grantXp(200);

    expect(leveled).toBe(true);
    expect(tower.level).toBeGreaterThan(1);
  });

  it("does not compound run damage bonus into future upgrades", () => {
    const tower = new Tower({
      id: "T1",
      x: 0,
      y: 0,
      damage: 56,
      attackCd: 0.62,
      range: 255,
      upgradeConfig: {
        damageMul: 1.29,
        damageFlat: 6,
        rangeFlat: 11,
        attackCdMul: 0.95,
      },
      bus,
    });

    tower.setRunBonuses({ damageMul: 1.74 });

    const preview = tower.getUpgradePreview();

    expect(preview.baseDamage).toBe(78);
    expect(preview.damage).toBe(135);
  });

  it("returns null preview at max level", () => {
    const tower = new Tower({ id: "T1", x: 0, y: 0, damage: 40, attackCd: 1, range: 180, bus });

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }

    expect(tower.getUpgradePreview()).toBeNull();
    expect(tower.getUpgradeCost()).toBe(0);
  });

  it("pyro hits up to 5 creeps by default and applies burn following current order", () => {
    const tower = new Tower({
      id: "T1",
      x: 0,
      y: 0,
      damage: 6,
      attackCd: 0.1,
      range: 100,
      damageType: "elemental",
      blueprintId: "pyro",
      hitsAllInRange: true,
      maxTargetsPerShot: 4,
      burnOnHit: 1,
      specialText: "zone(4), burn(1)",
      bus,
    });

    const makeCreep = (id, x, y) => ({
      id,
      position: { x, y },
      pathIndex: 0,
      currentHp: 20,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        if (this.currentHp <= 0) {
          this.alive = false;
        }
        return amount;
      },
      addBurnStacks(stacks) {
        this.burnStacks = (this.burnStacks ?? 0) + stacks;
      },
    });

    tower.setTargetMode("proche");

    const creeps = Array.from({ length: 12 }, (_, index) => makeCreep(`C${index + 1}`, 5 + index * 5, 0));

    tower.update(0.11, creeps);

    for (const creep of creeps.slice(0, 4)) {
      expect(creep.currentHp).toBe(14);
      expect(creep.burnStacks).toBe(1);
    }
    for (const creep of creeps.slice(4)) {
      expect(creep.currentHp).toBe(20);
      expect(creep.burnStacks).toBeUndefined();
    }
    expect(tower.getSpecialText()).toBe("zone(4), burn(1)");
  });

  it("pyro unlocks zone(10) at level 10", () => {
    const tower = new Tower({
      id: "T2",
      x: 0,
      y: 0,
      damage: 6,
      attackCd: 0.1,
      range: 100,
      damageType: "elemental",
      blueprintId: "pyro",
      hitsAllInRange: true,
      maxTargetsPerShot: 4,
      bonusMaxTargetsPerShot: 10,
      burnOnHit: 1,
      specialText: "zone(4), burn(1), magic, ground",
      bonusSpecialText: "zone(10), burn(1), magic, ground",
      bus,
    });

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }

    const creeps = Array.from({ length: 12 }, (_, index) => ({
      id: `C${index + 1}`,
      position: { x: 5 + index * 5, y: 0 },
      pathIndex: 0,
      currentHp: 20,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
      addBurnStacks(stacks) {
        this.burnStacks = (this.burnStacks ?? 0) + stacks;
      },
    }));

    tower.update(0.11, creeps);

    for (const creep of creeps.slice(0, 10)) {
      expect(creep.currentHp).toBeLessThan(20);
      expect(creep.burnStacks).toBe(1);
    }
    expect(creeps[10].currentHp).toBe(20);
    expect(tower.getSpecialText()).toBe("zone(10), burn(1), magic, ground");
  });

  it("pyro keeps classic orders", () => {
    const tower = new Tower({
      id: "T1",
      x: 0,
      y: 0,
      blueprintId: "pyro",
      hitsAllInRange: true,
      burnOnHit: 1,
      specialText: "zone(4), burn(1)",
      bus,
    });

    expect(tower.targetMode).toBe("avance");
    expect(tower.setTargetMode("faible")).toBe(true);
    expect(tower.setTargetMode("stop")).toBe(true);
    expect(tower.setTargetMode("proche")).toBe(true);
    expect(tower.targetMode).toBe("proche");
  });

  it("can remove equipped items and rebuild tower bonuses", () => {
    const tower = new Tower({ id: "T3", x: 0, y: 0, damage: 40, attackCd: 1, range: 180, bus });
    const item = {
      id: "I1",
      name: "Relique",
      modifiers: { damageMul: 1.1, rangeFlat: 10, attackSpeedMul: 1.05 },
    };

    tower.addItem(item);
    const removed = tower.removeItemAt(0);

    expect(removed).toEqual(item);
    expect(tower.items).toHaveLength(0);
    expect(tower.itemDamageMul).toBe(1);
    expect(tower.itemRangeFlat).toBe(0);
    expect(tower.itemAttackSpeedMul).toBe(1);
  });

  it("frozen slows by default and unlocks freeze only at level 10", () => {
    const tower = new Tower({
      id: "F1",
      x: 0,
      y: 0,
      damage: 10,
      attackCd: 2,
      range: 120,
      damageType: "elemental",
      splashRadius: 20,
      splashRadius: 30,
      freezeDuration: 0,
      bonusFreezeDuration: 1,
      iceSlowDuration: 5,
      iceSlowMul: 0.5,
      burnReductionOnFreezeHit: 10,
      burnReductionOnFreezeSplash: 5,
      specialText: "slow(5), splash(20)",
      bonusSpecialText: "freeze(1), slow(5), splash(20)",
      bus,
    });

    const makeCreep = (id, x, y, burnStacks = 0) => ({
      id,
      position: { x, y },
      pathIndex: 0,
      currentHp: 100,
      burnStacks,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
      applyFreezeOrBurnReduction({ duration, burnReduction }) {
        if (this.burnStacks > 0) {
          this.burnStacks = Math.max(0, this.burnStacks - burnReduction);
          return;
        }
        this.freezeTimer = Math.max(this.freezeTimer ?? 0, duration);
      },
      applyIceSlowOrBurnReduction({ duration, slowMul, burnReduction }) {
        if (this.burnStacks > 0) {
          this.burnStacks = Math.max(0, this.burnStacks - burnReduction);
          return;
        }
        this.iceSlowTimer = Math.max(this.iceSlowTimer ?? 0, duration);
        this.iceSlowMul = slowMul;
      },
    });

    const target = makeCreep("C1", 10, 0, 0);
    const splash = makeCreep("C2", 25, 0, 0);
    const burningTarget = makeCreep("C3", 15, 0, 12);
    const burningSplash = makeCreep("C4", 20, 0, 7);

    tower.setTargetMode("proche");
    tower.update(2.1, [target, splash, burningTarget, burningSplash]);

    expect(target.iceSlowTimer).toBe(5);
    expect(splash.iceSlowTimer).toBe(5);
    expect(burningTarget.burnStacks).toBe(7);
    expect(burningTarget.freezeTimer).toBeUndefined();
    expect(burningTarget.iceSlowTimer).toBeUndefined();
    expect(burningSplash.burnStacks).toBe(2);
    expect(burningSplash.iceSlowTimer).toBeUndefined();

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }

    const frozenTarget = makeCreep("C5", 10, 0, 0);
    tower.update(2.1, [frozenTarget]);

    expect(frozenTarget.freezeTimer).toBe(1);
    expect(tower.getSpecialText()).toBe("freeze(1), slow(5), splash(20)");
  });

  it("ronce applies poison stacks and poison slow on hit", () => {
    const tower = new Tower({
      id: "R1",
      x: 0,
      y: 0,
      damage: 30,
      attackCd: 1,
      range: 80,
      damageType: "physical",
      poisonOnHit: 1,
      poisonSlowDuration: 20,
      poisonSlowMul: 0.75,
      specialText: "slowPoison(20), poison(1), piercing",
      bus,
    });

    const target = {
      id: "C1",
      position: { x: 20, y: 0 },
      pathIndex: 0,
      currentHp: 100,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
      applyPoison({ stacks, slowDuration, slowMul }) {
        this.poisonStacks = (this.poisonStacks ?? 0) + stacks;
        this.poisonSlowTimer = slowDuration;
        this.poisonSlowMul = slowMul;
      },
    };

    tower.update(1.1, [target]);

    expect(target.currentHp).toBe(70);
    expect(target.poisonStacks).toBe(1);
    expect(target.poisonSlowTimer).toBe(20);
    expect(target.poisonSlowMul).toBe(0.75);
  });

  it("cannon deals splash damage to nearby ground units and ignores air units", () => {
    const tower = new Tower({
      id: "C1",
      x: 0,
      y: 0,
      damage: 100,
      attackCd: 0.75,
      range: 160,
      damageType: "physical",
      splashRadius: 20,
      splashRadius: 30,
      splashDamageRatio: 0.35,
      targetGroundOnly: true,
      bus,
    });

    const groundTarget = {
      id: "G1",
      waveType: "NORMAL",
      position: { x: 20, y: 0 },
      pathIndex: 0,
      currentHp: 200,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    };
    const groundSplash = {
      id: "G2",
      waveType: "NORMAL",
      position: { x: 30, y: 0 },
      pathIndex: 0,
      currentHp: 200,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    };
    const air = {
      id: "A1",
      waveType: "AIR",
      position: { x: 24, y: 0 },
      pathIndex: 0,
      currentHp: 200,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    };

    tower.update(1, [groundTarget, groundSplash, air]);

    expect(groundTarget.currentHp).toBe(100);
    expect(groundSplash.currentHp).toBe(165);
    expect(air.currentHp).toBe(200);
  });

  it("ricochet bounces and updates special text by level", () => {
    const tower = new Tower({
      id: "R2",
      x: 0,
      y: 0,
      damage: 100,
      attackCd: 1,
      range: 200,
      ricochetByLevel: true,
      ricochetRadius: 50,
      ricochetDamageRatio: 0.5,
      ricochetMaxLevelBonus: 5,
      maxLevel: 20,
      bus,
    });

    const makeCreep = (id, x) => ({
      id,
      waveType: "NORMAL",
      position: { x, y: 0 },
      pathIndex: 0,
      currentHp: 1000,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    });

    const c1 = makeCreep("C1", 10);
    const c2 = makeCreep("C2", 15);
    tower.update(1.1, [c1, c2]);

    expect(c1.currentHp).toBe(900);
    expect(c2.currentHp).toBe(950);
    expect(tower.getSpecialText()).toBe("bounce(1), bludgeoning");

    while (tower.level < 7) {
      tower.upgrade();
    }
    expect(tower.getSpecialText()).toBe("bounce(7), bludgeoning");

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }
    expect(tower.getSpecialText()).toBe("bounce(15), bludgeoning");
  });

  it("sentinel and ronce gain multishot at level 10", () => {
    const sentinel = new Tower({
      id: "S1",
      x: 0,
      y: 0,
      damage: 50,
      attackCd: 1,
      range: 200,
      blueprintId: "sentinel",
      maxLevelMultiShot: 2,
      specialText: "piercing",
      bus,
    });
    const ronce = new Tower({
      id: "R3",
      x: 0,
      y: 0,
      damage: 30,
      attackCd: 1,
      range: 80,
      blueprintId: "ronce",
      poisonOnHit: 1,
      poisonSlowDuration: 20,
      poisonSlowMul: 0.75,
      maxLevelMultiShot: 3,
      specialText: "slowPoison(20), poison(1), piercing",
      bus,
    });

    while (sentinel.level < sentinel.maxLevel) {
      sentinel.upgrade();
    }
    while (ronce.level < ronce.maxLevel) {
      ronce.upgrade();
    }

    expect(sentinel.getSpecialText()).toBe("piercing, multiShot(2)");
    expect(ronce.getSpecialText()).toBe("slowPoison(20), poison(1), piercing, multiShot(3)");
  });

  it("elfe switches damage type to chaos at level 10", () => {
    const tower = new Tower({
      id: "E1",
      x: 0,
      y: 0,
      damage: 72,
      attackCd: 1,
      range: 290,
      blueprintId: "arc",
      damageType: "piercing",
      bonusDamageType: "chaos",
      specialText: "piercing, eyes",
      bonusSpecialText: "chaos, eyes",
      hasEyes: true,
      bus,
    });

    expect(tower.damageType).toBe("piercing");

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }

    expect(tower.damageType).toBe("chaos");
    expect(tower.getSpecialText()).toBe("chaos, eyes");
  });

  it("machinegun gains multishot text and extra hit at max level", () => {
    const tower = new Tower({
      id: "M1",
      x: 0,
      y: 0,
      damage: 33,
      attackCd: 0.075,
      range: 266,
      maxLevelMultiShot: 2,
      bus,
    });

    while (tower.level < tower.maxLevel) {
      tower.upgrade();
    }

    const target = {
      id: "C1",
      waveType: "NORMAL",
      position: { x: 20, y: 0 },
      pathIndex: 0,
      currentHp: 500,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    };

    const expectedPerShot = tower.damage;
    tower.update(0.08, [target]);

    expect(target.currentHp).toBe(500 - expectedPerShot * 2);
    expect(tower.getSpecialText()).toBe("Standard, multiShot(2)");
  });

  it("magic towers cannot target immune creeps and non-eyes towers cannot target invisible creeps", () => {
    const magicTower = new Tower({
      id: "M2",
      x: 0,
      y: 0,
      damage: 20,
      attackCd: 1,
      range: 120,
      damageType: "magic",
      bus,
    });
    const normalTower = new Tower({
      id: "P1",
      x: 0,
      y: 0,
      damage: 20,
      attackCd: 1,
      range: 120,
      damageType: "piercing",
      bus,
    });
    const eyesTower = new Tower({
      id: "E1",
      x: 0,
      y: 0,
      damage: 20,
      attackCd: 1,
      range: 120,
      damageType: "piercing",
      hasEyes: true,
      bus,
    });

    const makeTarget = (overrides = {}) => ({
      id: overrides.id ?? "C1",
      armorType: overrides.armorType ?? "none",
      isInvisible: !!overrides.isInvisible,
      position: { x: 20, y: 0 },
      pathIndex: 0,
      currentHp: 100,
      alive: true,
      isAlive() {
        return this.alive;
      },
      takeDamage(amount) {
        this.currentHp -= amount;
        return amount;
      },
    });

    const immune = makeTarget({ id: "I1", armorType: "immune" });
    magicTower.update(1.1, [immune]);
    expect(immune.currentHp).toBe(100);

    const invisible = makeTarget({ id: "V1", isInvisible: true });
    normalTower.update(1.1, [invisible]);
    expect(invisible.currentHp).toBe(100);

    eyesTower.update(1.1, [invisible]);
    expect(invisible.currentHp).toBe(80);
  });

  it("creep slow aura reduces tower fire rate by 50 percent", () => {
    const tower = new Tower({
      id: "S1",
      x: 0,
      y: 0,
      damage: 50,
      attackCd: 1,
      range: 120,
      damageType: "piercing",
      bus,
    });

    const baseAttackCd = tower.attackCd;
    tower.applyCreepSlowAura(0.5);

    expect(tower.attackCd).toBeCloseTo(baseAttackCd / 0.5, 6);
  });
});
