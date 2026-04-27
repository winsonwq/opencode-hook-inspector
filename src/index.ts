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

// Named export
export const HookInspector = async (ctx: any) => {

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

  return {
    // Generic event handler - catches all events
    event: async ({ event }: { event: any }) => {
      const hookName = event?.type || 'unknown';
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
