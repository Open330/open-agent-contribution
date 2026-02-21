import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type OacConfig, loadConfig } from "../core/index.js";

const DEFINE_CONFIG_IMPORT = /@(?:open330\/oac(?:-core)?|oac\/core)/;
const DEFINE_CONFIG_IMPORT_LINE =
  /^\s*import\s*\{\s*defineConfig\s*\}\s*from\s*["']@(?:open330\/oac(?:-core)?|oac\/core)["'];\s*$/m;
const LEGACY_DEFINE_CONFIG_EXPORT = /export\s+default\s+defineConfig\s*\(/;

export interface ConfigLoaderOptions {
  cwd?: string;
  onWarning?: (message: string) => void;
}

export async function loadOptionalConfigFile(
  configPath: string,
  options: ConfigLoaderOptions = {},
): Promise<OacConfig | null> {
  const absolutePath = resolve(options.cwd ?? process.cwd(), configPath);
  if (!(await pathExists(absolutePath))) {
    return null;
  }

  try {
    const candidate = await importConfigCandidate(absolutePath);
    return loadConfig(candidate);
  } catch (error) {
    options.onWarning?.(
      `Failed to load config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function importConfigCandidate(absolutePath: string): Promise<unknown> {
  try {
    return await importCandidate(`${pathToFileURL(absolutePath).href}?t=${Date.now()}`);
  } catch (error) {
    const fallbackCandidate = await importLegacyDefineConfigCandidate(absolutePath, error);
    if (fallbackCandidate !== null) {
      return fallbackCandidate;
    }

    throw error;
  }
}

async function importLegacyDefineConfigCandidate(
  absolutePath: string,
  error: unknown,
): Promise<unknown | null> {
  if (!shouldTryLegacyDefineConfigFallback(error)) {
    return null;
  }

  const source = await readFile(absolutePath, "utf8");
  const transformed = transformLegacyDefineConfigSource(source);
  if (transformed === null) {
    return null;
  }

  const encodedSource = Buffer.from(transformed, "utf8").toString("base64");
  return await importCandidate(`data:text/javascript;base64,${encodedSource}`);
}

function shouldTryLegacyDefineConfigFallback(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Node < 22.6: can't import .ts files directly → ERR_UNKNOWN_FILE_EXTENSION
  if ((error as NodeJS.ErrnoException).code === "ERR_UNKNOWN_FILE_EXTENSION") {
    return true;
  }

  // Node >= 22.6: strips types but can't resolve the @open330/oac package
  return DEFINE_CONFIG_IMPORT.test(error.message);
}

function transformLegacyDefineConfigSource(source: string): string | null {
  if (!DEFINE_CONFIG_IMPORT_LINE.test(source)) {
    return null;
  }

  if (!LEGACY_DEFINE_CONFIG_EXPORT.test(source)) {
    return null;
  }

  return source
    .replace(DEFINE_CONFIG_IMPORT_LINE, "")
    .replace(LEGACY_DEFINE_CONFIG_EXPORT, "export default (");
}

async function importCandidate(moduleSpecifier: string): Promise<unknown> {
  const imported = await import(moduleSpecifier);
  return imported.default ?? imported.config ?? imported;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
