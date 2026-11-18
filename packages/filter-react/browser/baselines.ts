import { join } from "node:path";

// Where the stored screenshots live. Text is drawn differently on each system and by each
// browser, so every pair of the two has its own folder:
//
//   browser/__screenshots__/<system>/<browser>/<name>.png

/** The folder that holds every stored screenshot, from the package's own folder. */
const BASELINE_FOLDER = "browser/__screenshots__";

/** The file a screenshot named `name` is stored in, for one browser on one system. */
export function baselinePath(at: {
  /** The package's own folder. */
  root: string;
  /** The system's name as Node gives it, such as "linux" or "darwin". */
  platform: string;
  browserName: string;
  name: string;
}): string {
  return join(
    at.root,
    BASELINE_FOLDER,
    at.platform,
    at.browserName,
    `${at.name}.png`,
  );
}
