function aliveBosses(creeps) {
  return creeps.filter((c) => c.isAlive() && c.bossMeta);
}

export class BossAbilitySystem {
  constructor({ rng, bus }) {
    this.rng = rng;
    this.bus = bus;
    this.cooldowns = new Map();
  }

  tick({ creeps, towers, dt, portalLives }) {
    let portalDelta = 0;

    for (const boss of aliveBosses(creeps)) {
      const current = this.cooldowns.get(boss.id) ?? this._nextCooldown(boss.bossPhase);
      const next = current - dt;
      if (next > 0) {
        this.cooldowns.set(boss.id, next);
        continue;
      }

      const ability = this._pickAbility(boss.bossPhase);
      if (ability === "pulse") {
        for (const tower of towers) {
          tower.applyBossDebuff({
            duration: 2.6,
            attackSpeedMul: 0.86,
          });
        }
        this.bus.emit("boss:ability", { id: boss.id, ability: "pulse", phase: boss.bossPhase });
      } else if (ability === "rupture") {
        const damage = boss.bossPhase >= 3 ? 2 : 1;
        portalDelta -= damage;
        this.bus.emit("boss:ability", {
          id: boss.id,
          ability: "rupture",
          phase: boss.bossPhase,
          portalDamage: damage,
        });
      } else {
        boss.speed = Math.min(boss.speed * 1.12, 220);
        this.bus.emit("boss:ability", { id: boss.id, ability: "enrage", phase: boss.bossPhase });
      }

      this.cooldowns.set(boss.id, this._nextCooldown(boss.bossPhase));
    }

    for (const creep of creeps) {
      if (!creep.isAlive()) {
        this.cooldowns.delete(creep.id);
      }
    }

    return Math.max(0, portalLives + portalDelta);
  }

  _nextCooldown(phase) {
    const min = phase >= 3 ? 2.3 : phase === 2 ? 3 : 4;
    const max = phase >= 3 ? 4.3 : phase === 2 ? 5 : 6.5;
    return this.rng.range(min, max);
  }

  _pickAbility(phase) {
    const roll = this.rng.next();
    if (phase >= 3) {
      if (roll < 0.45) {
        return "rupture";
      }
      if (roll < 0.78) {
        return "pulse";
      }
      return "enrage";
    }

    if (phase === 2) {
      if (roll < 0.35) {
        return "rupture";
      }
      if (roll < 0.8) {
        return "pulse";
      }
      return "enrage";
    }

    if (roll < 0.65) {
      return "pulse";
    }
    return "enrage";
  }
}
