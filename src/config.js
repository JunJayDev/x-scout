// Local configuration for the CLI and the stdio server (Node only).
// Environment variables win; otherwise keys come from
//   $X_SCOUT_CONFIG, or $XDG_CONFIG_HOME/x-scout/config.env, or ~/.config/x-scout/config.env
// The file holds KEY=value lines, is created with mode 0600, and is never printed.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_KEYS = ["XAI_API_KEY", "XAI_MODEL", "X_SEARCH_ENDPOINT", "X_SEARCH_API_KEY"];

export function configDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "x-scout");
}

export function configPath(env = process.env) {
  return env.X_SCOUT_CONFIG || join(configDir(env), "config.env");
}

export function readConfigFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** process.env merged over the config file. */
export function loadEnv(env = process.env) {
  const file = readConfigFile(configPath(env));
  const merged = { ...file };
  // A plugin host that could not fill a value may pass the placeholder through ("${user_config.x}").
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "" && !/^\$\{[^}]*\}$/.test(v)) merged[k] = v;
  return merged;
}

export function writeConfigValue(key, value, env = process.env) {
  const path = configPath(env);
  const current = readConfigFile(path);
  if (value === null || value === "") delete current[key];
  else current[key] = value;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = Object.entries(current).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
