#!/usr/bin/env node
/**
 * CLI entry point for OHI - Opencode Hook Inspector
 */

import { existsSync, symlinkSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'readline';
import net from 'net';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOCKET_PATH = process.env.OHI_SOCKET || '/tmp/ohi.sock';

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
${chalk.bold('OHI - Opencode Hook Inspector')}

${chalk.cyan('Usage:')}
  ${chalk.green('ohi')}              Start inspector
  ${chalk.green('ohi unlink')}        Remove plugin from opencode
  ${chalk.green('ohi --help')}        Show this help
`);
}

interface IPCMessage {
  type: string;
  [key: string]: unknown;
}

// Unlink plugin from opencode
function unlink(): void {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || resolve(process.env.HOME || '~', '.config');
  const opencodeDir = resolve(xdgConfigHome, 'opencode');
  const configPath = resolve(opencodeDir, 'opencode.json');
  const linkPath = resolve(opencodeDir, 'plugins', 'opencode-hook-inspector');

  console.log('🔗 Opencode Hook Inspector - Unlinking\n');

  if (existsSync(linkPath)) {
    try {
      unlinkSync(linkPath);
      console.log('✓ Removed plugin symlink');
    } catch {
      console.log('⚠️  Could not remove symlink');
    }
  } else {
    console.log('✓ No plugin symlink found');
  }

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { plugin?: string[] };
      if (config.plugin) {
        const before = config.plugin.length;
        config.plugin = config.plugin.filter((p: string) => !p.includes('opencode-hook-inspector'));
        if (config.plugin.length < before) {
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          console.log('✓ Updated opencode.json');
        }
      }
    } catch {
      console.log('⚠️  Could not update config');
    }
  }

  console.log('\n✅ Plugin unlinked!\n');
}

// State
let pluginSocket: net.Socket | null = null;
let buffer = '';
let hookHistory: Array<{ hook: string; timestamp?: string }> = [];
let isPrompting = false;

function printHeader(): void {
  console.log(chalk.bold.cyan(`
  ╔═══════════════════════════════════════════════════╗
  ║       Opencode Hook Inspector                      ║
  ╚═══════════════════════════════════════════════════╝`));
}

function displayHook(msg: IPCMessage): void {
  const hook = String(msg.hook || '');
  const timestamp = msg.timestamp as string | undefined;
  const input = msg.input as Record<string, unknown> | undefined;
  const output = msg.output as Record<string, unknown> | undefined;
  const contextLength = msg.contextLength as number | undefined;

  const timeStr = timestamp?.split('T')[1]?.slice(0, 12) || '';

  hookHistory.push({ hook, timestamp });
  if (hookHistory.length > 50) hookHistory.shift();

  console.log(chalk.bold(`\n[${timeStr}] `) + chalk.yellow('[HOOK] ') + chalk.bold.cyan(`[${hook}]`) + chalk.green(' CALLED'));

  if (input && Object.keys(input).length > 0) {
    console.log(`  ${chalk.cyan('INPUT:')}`);
    const inputStr = JSON.stringify(input, null, 2);
    inputStr.split('\n').forEach(line => {
      console.log(`    ${chalk.cyan(line)}`);
    });
  }

  if (output && Object.keys(output).length > 0) {
    console.log(`  ${chalk.magenta('OUTPUT:')}`);
    const outputStr = JSON.stringify(output, null, 2);
    outputStr.split('\n').forEach(line => {
      console.log(`    ${chalk.magenta(line)}`);
    });
  }

  if (contextLength !== undefined) {
    console.log(chalk.dim(`  Context items: ${contextLength}`));
  }

  console.log(chalk.dim('─'.repeat(60)));
}

function handleMessage(msg: IPCMessage): void {
  if (msg.type === 'hook_event') {
    displayHook(msg);
  }
}
function promptForContext(): void {
  if (isPrompting) return;
  isPrompting = true;

  console.log(chalk.bold.green('\n  💡 Context injection available\n'));
  console.log(chalk.cyan('  Enter context to inject (empty to skip, "cancel" to abort):\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(chalk.green('  > '), (input: string) => {
    rl.close();

    if (input.trim() === 'cancel') {
      console.log(chalk.yellow('  [Cancelled]'));
    } else if (input.trim()) {
      injectContext(input);
    }

    isPrompting = false;
  });
}

function injectContext(text: string): void {
  console.log(chalk.green(`\n  [Injecting] "${text}"`));
  if (pluginSocket && !pluginSocket.destroyed) {
    pluginSocket.write(JSON.stringify({
      type: 'inject_context',
      text
    }) + '\n');
  }
}

function handleClient(socket: net.Socket): void {
  if (!pluginSocket) {
    pluginSocket = socket;
    console.log(chalk.cyan('  [Plugin connected]\n'));
  }

  socket.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as IPCMessage;
        handleMessage(msg);
      } catch { /* ignore */ }
    }
  });

  socket.on('end', () => {
    if (socket === pluginSocket) {
      pluginSocket = null;
      console.log(chalk.yellow('\n  [Plugin disconnected]'));
    }
  });

  socket.on('error', () => {
    if (socket === pluginSocket) {
      pluginSocket = null;
    }
  });
}

async function startServer(): Promise<void> {
  // Remove existing socket
  try {
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      handleClient(socket);
    });

    server.on('error', (err: Error) => {
      console.error('Server error:', err);
      reject(err);
    });

    server.listen(SOCKET_PATH, () => {
      printHeader();
      console.log(chalk.green(`\n  ✅ Inspector running`));
      console.log(chalk.gray(`  Socket: ${SOCKET_PATH}\n`));
      console.log(chalk.gray('  Waiting for hooks...\n'));
      resolve();
    });
  });
}

async function main(): Promise<void> {
  if (command === '--help' || command === '-h' || command === 'help') {
    showHelp();
    process.exit(0);
  }

  if (command === 'unlink') {
    unlink();
    process.exit(0);
  }

  // Start server
  await startServer();

  // Keep running
  await new Promise(() => {});
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
