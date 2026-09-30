import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package version, read from package.json so it never drifts from the published number. */
export const version: string = (require("../package.json") as { version: string }).version;
