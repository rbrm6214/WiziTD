import { z } from "zod";

export const TowerSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
  family_id: z.coerce.number().int().nonnegative(),
  tier: z.coerce.number().int().min(1),
  name_english: z.string().min(1),
  element: z.string().min(1),
  rarity: z.string().min(1),
  cost: z.coerce.number().nonnegative(),
  dmg_min: z.coerce.number().nonnegative(),
  dmg_max: z.coerce.number().nonnegative(),
  attack_cd: z.coerce.number().positive(),
  attack_range: z.coerce.number().positive(),
});

export const TowerArraySchema = z.array(TowerSchema);

const DocBaseSchema = z
  .object({
    id: z.coerce.number().int().nonnegative(),
  })
  .passthrough();

export const DocTowerSchema = DocBaseSchema.extend({
  family_id: z.coerce.number().int().nonnegative().optional(),
  tier: z.coerce.number().int().min(1).optional(),
  cost: z.coerce.number().nonnegative().optional(),
  attack_range: z.coerce.number().nonnegative().optional(),
  attack_cd: z.coerce.number().positive().optional(),
});

export const DocBuilderSchema = DocBaseSchema.extend({
  req_level: z.coerce.number().int().nonnegative().optional(),
  tier: z.string().optional(),
});

export const DocItemSchema = DocBaseSchema.extend({
  cost: z.coerce.number().nonnegative().optional(),
  required_wave_level: z.coerce.number().int().nonnegative().optional(),
  rarity: z.string().optional(),
});

export const DocAbilitySchema = DocBaseSchema.extend({
  portee: z.coerce.number().nonnegative().optional(),
});

export const DocAuraSchema = DocBaseSchema.extend({
  portee: z.coerce.number().nonnegative().optional(),
  niveau: z.coerce.number().int().nonnegative().optional(),
  niveau_add: z.coerce.number().optional(),
});

export const DocAutocastSchema = DocBaseSchema.extend({
  recharge: z.coerce.number().nonnegative().optional(),
  mana_cost: z.coerce.number().nonnegative().optional(),
});

export const DocWaveSpecialSchema = DocBaseSchema.extend({
  required_wave_level: z.coerce.number().int().nonnegative().optional(),
  frequency: z.coerce.number().nonnegative().optional(),
  enabled: z.coerce.boolean().optional(),
  hp_modifier: z.coerce.number().optional(),
});

export const DocMissionSchema = DocBaseSchema.extend({
  wave_count: z.coerce.number().int().nonnegative().optional(),
  difficulty: z.string().optional(),
  game_mode: z.string().optional(),
});

export const DocRecipeSchema = DocBaseSchema.extend({
  result_count: z.coerce.number().int().nonnegative().optional(),
  usable_count: z.coerce.number().int().nonnegative().optional(),
  permanent_count: z.coerce.number().int().nonnegative().optional(),
  rarity_change: z.coerce.number().optional(),
});

export const DocWisdomUpgradeSchema = DocBaseSchema.extend({
  tooltip: z.string().optional(),
});

export const DocExperienceEntrySchema = z
  .object({
    niveau: z.coerce.number().int().nonnegative(),
    exp: z.coerce.number().int().nonnegative(),
  })
  .passthrough();

export const DocTowerArraySchema = z.array(DocTowerSchema);
export const DocBuilderArraySchema = z.array(DocBuilderSchema);
export const DocItemArraySchema = z.array(DocItemSchema);
export const DocAbilityArraySchema = z.array(DocAbilitySchema);
export const DocAuraArraySchema = z.array(DocAuraSchema);
export const DocAutocastArraySchema = z.array(DocAutocastSchema);
export const DocWaveSpecialArraySchema = z.array(DocWaveSpecialSchema);
export const DocMissionArraySchema = z.array(DocMissionSchema);
export const DocRecipeArraySchema = z.array(DocRecipeSchema);
export const DocWisdomUpgradeArraySchema = z.array(DocWisdomUpgradeSchema);
export const DocExperienceEntryArraySchema = z.array(DocExperienceEntrySchema);
