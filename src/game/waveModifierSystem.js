function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSpecialName(special) {
  return String(special?.name_english ?? special?.label ?? "")
    .trim()
    .toLowerCase();
}

function extractSpecialMultipliers(special) {
  const hpMul = Math.max(0.4, 1 + toNumber(special.hp_modifier, 0));
  const speedMul = Math.max(0.5, 1 + toNumber(special.speed_modifier, 0));
  const armorFlat = Math.floor(toNumber(special.armor_modifier, 0));
  const leakDamage = Math.max(1, Math.floor(1 + toNumber(special.portal_damage_modifier, 0)));

  const name = normalizeSpecialName(special);
  let extraHpMul = 1;
  let extraSpeedMul = 1;
  let extraArmorFlat = 0;

  if (name === "speed") {
    extraSpeedMul = 1.3;
  } else if (name === "greater speed") {
    extraSpeedMul = 1.6;
  } else if (name === "xtreme speed") {
    extraSpeedMul = 2;
  } else if (name === "slow") {
    extraSpeedMul = 0.7;
  } else if (name === "armored") {
    extraArmorFlat = 4;
  } else if (name === "heavy armored") {
    extraArmorFlat = 9;
  } else if (name === "xtreme armor") {
    extraArmorFlat = 16;
  } else if (name === "meaty") {
    extraHpMul = 1.25;
  }

  return {
    hpMul: hpMul * extraHpMul,
    speedMul: speedMul * extraSpeedMul,
    armorFlat: armorFlat + extraArmorFlat,
    leakDamage,
  };
}

function extractSpecialEffects(special) {
  const name = normalizeSpecialName(special);
  return {
    invisible: name === "invisible",
    magicImmune: name === "magic immunity",
    spellResistance: name === "spell resistance",
    regenerationRatio: name === "xtreme regeneration" ? 0.03 : name === "regeneration" ? 0.01 : 0,
    secondChance: name === "second chance",
    evolving: name === "evolving",
    protector: name === "protector",
    slowAura: name === "slow aura",
    rich: name === "rich",
  };
}

export class WaveModifierSystem {
  constructor({ rng }) {
    this.rng = rng;
  }

  build(wave, mission) {
    const missionDifficulty = String(mission?.difficulty ?? "medium").toLowerCase();
    const missionHp = missionDifficulty === "hard" ? 1.08 : missionDifficulty === "extreme" ? 1.16 : 1;
    const missionSpeed = missionDifficulty === "hard" ? 1.04 : missionDifficulty === "extreme" ? 1.08 : 1;

    let hpMul = missionHp;
    let speedMul = missionSpeed;
    let armorFlat = 0;
    let leakDamage = 1;
    const specialEffects = {
      invisible: false,
      magicImmune: false,
      spellResistance: false,
      regenerationRatio: 0,
      secondChance: false,
      evolving: false,
      protector: false,
      slowAura: false,
      rich: false,
    };

    for (const special of wave.specials ?? []) {
      const m = extractSpecialMultipliers(special);
      const effects = extractSpecialEffects(special);
      hpMul *= m.hpMul;
      speedMul *= m.speedMul;
      armorFlat += m.armorFlat;
      leakDamage = Math.max(leakDamage, m.leakDamage);
      specialEffects.invisible ||= effects.invisible;
      specialEffects.magicImmune ||= effects.magicImmune;
      specialEffects.spellResistance ||= effects.spellResistance;
      specialEffects.secondChance ||= effects.secondChance;
      specialEffects.evolving ||= effects.evolving;
      specialEffects.protector ||= effects.protector;
      specialEffects.slowAura ||= effects.slowAura;
      specialEffects.rich ||= effects.rich;
      specialEffects.regenerationRatio = Math.max(
        specialEffects.regenerationRatio,
        effects.regenerationRatio,
      );
    }

    const isBossWave = wave.mainType === "BOSS";
    const bossProfile = isBossWave
      ? {
          thresholds: [0.66, 0.33],
          resistByPhase: [0, 0.15, 0.28],
          speedByPhase: [1, 1.08, 1.18],
        }
      : null;

    return {
      hpMul: Math.max(0.5, hpMul),
      speedMul: Math.max(0.6, speedMul),
      armorFlat: Math.max(0, armorFlat),
      leakDamage,
      specialEffects,
      bossProfile,
      isBossWave,
    };
  }
}
