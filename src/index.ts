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

function handlePermissionReply(msg: IPCMessage) {
  const { permissionId, reply, sessionId } = msg;
  debugLog(`[OHI] Received permission_reply: permissionId=${permissionId}, reply=${reply}, sessionId=${sessionId}`);
  
  pendingPermissionReplies.set(permissionId, {
    sessionId: msg.sessionId || sessionId,
    chosen: reply
  });
}

export const HookInspector = async (_ctx: any) => {

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
    // Generic event handler - catches all events EXCEPT permission.asked
    // (permission.asked has its own dedicated hook)
    event: async ({ event }: { event: any }) => {
      const hookName = event?.type || 'unknown';
      
      // Skip permission.asked - let the dedicated hook handle it
      if (hookName === 'permission.asked') {
        debugLog('[OHI] event hook: skipping permission.asked (dedicated hook will handle)');
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

    // Permission asked hook - intercept and allow user to reply via CLI
    "permission.asked": async (input: any, output: any) => {
      const props = input?.properties || input;
      const permissionId = props?.id;
      const permissionType = props?.permission;
      const patterns = props?.patterns || [];
      const metadata = props?.metadata || {};
      const sessionId = props?.sessionID;
      
      debugLog(`[OHI] permission.asked: id=${permissionId}, type=${permissionType}, sessionId=${sessionId}`);
      
      // Send message to CLI with canReply flag
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
        canReply: true,
        timestamp: new Date().toISOString(),
      });

      // Wait for reply from CLI (up to 60 seconds)
      const timeoutMs = 60000;
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeoutMs) {
        const reply = pendingPermissionReplies.get(permissionId);
        if (reply) {
          pendingPermissionReplies.delete(permissionId);
          debugLog(`[OHI] permission.asked: got reply=${reply.chosen} for id=${permissionId}`);
          
          switch (reply.chosen) {
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
          
          debugLog(`[OHI] permission.asked: output.status set to ${output.status}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      
      debugLog('[OHI] permission.asked: timeout waiting for reply, letting OpenCode handle');
      output.status = 'ask';
    },
  };
};
