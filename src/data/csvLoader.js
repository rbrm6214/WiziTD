import Papa from "papaparse";
import { TowerArraySchema } from "./schemas.js";

export class CsvLoader {
  parseTowers(csvText) {
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      transform: (value) => value.trim(),
    });

    if (parsed.errors.length > 0) {
      throw new Error(`CSV parsing errors: ${parsed.errors[0].message}`);
    }

    return TowerArraySchema.parse(parsed.data);
  }
}
