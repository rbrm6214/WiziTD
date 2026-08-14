import { describe, expect, it } from "vitest";
import { DataRegistry } from "../data/dataRegistry.js";
import { createMissionPresets } from "./missionSystem.js";

describe("createMissionPresets", () => {
  it("builds presets from documentation missions", () => {
    const registry = new DataRegistry();
    registry.registerMany(
      "doc_missions",
      [
        {
          id: "m_doc_1",
          title: "Doc Mission",
          waveTarget: 33,
          startGold: 210,
          portalLives: 13,
          modifiers: { heavy: true },
        },
      ],
      "id",
    );

    const setup = createMissionPresets(registry);
    expect(setup.source).toBe("documentation");
    expect(setup.order).toEqual(["m_doc_1"]);
    expect(setup.presets.m_doc_1.waveTarget).toBe(33);
    expect(setup.presets.m_doc_1.startingGold).toBe(210);
    expect(setup.presets.m_doc_1.portalLives).toBe(13);
  });

  it("falls back when no mission is documented", () => {
    const registry = new DataRegistry();
    const setup = createMissionPresets(registry);
    expect(setup.source).toBe("fallback");
    expect(setup.order.length).toBeGreaterThan(0);
    expect(setup.presets[setup.order[0]].waveTarget).toBeGreaterThan(0);
  });
});
