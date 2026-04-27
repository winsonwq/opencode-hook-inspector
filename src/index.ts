// Hook Inspector Plugin for OpenCode
// Monitors all OpenCode hooks and supports context injection

import net from 'net';

const SOCKET_PATH = process.env.OHI_SOCKET || '/tmp/ohi.sock';

interface IPCMessage {
  type: string;
  [key: string]: any;
}

// Plugin state
let socket: net.Socket | null = null;
let buffer = '';
let pendingContext: string[] = [];

// Pending permission replies: permissionId -> { sessionId, chosen }
let pendingPermissionReplies: Map<string, { sessionId: string; chosen: string }> = new Map();

// Named export
export const HookInspector = async (ctx: any) => {
  const { client } = ctx;

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
              if (msg.type === 'permission_reply' && msg.permissionId && msg.reply) {
                pendingPermissionReplies.set(msg.permissionId, {
                  sessionId: msg.sessionId,
                  chosen: msg.reply
                });
              }
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

  // Try to connect (non-blocking)
  connect().catch(() => {
    // Socket not available, that's ok
  });

  // Helper to send message to socket
  function sendMessage(msg: IPCMessage) {
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n');
    }
  }

  // Helper to reply to permission via client API
  async function replyPermission(sessionId: string, permissionId: string, reply: 'once' | 'always' | 'reject') {
    try {
      await client.postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response: reply }
      });
    } catch (err) {
      console.error('Failed to reply permission:', err);
    }
  }

  return {
    // Permission ask hook - intercept permission requests
    "permission.ask": async (input: any, output: any) => {
      const permissionId = input.id;
      const sessionId = input.sessionID;
      const permission = input.permission;
      const patterns = input.patterns || [];
      const always = input.always || [];

      // Send permission event to CLI for user interaction
      sendMessage({
        type: 'hook_event',
        hook: 'permission.ask',
        input: {
          id: permissionId,
          sessionID: sessionId,
          permission,
          patterns,
          always,
        },
        canReply: true,
        timestamp: new Date().toISOString(),
      });

      // Check if user already replied via CLI
      const pending = pendingPermissionReplies.get(permissionId);
      if (pending) {
        pendingPermissionReplies.delete(permissionId);
        
        // Call client API to reply
        const reply = pending.chosen as 'once' | 'always' | 'reject';
        await replyPermission(sessionId, permissionId, reply);
        
        // Set output status based on reply
        if (reply === 'reject') {
          output.status = 'deny';
        } else {
          output.status = 'allow';
        }
        return;
      }

      // No reply yet - set status to 'ask' (default behavior, will show UI)
      output.status = 'ask';
    },

    // Generic event handler - catches all events
    event: async ({ event }: { event: any }) => {
      const hookName = event?.type || 'unknown';
      
      // Skip permission.ask here since we handle it in the dedicated hook
      if (hookName === 'permission.ask') return;
      
      sendMessage({
        type: 'hook_event',
        hook: hookName,
        input: event?.properties || {},
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

    // Tool execute before - can modify tool arguments
    "tool.execute.before": async (input: any, output: any) => {
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
  };
};
