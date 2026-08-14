export class AuraSystem {
  constructor({ registry }) {
    this.registry = registry;
  }

  apply(towers) {
    for (const tower of towers) {
      tower.resetAuraEffects();
    }

    if (towers.length === 0) {
      return;
    }

    const auraBucket = this.registry.buckets?.get("doc_auras");
    if (!auraBucket || auraBucket.size === 0) {
      return;
    }

    const auras = Array.from(auraBucket.values()).slice(0, 3);

    for (const source of towers) {
      for (const aura of auras) {
        const radius = Number.isFinite(aura.portee) ? aura.portee : 220;
        for (const target of towers) {
          if (target === source && aura.target_self === false) {
            continue;
          }

          const dx = source.position.x - target.position.x;
          const dy = source.position.y - target.position.y;
          const d = Math.hypot(dx, dy);
          if (d > radius) {
            continue;
          }

          const lvl = Number.isFinite(aura.niveau) ? aura.niveau : 1;
          const add = Number.isFinite(aura.niveau_add) ? aura.niveau_add : 0;
          const power = 1 + (lvl + add) * 0.01;

          target.applyAuraEffects({
            damageMul: 1 + (power - 1) * 0.45,
            attackSpeedMul: 1 + (power - 1) * 0.55,
          });
        }
      }
    }
  }
}
