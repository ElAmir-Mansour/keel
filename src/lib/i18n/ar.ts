import { shell } from "./ar/shell";
import { dashboard } from "./ar/dashboard";
import { issues } from "./ar/issues";
import { vault } from "./ar/vault";
import { settings } from "./ar/settings";
import { assistant } from "./ar/assistant";
import { timelines } from "./ar/timelines";
import { points } from "./ar/points";
import { graph } from "./ar/graph";

/** English → Arabic. Each area contributes its own file to avoid merge conflicts. */
export const ar: Record<string, string> = { ...shell, ...dashboard, ...issues, ...vault, ...settings, ...assistant, ...timelines, ...points, ...graph };
