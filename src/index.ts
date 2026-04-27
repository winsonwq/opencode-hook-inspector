// Hook Inspector Plugin for OpenCode
import net from 'net';
import fs from 'fs';

const SOCKET_PATH = process.env.OHI_SOCKET || '/tmp/ohi.sock';
const DEBUG_FILE = '/tmp/ohi-debug.log';

function debugLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(DEBUG_FILE, line);
}

interface IPCMessage {
  type: string;
  [key: string]: any;
}

let socket: net.Socket | null = null;
let buffer = '';
let pendingContext: string[] = [];
let connectionReady: Promise<net.Socket | null> | null = null;

let pendingPermissionReplies: Map<string, { sessionId: string; chosen: string }> = new Map();
let pendingPermissionRequests: Set<string> = new Set();
let opencodeClient: any = null;

async function handlePermissionReply(msg: IPCMessage) {
  const { permissionId, reply, sessionId } = msg;
  debugLog(`[OHI] Received permission_reply: permissionId=${permissionId}, reply=${reply}, sessionId=${sessionId}`);

  pendingPermissionReplies.set(permissionId, {
    sessionId: msg.sessionId || sessionId,
    chosen: reply
  });

  // If this permission was requested by us, send API reply immediately
  if (pendingPermissionRequests.has(permissionId) && opencodeClient) {
    pendingPermissionRequests.delete(permissionId);
    debugLog(`[OHI] Sending permission reply via API: ${reply} for ${permissionId}, sessionId=${sessionId}`);
    try {
      await opencodeClient.postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response: reply }
      });
      debugLog(`[OHI] API reply sent successfully`);
    } catch (err) {
      debugLog(`[OHI] API reply failed: ${err}`);
    }
  }
}

function extractPermissionPayload(input: any) {
  const props = input?.properties || input || {};
  return {
    permissionId: props?.id || props?.permissionId,
    permissionType: props?.permission || props?.type,
    patterns: props?.patterns || [],
    metadata: props?.metadata || {},
    sessionId: props?.sessionId || props?.sessionID,
  };
}

