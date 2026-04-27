#!/usr/bin/env node
/**
 * E2E Test for Permission Reply Flow
 *
 * Tests the complete flow:
 * 1. Plugin starts and connects to Unix socket
 * 2. Permission.asked event is sent
 * 3. CLI receives and auto-replies
 * 4. Plugin sends API reply
 */

import net from 'net';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_PATH = '/tmp/ohi-e2e.sock';
const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

interface TestResult {
  passed: number;
  failed: number;
}

let result: TestResult = { passed: 0, failed: 0 };

function log(msg: string): void {
  const ts = new Date().toISOString().split('T')[1]?.slice(0, 12) || '';
  console.log(`[${ts}] ${msg}`);
}

function assert(cond: boolean, msg: string): void {
  if (cond) {
    log(`✓ PASS: ${msg}`);
    result.passed++;
  } else {
    log(`✗ FAIL: ${msg}`);
    result.failed++;
  }
}

interface PermissionReply {
  type: string;
  permissionId: string;
  sessionId: string;
  reply: string;
}

async function testPermissionReply(replyOption: string): Promise<void> {
  const validOptions = ['once', 'always', 'reject', 'ask'];
  if (!validOptions.includes(replyOption)) {
    console.error(`Usage: node test-permission.ts [${validOptions.join('|')}]`);
    process.exit(1);
  }

  log(`=== Permission Reply E2E Test ===`);
  log(`Reply option: ${replyOption}\n`);

  // Clean up any existing socket
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  // Start CLI with auto-reply
  log('Starting CLI with auto-reply...');
  const cli = spawn('node', [CLI_PATH], {
    env: { ...process.env, OHI_SOCKET: SOCKET_PATH, OHI_AUTO_REPLY: '1', OHI_AUTO_REPLY_OPTION: replyOption },
    stdio: 'pipe'
  });

  // Wait for CLI to start
  await new Promise(r => setTimeout(r, 1500));

  // Connect as plugin and send permission.asked event
  log('Connecting to CLI socket...');
  const pluginSocket = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => resolve(sock));
    sock.on('error', reject);
  });
  log('Connected');

  // Send permission.asked event
  const permId = `per_${Date.now()}`;
  const sessionId = `ses_${Date.now()}`;

  log(`Sending permission.asked event (id=${permId})...`);
  pluginSocket.write(JSON.stringify({
    type: 'hook_event',
    hook: 'permission.asked',
    input: {
      permissionId: permId,
      sessionId: sessionId,
      permission: 'external_directory',
      patterns: ['/Users/aqiu/Downloads/*']
    },
    canReply: true,
    timestamp: new Date().toISOString()
  }) + '\n');

  // Wait for auto-reply
  log('Waiting for CLI to auto-reply...');
  let receivedReply: PermissionReply | null = null;

  await new Promise<void>((resolve) => {
    let buffer = '';
    pluginSocket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'permission_reply') {
            receivedReply = msg as PermissionReply;
            resolve();
          }
        } catch (e) {}
      }
    });
    // Timeout after 5 seconds
    setTimeout(resolve, 5000);
  });

  // Verify results
  log('');
  assert(receivedReply !== null, 'Plugin received permission_reply from CLI');

  if (receivedReply) {
    assert(receivedReply.reply === replyOption, `Reply option matches: ${receivedReply.reply} === ${replyOption}`);
    assert(receivedReply.permissionId === permId, `Permission ID preserved: ${receivedReply.permissionId}`);
    assert(receivedReply.sessionId === sessionId, `Session ID preserved: ${receivedReply.sessionId}`);
  }

  // Cleanup
  log('\nCleaning up...');
  pluginSocket.end();
  cli.kill();
  await new Promise(r => setTimeout(r, 100));
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replyOption = args[0] || 'once';

  await testPermissionReply(replyOption);

  // Summary
  log('');
  log('═══════════════════════════════════════');
  log(`  Tests: ${result.passed} passed, ${result.failed} failed`);
  log('═══════════════════════════════════════');

  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
