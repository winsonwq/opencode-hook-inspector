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
  console.log(...args);
}

interface IPCMessage {
  type: string;
  [key: string]: any;
}

// Plugin state
let socket: net.Socket | null = null;
let buffer = '';
let pendingContext: string[] = [];

// Connection ready promise
let connectionReady: Promise<net.Socket | null> | null = null;

// Pending permission replies: permissionId -> { sessionId, chosen }
// TODO: Fix this - the permission option selection is not working correctly
// The issue is that canReply is undefined when CLI receives the message
let pendingPermissionReplies: Map<string, { sessionId: string; chosen: string }> = new Map();

// Handle incoming permission replies
function handlePermissionReply(msg: IPCMessage) {
  const { permissionId, reply } = msg;
  debugLog(`[OHI] Received permission_reply: permissionId=${permissionId}, reply=${reply}`);
  
  pendingPermissionReplies.set(permissionId, {
    sessionId: msg.sessionId,
    chosen: reply
  });
}

// Named export
export const HookInspector = async (_ctx: any) => {

  // Connect to Unix socket
  function connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        socket = sock;
        socket.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg: IPCMessage = JSON.parse(line);
              // Handle inject_context from inspector
              if (msg.type === 'inject_context' && msg.text) {
                pendingContext.push(msg.text);
              }
              // Handle permission reply from inspector
              // TODO: Enable when the permission option issue is fixed
              // if (msg.type === 'permission_reply' && msg.permissionId && msg.reply) {
              //   handlePermissionReply(msg);
              // }
            } catch {
              // Ignore
            }
          }
        });
        socket.on('error', () => {
          socket = null;
        });
        socket.on('close', () => {
          socket = null;
        });
        resolve(sock);
      });
      sock.on('error', () => {
        socket = null;
        reject(new Error('Connection failed'));
      });
    });
  }

  // Start connection (non-blocking but track readiness)
  connectionReady = connect().catch(() => null);

  // Helper to send message to socket (waits for connection)
  async function sendMessage(msg: IPCMessage) {
    debugLog(`[OHI] sendMessage called, socket=${socket ? 'exists' : 'null'}, destroyed=${socket?.destroyed}`);
    await connectionReady;
    debugLog(`[OHI] after connectionReady, socket=${socket ? 'exists' : 'null'}`);
    if (socket && !socket.destroyed) {
      const json = JSON.stringify(msg);
      socket.write(json + '\n');
    } else {
      debugLog(`[OHI] sendMessage: socket not available, message not sent`);
    }
  }
  return {
    // Generic event handler - catches all events
    event: async ({ event }: { event: any }) => {
      const hookName = event?.type || 'unknown';

      sendMessage({
        type: 'hook_event',
        hook: hookName,
        input: event,
        timestamp: new Date().toISOString(),
      });
    },

    // Shell env hook - can modify environment variables
    "shell.env": async (input: any, output: any) => {
      sendMessage({
        type: 'hook_event',
        hook: 'shell.env',
        input,
        output: output.env,
        timestamp: new Date().toISOString(),
      });
    },

    // Tool execute before - can modify tool arguments or block execution
    "tool.execute.before": async (input: any, output: any) => {
      const { tool, args } = input;
      debugLog(`[OHI] tool.execute.before: tool=${tool}`);
      
      sendMessage({
        type: 'hook_event',
        hook: 'tool.execute.before',
        input,
        output: output.args,
        timestamp: new Date().toISOString(),
      });
    },

    // Compaction hook - can inject context
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

      // Inject pending context into the session
      if (pendingContext.length > 0 && output.context) {
        for (const text of pendingContext) {
          output.context.push(`## Inspector Injection\n${text}`);
        }
        pendingContext = [];
      }
    },

    // Permission asked hook - logs permission events
    // TODO: Enable user interaction when the canReply issue is fixed
    // The problem is that canReply is undefined when CLI receives the message
    // Possible causes:
    // 1. OpenCode may not be calling both 'event' and 'permission.asked' hooks
    // 2. The message format may not include canReply field correctly
    // 3. Socket communication timing issue
    "permission.asked": async (input: any, output: any) => {
      const props = input?.properties || input;
      const permissionId = props?.id;
      const permissionType = props?.permission;
      const patterns = props?.patterns;
      const metadata = props?.metadata || {};
      const filepath = metadata?.filepath || (Array.isArray(patterns) ? patterns[0] : patterns);
      const sessionId = props?.sessionID;
      debugLog(`[OHI] permission.asked hook called (id=${permissionId}, type=${permissionType}, filepath=${filepath})`);
      
      sendMessage({
        type: "hook_event",
        hook: "permission.asked",
        input,
        canReply: true, // TODO: This is not being received correctly by CLI
        permission: permissionType,
        permissionId,
        sessionId,
        timestamp: new Date().toISOString()
      });
      
      // TODO: Enable when canReply issue is fixed
      // Currently letting OpenCode handle permissions normally
      // while (Date.now() - startTime < timeoutMs) {
      //   const reply = pendingPermissionReplies.get(permissionId);
      //   if (reply) {
      //     pendingPermissionReplies.delete(permissionId);
      //     debugLog(`[OHI] permission.asked: got reply=${reply.chosen} for id=${permissionId}`);
      //     switch (reply.chosen) {
      //       case "1":
      //       case "once":
      //         output.status = "allow";
      //         break;
      //       case "2":
      //       case "always":
      //         output.status = "allow";
      //         break;
      //       case "3":
      //       case "reject":
      //         output.status = "deny";
      //         break;
      //       case "4":
      //       case "ask":
      //         output.status = "ask";
      //         break;
      //       default:
      //         break;
      //     }
      //     debugLog(`[OHI] permission.asked: output.status set to ${output.status}`);
      //     break;
      //   }
      //   await new Promise((resolve) => setTimeout(resolve, 100));
      // }
      
      // Let OpenCode handle permissions normally for now
    },
  };
};