async function waitForPermissionReply(permissionId: string): Promise<string | null> {
  const timeoutMs = 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const reply = pendingPermissionReplies.get(permissionId);
    if (reply) {
      pendingPermissionReplies.delete(permissionId);
      return reply.chosen;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

function applyPermissionStatus(output: any, chosen: string) {
  switch (chosen) {
    case '1':
    case 'once':
      output.status = 'allow';
      break;
    case '2':
    case 'always':
      output.status = 'allow';
      break;
    case '3':
    case 'reject':
      output.status = 'deny';
      break;
    case '4':
    case 'ask':
    default:
      output.status = 'ask';
      break;
  }
}

export const HookInspector = async (_ctx: any) => {
  // Capture client for API calls
  opencodeClient = _ctx?.client;

  function connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        socket = sock;
        sock.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg: IPCMessage = JSON.parse(line);
              if (msg.type === 'inject_context' && msg.text) {
                pendingContext.push(msg.text);
              }
              if (msg.type === 'permission_reply' && msg.permissionId && msg.reply) {
                handlePermissionReply(msg);
              }
            } catch {
              // Ignore
            }
          }
        });
        sock.on('error', () => { socket = null; });
        sock.on('close', () => { socket = null; });
        resolve(sock);
      });
      sock.on('error', () => { socket = null; reject(new Error('Connection failed')); });
    });
  }

  connectionReady = connect().catch(() => null);

  async function sendMessage(msg: IPCMessage) {
    await connectionReady;
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n');
    }
  }

  return {
    // Generic event handler - catches all events
    event: async ({ event }: { event: any }) => {
      const hookName = event?.type || 'unknown';

      // For permission.asked, extract and normalize the data
      if (hookName === 'permission.asked') {
        const props = event?.properties || event || {};
        const permissionId = props?.id;
        const sessionId = props?.sessionId || props?.sessionID;

        // Mark this as a pending request so we can reply when CLI sends reply
        if (permissionId) {
          pendingPermissionRequests.add(permissionId);
        }

        sendMessage({
          type: 'hook_event',
          hook: hookName,
          input: {
            permissionId,
            sessionId,
            permission: props?.permission || props?.type,
            patterns: props?.patterns || [],
            metadata: props?.metadata || {},
          },
          canReply: true,
          timestamp: new Date().toISOString(),
        });

        // Check if we already have a pending reply from CLI and send via API
        const reply = pendingPermissionReplies.get(permissionId);
        if (reply && opencodeClient && permissionId) {
          pendingPermissionRequests.delete(permissionId);
          pendingPermissionReplies.delete(permissionId);
          debugLog(`[OHI] event: sending permission reply via API: ${reply.chosen} for ${permissionId}, sessionId=${sessionId}`);
          try {
            await opencodeClient.postSessionIdPermissionsPermissionId({
              path: { id: sessionId, permissionID: permissionId },
              body: { response: reply.chosen }
            });
            debugLog(`[OHI] event: API reply sent successfully`);
          } catch (err) {
            debugLog(`[OHI] event: API reply failed: ${err}`);
          }
        }
        return;
      }

      sendMessage({
        type: 'hook_event',
        hook: hookName,
        input: event,
        timestamp: new Date().toISOString(),
      });
    },

    "shell.env": async (input: any, output: any) => {
      sendMessage({
        type: 'hook_event',
        hook: 'shell.env',
        input,
        output: output.env,
        timestamp: new Date().toISOString(),
      });
    },

    "tool.execute.before": async (input: any, output: any) => {
      sendMessage({
        type: 'hook_event',
        hook: 'tool.execute.before',
        input,
        output: output.args,
        timestamp: new Date().toISOString(),
      });
    },

    "experimental.session.compacting": async (input: any, output: any) => {
      const contextLength = output.context?.length || 0;

      sendMessage({
        type: 'hook_event',
        hook: 'experimental.session.compacting',
        input: { sessionId: input.sessionId },
        contextLength,
        canInjectContext: true,
        timestamp: new Date().toISOString(),
      });

      if (pendingContext.length > 0 && output.context) {
        for (const text of pendingContext) {
          output.context.push(`## Inspector Injection\n${text}`);
        }
        pendingContext = [];
      }
    },

    // Permission asked event - observation only
    "permission.asked": async (input: any, output: any) => {
      const { permissionId, permissionType, patterns, metadata, sessionId } = extractPermissionPayload(input);
      debugLog(`[OHI] permission.asked(event): id=${permissionId}, type=${permissionType}, sessionId=${sessionId}`);
      sendMessage({
        type: 'hook_event',
        hook: 'permission.asked',
        input: {
          permissionId,
          sessionId,
          permission: permissionType,
          patterns,
          metadata,
        },
        canReply: false,
        timestamp: new Date().toISOString(),
      });
      output.status = 'ask';
    },

    // Permission ask hook - interception point for pause + injected response
    "permission.ask": async (input: any, output: any) => {
      const { permissionId, permissionType, patterns, metadata, sessionId } = extractPermissionPayload(input);
      const canReply = Boolean(permissionId);

      debugLog(`[OHI] permission.ask(hook): id=${permissionId}, type=${permissionType}, sessionId=${sessionId}, canReply=${canReply}`);

      sendMessage({
        type: 'hook_event',
        hook: 'permission.ask',
        input: {
          permissionId,
          sessionId,
          permission: permissionType,
          patterns,
          metadata,
        },
        canReply,
        timestamp: new Date().toISOString(),
      });

      if (!permissionId) {
        debugLog('[OHI] permission.ask: missing permissionId, skip interactive reply');
        output.status = 'ask';
        return;
      }

      const chosen = await waitForPermissionReply(permissionId);
      if (!chosen) {
        debugLog('[OHI] permission.ask: timeout waiting for reply, letting OpenCode handle');
        output.status = 'ask';
        return;
      }

      debugLog(`[OHI] permission.ask: got reply=${chosen} for id=${permissionId}`);
      applyPermissionStatus(output, chosen);
      debugLog(`[OHI] permission.ask: output.status set to ${output.status}`);
    },
  };
};
