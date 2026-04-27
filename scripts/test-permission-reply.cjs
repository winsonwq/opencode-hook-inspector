#!/usr/bin/env node
/**
 * E2E Test for Permission Reply Flow
 * 
 * Tests the complete flow:
 * 1. CLI starts and listens on Unix socket
 * 2. We send a fake permission.ask event
 * 3. CLI receives, sees canReply=true, auto-replies
 * 4. We verify the permission_reply was sent
 * 
 * Usage: node scripts/test-permission-reply.cjs [once|always|reject|ask]
 */

const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const SOCKET_PATH = '/tmp/ohi-e2e.sock';
const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

const replyOption = process.argv[2] || 'once';
const validOptions = ['once', 'always', 'reject', 'ask'];
if (!validOptions.includes(replyOption)) {
  console.error(`Usage: node test-permission-reply.cjs [${validOptions.join('|')}]`);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${ts}] ${msg}`);
}

function assert(cond, msg) {
  if (cond) {
    log(`✓ PASS: ${msg}`);
    passed++;
  } else {
    log(`✗ FAIL: ${msg}`);
    failed++;
  }
}

async function test() {
  log('=== Permission Reply E2E Test ===');
  log(`Reply option: ${replyOption}`);
  log('');

  // Start CLI with auto-reply
  log('Starting CLI with auto-reply...');
  const cli = spawn('node', [CLI_PATH], {
    env: { ...process.env, OHI_SOCKET: SOCKET_PATH, OHI_AUTO_REPLY: '1', OHI_AUTO_REPLY_OPTION: replyOption },
    stdio: 'pipe'
  });

  // Wait for CLI to start (1 second seems to work)
  await new Promise(r => setTimeout(r, 1000));

  // Connect as plugin and send permission.ask event
  log('Connecting to CLI socket...');
  const pluginSocket = net.createConnection(SOCKET_PATH);
  
  await new Promise(r => pluginSocket.on('connect', r));
  log('Connected');

  // Send permission.ask event
  const permId = `per_${Date.now()}`;
  const sessionId = `ses_${Date.now()}`;
  
  log(`Sending permission.ask event (id=${permId})...`);
  pluginSocket.write(JSON.stringify({
    type: 'hook_event',
    hook: 'permission.asked',
    input: { permissionId: permId, sessionId, permission: 'test.operation', patterns: ['/**'] },
    canReply: true,
    timestamp: new Date().toISOString()
  }) + '\n');

  // Wait for auto-reply
  log('Waiting for CLI to auto-reply...');
  let receivedReply = null;
  
  await new Promise(r => {
    let buffer = '';
    pluginSocket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'permission_reply') {
            receivedReply = msg;
            r();
          }
        } catch (e) {}
      }
    });
    // Timeout after 5 seconds
    setTimeout(r, 5000);
  });

  // Verify results
  log('');
  assert(receivedReply !== null, 'Plugin received permission_reply from CLI');
  
  if (receivedReply) {
    assert(receivedReply.reply === replyOption, `Reply option matches: ${receivedReply.reply} === ${replyOption}`);
    assert(receivedReply.permissionId === permId, `Permission ID preserved: ${receivedReply.permissionId}`);
  }

  // Cleanup
  log('');
  log('Cleaning up...');
  pluginSocket.end();
  cli.kill();
  await new Promise(r => setTimeout(r, 100));

  // Summary
  log('');
  log('═══════════════════════════════════════');
  log(`  Tests: ${passed} passed, ${failed} failed`);
  log('═══════════════════════════════════════');
  
  process.exit(failed > 0 ? 1 : 0);
}

test().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
