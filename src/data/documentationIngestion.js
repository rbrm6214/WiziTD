import {
  DocAbilitySchema,
  DocAbilityArraySchema,
  DocAuraSchema,
  DocAuraArraySchema,
  DocAutocastSchema,
  DocAutocastArraySchema,
  DocBuilderSchema,
  DocBuilderArraySchema,
  DocExperienceEntrySchema,
  DocExperienceEntryArraySchema,
  DocItemSchema,
  DocItemArraySchema,
  DocMissionSchema,
  DocMissionArraySchema,
  DocRecipeSchema,
  DocRecipeArraySchema,
  DocTowerSchema,
  DocTowerArraySchema,
  DocWaveSpecialSchema,
  DocWaveSpecialArraySchema,
  DocWisdomUpgradeSchema,
  DocWisdomUpgradeArraySchema,
} from "./schemas.js";

function toIdArray(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? [value] : [];
  }

  const tokens = String(value)
    .split("|")
    .flatMap((part) => part.split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  const ids = [];
  for (const token of tokens) {
    if (/^-?\d+$/.test(token)) {
      ids.push(Number(token));
    }
  }
  return ids;
}

function addIssuesForMissingRefs(sourceEntries, fieldName, targetBucket, registry, issues, sourceName) {
  for (const entry of sourceEntries) {
    const refs = toIdArray(entry[fieldName]);
    for (const refId of refs) {
      if (!registry.get(targetBucket, refId)) {
        issues.push(
          `${sourceName}#${entry.id} -> ${fieldName} reference manquante: ${targetBucket}:${refId}`,
        );
      }
    }
  }
}

export class DocumentationIngestion {
  ingest(parsedDoc, registry) {
    const issues = [];
    const towers = this._parseEntries(
      this._withId(parsedDoc.getEntries("Tours")),
      DocTowerSchema,
      "Tours",
      issues,
    );
    const builders = this._parseEntries(
      this._withId(parsedDoc.getEntries("Constructeurs")),
      DocBuilderSchema,
      "Constructeurs",
      issues,
    );
    const items = this._parseEntries(
      this._withId(parsedDoc.getEntries("Objets")),
      DocItemSchema,
      "Objets",
      issues,
    );
    const abilities = this._parseEntries(
      this._withId(parsedDoc.getEntries("Capacites")),
      DocAbilitySchema,
      "Capacites",
      issues,
    );
    const auras = this._parseEntries(
      this._withId(parsedDoc.getEntries("Auras")),
      DocAuraSchema,
      "Auras",
      issues,
    );
    const autocasts = this._parseEntries(
      this._withId(parsedDoc.getEntries("Lancements Automatiques")),
      DocAutocastSchema,
      "Lancements Automatiques",
      issues,
    );
    const waveSpecials = this._parseEntries(
      this._withId(parsedDoc.getEntries("Speciaux de Vagues")),
      DocWaveSpecialSchema,
      "Speciaux de Vagues",
      issues,
    );
    const missions = this._parseEntries(
      this._withId(parsedDoc.getEntries("Missions")),
      DocMissionSchema,
      "Missions",
      issues,
    );
    const recipes = this._parseEntries(
      this._withId(parsedDoc.getEntries("Recettes")),
      DocRecipeSchema,
      "Recettes",
      issues,
    );
    const wisdomUpgrades = this._parseEntries(
      this._withId(parsedDoc.getEntries("Ameliorations de Sagesse")),
      DocWisdomUpgradeSchema,
      "Ameliorations de Sagesse",
      issues,
    );
    const levelExperience = this._parseEntries(
      this._withLevel(parsedDoc.getEntries("Experience par Niveau")),
      DocExperienceEntrySchema,
      "Experience par Niveau",
      issues,
    );
    const playerLevelExperience = this._parseEntries(
      this._withLevel(parsedDoc.getEntries("Experience Joueur par Niveau")),
      DocExperienceEntrySchema,
      "Experience Joueur par Niveau",
      issues,
    );

    registry.registerMany("doc_towers", towers, "id");
    registry.registerMany("doc_builders", builders, "id");
    registry.registerMany("doc_items", items, "id");
    registry.registerMany("doc_abilities", abilities, "id");
    registry.registerMany("doc_auras", auras, "id");
    registry.registerMany("doc_autocasts", autocasts, "id");
    registry.registerMany("doc_wave_specials", waveSpecials, "id");
    registry.registerMany("doc_missions", missions, "id");
    registry.registerMany("doc_recipes", recipes, "id");
    registry.registerMany("doc_wisdom_upgrades", wisdomUpgrades, "id");
    registry.registerMany("doc_level_experience", levelExperience, "niveau");
    registry.registerMany("doc_player_level_experience", playerLevelExperience, "niveau");

    addIssuesForMissingRefs(towers, "ability_list", "doc_abilities", registry, issues, "tower");
    addIssuesForMissingRefs(towers, "aura_list", "doc_auras", registry, issues, "tower");
    addIssuesForMissingRefs(towers, "autocast_list", "doc_autocasts", registry, issues, "tower");
    addIssuesForMissingRefs(items, "aura_list", "doc_auras", registry, issues, "item");
    addIssuesForMissingRefs(items, "autocast_list", "doc_autocasts", registry, issues, "item");

    return {
      counts: {
        towers: towers.length,
        builders: builders.length,
        items: items.length,
        abilities: abilities.length,
        auras: auras.length,
        autocasts: autocasts.length,
        waveSpecials: waveSpecials.length,
        missions: missions.length,
        recipes: recipes.length,
        wisdomUpgrades: wisdomUpgrades.length,
        levelExperience: levelExperience.length,
        playerLevelExperience: playerLevelExperience.length,
      },
      specialPool: waveSpecials,
      issues,
    };
  }

  _parseEntries(entries, schema, sectionName, issues) {
    const valid = [];
    for (const entry of entries) {
      const parsed = schema.safeParse(entry);
      if (parsed.success) {
        valid.push(parsed.data);
        continue;
      }

      const entryId = Number.isFinite(entry?.id) ? entry.id : "?";
      const firstIssue = parsed.error.issues[0];
      const fieldPath = Array.isArray(firstIssue?.path) && firstIssue.path.length > 0
        ? firstIssue.path.join(".")
        : "entree";
      const reason = firstIssue?.message ?? "invalide";
      issues.push(`${sectionName}#${entryId} ignoree: ${fieldPath} (${reason})`);
    }

    return valid;
  }

  _withId(entries) {
    return entries.filter((entry) => Number.isInteger(entry.id));
  }

  _withLevel(entries) {
    return entries.filter((entry) => Number.isInteger(entry.niveau));
  }
}
