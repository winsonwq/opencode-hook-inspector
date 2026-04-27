#!/usr/bin/env node
/**
 * CLI entry point for OHI - Opencode Hook Inspector
 */

import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
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

${chalk.cyan('Configuration:')}
  ${chalk.gray('~/.ohi/config.json')}   Global config (user home directory)
  ${chalk.gray('./.ohi.json')}         Local config (current directory)
  ${chalk.gray('./.ohi/config.json')}   Project config
`);
}

interface IPCMessage {
  type: string;
  [key: string]: unknown;
}

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
let pendingRl: readline.Interface | null = null;
let hookQueue: IPCMessage[] = [];  // Queue hooks while prompting
let currentPromptInfo: { type: string; input?: any } | null = null;  // Track current prompt

function printHeader(): void {
  console.log(chalk.bold.cyan(`
  ╔════════════════════════════════════════════════╗
  ║       OpenCode Hook Inspector                    ║
  ╚════════════════════════════════════════════════╝`));
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

function flushHookQueue(): void {
  if (hookQueue.length === 0) return;

  console.log(chalk.dim(`\n  ── Queued ${hookQueue.length} hook(s) during prompt ──\n`));

  for (const queuedMsg of hookQueue) {
    displayHook(queuedMsg);
  }
  hookQueue = [];
}

function handleMessage(msg: IPCMessage): void {
  if (msg.type === 'hook_event') {
    const hook = msg.hook as string;

    // If prompting is active, queue this hook for later
    if (isPrompting && hook !== currentPromptInfo?.type) {
      hookQueue.push(msg);
      return;
    }

    displayHook(msg);

    // Handle permission.asked with interactive reply
    if (hook === 'permission.asked' && msg.canReply) {
      const input = msg.input as { permissionId: string; sessionId: string; permission: string; patterns: string[] };
      if (input?.permissionId) {
        currentPromptInfo = { type: 'permission.asked', input };
        promptForPermissionReply(input);
      }
    } else if (msg.canInjectContext) {
      currentPromptInfo = { type: 'context.inject' };
      promptForContext();
    }
  }
}

function promptForPermissionReply(input: { permissionId: string; sessionId: string; permission: string; patterns: string[] }): void {
  if (isPrompting) return;
  isPrompting = true;

  console.log(chalk.bold(`\n  🔐 ${chalk.cyan('Permission Request')} - ${input.permission}\n`));
  
  if (input.patterns && input.patterns.length > 0) {
    console.log(chalk.gray('  Patterns:'));
    input.patterns.forEach((p: string) => console.log(chalk.gray(`    - ${p}`)));
  }
  
  console.log(chalk.cyan('\n  Choose a reply:\n'));
  console.log(chalk.green('    [1] Once    ') + chalk.gray('- Allow this time only'));
  console.log(chalk.green('    [2] Always  ') + chalk.gray('- Always allow for this permission'));
  console.log(chalk.red('    [3] Reject  ') + chalk.gray('- Deny this request'));
  console.log(chalk.gray('    [4] Ask     ') + chalk.gray('- Let OpenCode ask normally (default)\n'));

  // Test mode: auto-reply after delay (for testing without user input)
  // Usage: OHI_AUTO_REPLY=1 OHI_AUTO_REPLY_OPTION=once ./bin/cli.js
  const autoReply = process.env.OHI_AUTO_REPLY;
  const autoReplyOption = process.env.OHI_AUTO_REPLY_OPTION || 'once';
  
  if (autoReply) {
    console.log(chalk.gray(`  [AUTO-REPLY MODE: ${autoReplyOption}]\n`));
    setTimeout(() => {
      console.log(chalk.green(`  [Auto-Replying: ${autoReplyOption.toUpperCase()}]`));
      sendPermissionReply(input.permissionId, input.sessionId, autoReplyOption);
      isPrompting = false;
      currentPromptInfo = null;
      flushHookQueue();
    }, 500);
    return;
  }

  pendingRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  pendingRl.question(chalk.green('  > '), (answer: string) => {
    pendingRl?.close();
    pendingRl = null;

    let reply: string = 'ask';

    switch (answer.trim()) {
      case '1': reply = 'once'; break;
      case '2': reply = 'always'; break;
      case '3': reply = 'reject'; break;
      case '4': reply = 'ask'; break;
      default:
        console.log(chalk.yellow('  [Defaulting to Ask]'));
        break;
    }

    console.log(chalk.green(`\n  [Replying: ${reply.toUpperCase()}]`));
    sendPermissionReply(input.permissionId, input.sessionId, reply);

    isPrompting = false;
    currentPromptInfo = null;
    flushHookQueue();
  });
}

function sendPermissionReply(permissionId: string, sessionId: string, reply: string): void {
  if (pluginSocket && !pluginSocket.destroyed) {
    pluginSocket.write(JSON.stringify({
      type: 'permission_reply',
      permissionId,
      sessionId,
      reply
    }) + '\n');
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
    currentPromptInfo = null;
    flushHookQueue();
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

  await startServer();
  await new Promise(() => {});
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
