const AFFIX_POOL = [
  {
    id: "haste",
    label: "Haste",
    minWave: 6,
    weight: 3,
    hpMul: 1,
    speedMul: 1.22,
    armorFlat: 0,
    regenRatioPerSec: 0,
    leakDamageBonus: 0,
    tint: "#f59e0b",
  },
  {
    id: "fortress",
    label: "Fortress",
    minWave: 10,
    weight: 3,
    hpMul: 1.3,
    speedMul: 0.95,
    armorFlat: 5,
    regenRatioPerSec: 0,
    leakDamageBonus: 1,
    tint: "#60a5fa",
  },
  {
    id: "regenerating",
    label: "Regenerating",
    minWave: 14,
    weight: 2,
    hpMul: 1.12,
    speedMul: 1,
    armorFlat: 0,
    regenRatioPerSec: 0.02,
    leakDamageBonus: 0,
    tint: "#22c55e",
  },
  {
    id: "volatile",
    label: "Volatile",
    minWave: 18,
    weight: 2,
    hpMul: 1.1,
    speedMul: 1.06,
    armorFlat: 1,
    regenRatioPerSec: 0,
    leakDamageBonus: 2,
    tint: "#ef4444",
  },
];

function weightedPick(rng, entries) {
  const total = entries.reduce((acc, e) => acc + e.weight, 0);
  let roll = rng.range(0, total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1] ?? null;
}

export class EliteAffixSystem {
  constructor({ rng, bus }) {
    this.rng = rng;
    this.bus = bus;
  }

  assign({ waveLevel, isChampion, isBoss }) {
    if (!isChampion && !isBoss) {
      return null;
    }

    const chance = isBoss ? 0.8 : 0.28 + Math.min(0.3, waveLevel * 0.008);
    if (this.rng.next() > chance) {
      return null;
    }

    const eligible = AFFIX_POOL.filter((a) => waveLevel >= a.minWave);
    if (eligible.length === 0) {
      return null;
    }

    const affix = weightedPick(this.rng, eligible);
    if (!affix) {
      return null;
    }

    return {
      id: affix.id,
      label: affix.label,
      modifiers: {
        hpMul: affix.hpMul,
        speedMul: affix.speedMul,
        armorFlat: affix.armorFlat,
        regenRatioPerSec: affix.regenRatioPerSec,
        leakDamageBonus: affix.leakDamageBonus,
      },
      tint: affix.tint,
    };
  }

  tick(creeps, dt) {
    for (const creep of creeps) {
      if (!creep.isAlive()) {
        continue;
      }
      const regenRatio = creep.affix?.modifiers?.regenRatioPerSec ?? 0;
      if (regenRatio <= 0) {
        continue;
      }

      const heal = creep.maxHp * regenRatio * dt;
      if (heal <= 0) {
        continue;
      }

      creep.heal(heal);
    }
  }
}
