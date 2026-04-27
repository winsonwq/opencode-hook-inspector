// Config loader for OHI - loads from multiple locations
import fs from 'fs';
import path from 'path';
import os from 'os';
import { OHIConfig } from './types.js';

const CONFIG_FILE = '.ohi.json';
const CONFIG_DIR = '.ohi';
const GLOBAL_CONFIG_FILE = 'config.json';

function expandEnvVariables(obj: any): any {
  if (typeof obj === 'string') {
    // Expand ${VAR} and $VAR patterns
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    }).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVariables);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVariables(value);
    }
    return result;
  }
  return obj;
}

function loadJsonFile(filePath: string): OHIConfig | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      debugLog(`[OHI] Loaded config from ${filePath}`);
      return expandEnvVariables(config);
    }
  } catch (err) {
    debugLog(`[OHI] Failed to load config from ${filePath}: ${err}`);
  }
  return null;
}

function debugLog(msg: string): void {
  // Simple debug logging to file
  const DEBUG_FILE = '/tmp/ohi-debug.log';
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(DEBUG_FILE, `[${timestamp}] ${msg}\n`);
  } catch {
    // Ignore
  }
}

export function loadConfig(): OHIConfig {
  const configs: OHIConfig[] = [];

  // 1. Global config: ~/.ohi/config.json
  const globalConfigPath = path.join(os.homedir(), CONFIG_DIR, GLOBAL_CONFIG_FILE);
  const globalConfig = loadJsonFile(globalConfigPath);
  if (globalConfig) configs.push(globalConfig);

  // 2. Local config: ./.ohi.json
  const localConfig = loadJsonFile(CONFIG_FILE);
  if (localConfig) configs.push(localConfig);

  // 3. Project config: ./.ohi/config.json
  const projectConfigPath = path.join(process.cwd(), CONFIG_DIR, GLOBAL_CONFIG_FILE);
  const projectConfig = loadJsonFile(projectConfigPath);
  if (projectConfig) configs.push(projectConfig);

  // Merge configs (later configs override earlier ones)
  return mergeConfigs(configs);
}

function mergeConfigs(configs: OHIConfig[]): OHIConfig {
  const result: OHIConfig = {
    version: '1.0',
    hooks: {}
  };

  for (const config of configs) {
    if (config.version) result.version = config.version;
    if (config.env) result.env = { ...result.env, ...config.env };
    if (config.hooks) {
      for (const [hookName, hookConfig] of Object.entries(config.hooks)) {
        if (!result.hooks) result.hooks = {};
        const existing = (result.hooks as any)[hookName] || {};
        (result.hooks as any)[hookName] = { ...existing, ...(hookConfig as any) };
      }
    }
  }

  debugLog(`[OHI] Merged config: ${JSON.stringify(Object.keys(result.hooks || {}))}`);
  return result;
}

// Apply config values to output object
export function applyHookConfig(hookName: string, output: any, config: OHIConfig): boolean {
  const hookConfig = config.hooks?.[hookName as keyof OHIConfig['hooks']];
  if (!hookConfig || !output) return false;

  let applied = false;
  for (const [key, value] of Object.entries(hookConfig)) {
    if (value !== undefined) {
      (output as any)[key] = value;
      applied = true;
      debugLog(`[OHI] Applied config: ${hookName}.${key} = ${JSON.stringify(value)}`);
    }
  }

  return applied;
}
