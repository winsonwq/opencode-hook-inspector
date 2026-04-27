#!/usr/bin/env node
/**
 * E2E Test for OHI Config System
 *
 * Tests:
 * 1. Config loading from multiple locations
 * 2. Config merging (later overrides earlier)
 * 3. Environment variable expansion
 * 4. Hook config application
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = '.ohi';
const GLOBAL_CONFIG_FILE = 'config.json';
const LOCAL_CONFIG_FILE = '.ohi.json';

let passed = 0;
let failed = 0;

function log(msg: string): void {
  const ts = new Date().toISOString().split('T')[1]?.slice(0, 12) || '';
  console.log(`[${ts}] ${msg}`);
}

function assert(cond: boolean, msg: string): void {
  if (cond) {
    log(`✓ PASS: ${msg}`);
    passed++;
  } else {
    log(`✗ FAIL: ${msg}`);
    failed++;
  }
}

function cleanup(): void {
  // Clean up test files in actual locations
  try {
    const globalDir = path.join(os.homedir(), CONFIG_DIR);
    fs.rmSync(globalDir, { recursive: true });
  } catch {}
  try {
    fs.unlinkSync(LOCAL_CONFIG_FILE);
  } catch {}
  try {
    const projectDir = path.join(process.cwd(), CONFIG_DIR);
    fs.rmSync(projectDir, { recursive: true });
  } catch {}
}

function mkdirp(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

async function test(): Promise<void> {
  log('=== OHI Config System E2E Test ===\n');

  // Import the config module
  const mod = await import('../dist/index.js');
  const { loadConfig, applyHookConfig } = mod;

  // Initial cleanup
  cleanup();

  // Test 1: Empty config when no files exist
  log('--- Test 1: Empty config ---');
  const emptyConfig = loadConfig();
  assert(
    Object.keys(emptyConfig.hooks || {}).length === 0,
    'No hooks when no config files exist'
  );

  // Test 2: Load global config
  log('\n--- Test 2: Global config ---');
  const globalDir = path.join(os.homedir(), CONFIG_DIR);
  mkdirp(globalDir);
  const globalConfigPath = path.join(globalDir, GLOBAL_CONFIG_FILE);
  fs.writeFileSync(globalConfigPath, JSON.stringify({
    hooks: {
      'chat.params': {
        temperature: 0.5
      }
    }
  }, null, 2));

  // loadConfig reads files each time, no cache to clear
  const config2 = loadConfig();
  assert(
    config2.hooks?.['chat.params']?.temperature === 0.5,
    'Global config loaded'
  );

  // Test 3: Local config overrides global
  log('\n--- Test 3: Config override (local over global) ---');
  fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify({
    hooks: {
      'chat.params': {
        temperature: 0.9,
        topP: 0.95
      }
    }
  }, null, 2));

  const config3 = loadConfig();
  assert(
    config3.hooks?.['chat.params']?.temperature === 0.9,
    'Local config overrides global temperature'
  );
  assert(
    config3.hooks?.['chat.params']?.topP === 0.95,
    'Local config adds new field (topP)'
  );

  // Test 4: Environment variable expansion
  log('\n--- Test 4: Environment variable expansion ---');
  process.env.TEST_TEMP = '0.123';
  process.env.TEST_CUSTOM_DIR = '/custom/path';

  fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify({
    hooks: {
      'chat.params': {
        temperature: '${TEST_TEMP}'
      },
      'tool.definition': {
        description: 'Tool for $TEST_CUSTOM_DIR'
      }
    }
  }, null, 2));

  const config4 = loadConfig();
  assert(
    config4.hooks?.['chat.params']?.temperature === '0.123',
    'Environment variable ${TEST_TEMP} expanded'
  );
  assert(
    config4.hooks?.['tool.definition']?.description === 'Tool for /custom/path',
    'Environment variable $TEST_CUSTOM_DIR expanded'
  );

  // Test 5: Apply config to output
  log('\n--- Test 5: Apply config to hook output ---');
  cleanup();
  mkdirp(path.join(os.homedir(), CONFIG_DIR));
  fs.writeFileSync(globalConfigPath, JSON.stringify({
    hooks: {
      'chat.params': {
        temperature: 0.8,
        topP: 0.92
      }
    }
  }, null, 2));

  const config5 = loadConfig();

  const mockOutput = {
    temperature: 0.7,
    topP: 0.9,
    topK: 100
  };

  const applied = applyHookConfig('chat.params', mockOutput, config5);
  assert(applied === true, 'Config was applied');
  assert(mockOutput.temperature === 0.8, 'Temperature overridden by config');
  assert(mockOutput.topP === 0.92, 'topP overridden by config');
  assert(mockOutput.topK === 100, 'topK preserved (not in config)');

  // Test 6: Apply config to non-existent hook
  log('\n--- Test 6: Apply config to unknown hook ---');
  const output2 = { temperature: 0.5 };
  const applied2 = applyHookConfig('nonexistent.hook', output2, config5);
  assert(applied2 === false, 'No config applied for unknown hook');
  assert(output2.temperature === 0.5, 'Original value preserved');

  // Test 7: Complex nested config
  log('\n--- Test 7: Complex nested config ---');
  cleanup();
  mkdirp(path.join(os.homedir(), CONFIG_DIR));
  fs.writeFileSync(globalConfigPath, JSON.stringify({
    hooks: {
      'experimental.session.compacting': {
        context: ['Remember to add comments', 'Check edge cases']
      },
      'experimental.chat.system.transform': {
        system: ['You are an expert programmer.']
      }
    }
  }, null, 2));

  const config7 = loadConfig();

  const compactingOutput: Record<string, unknown> = { context: [] as string[], prompt: undefined };
  applyHookConfig('experimental.session.compacting', compactingOutput, config7);
  assert(
    (compactingOutput.context as string[])?.length === 2,
    'Context array applied correctly'
  );
  assert(
    (compactingOutput.context as string[])?.[0] === 'Remember to add comments',
    'First context item correct'
  );

  const systemOutput: Record<string, unknown> = { system: [] as string[] };
  applyHookConfig('experimental.chat.system.transform', systemOutput, config7);
  assert(
    (systemOutput.system as string[])?.[0] === 'You are an expert programmer.',
    'System prompt applied correctly'
  );

  // Cleanup
  cleanup();
  delete process.env.TEST_TEMP;
  delete process.env.TEST_CUSTOM_DIR;

  // Summary
  log('\n═══════════════════════════════════════');
  log(`  Tests: ${passed} passed, ${failed} failed`);
  log('═══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

test().catch((err) => {
  console.error('Test error:', err);
  cleanup();
  delete process.env.TEST_TEMP;
  delete process.env.TEST_CUSTOM_DIR;
  process.exit(1);
});
