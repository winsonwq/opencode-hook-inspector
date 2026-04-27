#!/usr/bin/env node
/**
 * Postinstall script - links this plugin to opencode
 */

const { existsSync, mkdirSync, symlinkSync, readlinkSync, unlinkSync, readFileSync, writeFileSync, statSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const projectRoot = resolve(__dirname, '..');

console.log('🔗 Opencode Hook Inspector - Linking');
console.log('=======================================\n');

// Find opencode config directory
const xdgConfigHome = process.env.XDG_CONFIG_HOME || resolve(process.env.HOME || '~', '.config');
const legacyDir = resolve(process.env.HOME || '~', '.opencode');

let opencodeDir = '';
if (existsSync(resolve(xdgConfigHome, 'opencode'))) {
  opencodeDir = resolve(xdgConfigHome, 'opencode');
} else if (existsSync(legacyDir)) {
  opencodeDir = legacyDir;
} else {
  opencodeDir = resolve(xdgConfigHome, 'opencode');
  mkdirSync(opencodeDir, { recursive: true });
}

const pluginsDir = resolve(opencodeDir, 'plugins');
const configPath = resolve(opencodeDir, 'opencode.json');
const linkPath = resolve(pluginsDir, 'opencode-hook-inspector');
const distIndex = resolve(projectRoot, 'dist', 'index.js');

console.log(`📁 Opencode config directory: ${opencodeDir}`);

// Create plugins directory if it doesn't exist
if (!existsSync(pluginsDir)) {
  console.log(`📁 Creating plugins directory: ${pluginsDir}`);
  mkdirSync(pluginsDir, { recursive: true });
}

// Check if dist exists
if (!existsSync(distIndex)) {
  console.log('\n⚠️  Warning: dist/index.js not found. Run "npm run build" first.');
  console.log('   Skipping plugin link. Run "npm run build && npm install" again.\n');
  process.exit(0);
}

// Remove existing symlink if it exists
if (existsSync(linkPath)) {
  try {
    const existing = readlinkSync(linkPath);
    if (existing === projectRoot) {
      console.log('✓ Plugin symlink already exists!');
    } else {
      console.log('🗑️  Removing existing link...');
      unlinkSync(linkPath);
      symlinkSync(projectRoot, linkPath, 'junction');
      console.log('✓ Plugin symlink created!');
    }
  } catch {
    console.log('🗑️  Removing existing file...');
    unlinkSync(linkPath);
    symlinkSync(projectRoot, linkPath, 'junction');
    console.log('✓ Plugin symlink created!');
  }
} else {
  console.log(`🔗 Creating symlink...`);
  symlinkSync(projectRoot, linkPath, 'junction');
  console.log('✓ Plugin symlink created!');
}

// Update opencode.json to include this plugin
let config = {};
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    config = { "$schema": "https://opencode.ai/config.json" };
  }
} else {
  config = { "$schema": "https://opencode.ai/config.json" };
}

const pluginEntry = `file://${distIndex}`;
config.plugin = config.plugin || [];

// Remove existing entry for this plugin
config.plugin = config.plugin.filter(p => !p.includes('opencode-hook-inspector'));
// Add this plugin
config.plugin.push(pluginEntry);

writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`\n📝 Updated config: ${configPath}`);

console.log('\n✅ Plugin linked successfully!');
console.log('\nRestart opencode to see the hook logs!\n');
