import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/rng.js";
import { WaveModifierSystem } from "./waveModifierSystem.js";

describe("WaveModifierSystem", () => {
  it("applies mission difficulty baseline modifiers", () => {
    const system = new WaveModifierSystem({ rng: new SeededRandom(11) });
    const wave = { mainType: "NORMAL", specials: [] };

    const hardMods = system.build(wave, { difficulty: "hard" });
    expect(hardMods.hpMul).toBeGreaterThan(1);
    expect(hardMods.speedMul).toBeGreaterThan(1);
    expect(hardMods.armorFlat).toBe(0);
    expect(hardMods.isBossWave).toBe(false);
  });

  it("combines specials and enables boss profile for boss waves", () => {
    const system = new WaveModifierSystem({ rng: new SeededRandom(13) });
    const wave = {
      mainType: "BOSS",
      specials: [
        {
          hp_modifier: 0.2,
          speed_modifier: 0.1,
          armor_modifier: 3,
          portal_damage_modifier: 2,
        },
      ],
    };

    const mods = system.build(wave, { difficulty: "medium" });
    expect(mods.hpMul).toBeCloseTo(1.2, 4);
    expect(mods.speedMul).toBeCloseTo(1.1, 4);
    expect(mods.armorFlat).toBe(3);
    expect(mods.leakDamage).toBe(3);
    expect(mods.isBossWave).toBe(true);
    expect(mods.bossProfile).toBeTruthy();
    expect(mods.bossProfile.thresholds).toEqual([0.66, 0.33]);
  });

  it("extracts semantic special effects used by creeps", () => {
    const system = new WaveModifierSystem({ rng: new SeededRandom(17) });
    const wave = {
      mainType: "NORMAL",
      specials: [
        { name_english: "Magic Immunity" },
        { name_english: "Protector" },
        { name_english: "Second Chance" },
        { name_english: "Rich" },
        { name_english: "Regeneration" },
      ],
    };

    const mods = system.build(wave, { difficulty: "medium" });
    expect(mods.specialEffects.magicImmune).toBe(true);
    expect(mods.specialEffects.protector).toBe(true);
    expect(mods.specialEffects.secondChance).toBe(true);
    expect(mods.specialEffects.rich).toBe(true);
    expect(mods.specialEffects.regenerationRatio).toBeGreaterThan(0);
  });
});
