export class AutocastSystem {
  constructor({ registry, bus, rng }) {
    this.registry = registry;
    this.bus = bus;
    this.rng = rng;
  }

  tick(towers, dt) {
    const bucket = this.registry.buckets?.get("doc_autocasts");
    if (!bucket || bucket.size === 0 || towers.length === 0) {
      return;
    }

    const sample = Array.from(bucket.values()).slice(0, 3);

    for (const tower of towers) {
      tower.autocastTimer -= dt;
      if (tower.autocastTimer > 0) {
        continue;
      }

      const index = Math.floor(this.rng.range(0, sample.length));
      const selected = sample[index] ?? sample[0] ?? null;
      if (!selected) {
        continue;
      }

      const recharge = Number.isFinite(selected.recharge) ? selected.recharge : 2;
      tower.autocastTimer = Math.max(0.75, recharge);

      const boost = 1.02 + Math.min(0.2, tower.level * 0.01);
      tower.applyAuraEffects({
        damageMul: boost,
        attackSpeedMul: boost,
      });

      this.bus.emit("autocast:triggered", {
        towerId: tower.id,
        autocastId: selected.id,
        recharge: tower.autocastTimer,
      });
    }
  }
}
