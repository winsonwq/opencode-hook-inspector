// Hook output types extracted from OpenCode SDK

export interface ChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  options?: Record<string, any>;
}

export interface ChatHeadersOutput {
  headers?: Record<string, string>;
}

export interface ChatMessageOutput {
  message?: any;
  parts?: any[];
}

export interface CommandExecuteBeforeOutput {
  parts?: any[];
}

export interface ToolExecuteBeforeOutput {
  args?: any;
}

export interface ToolExecuteAfterOutput {
  title?: string;
  output?: string;
  metadata?: any;
}

export interface ToolDefinitionOutput {
  description?: string;
  parameters?: any;
}

export interface ExperimentalSessionCompactingOutput {
  context?: string[];
  prompt?: string;
}

export interface ExperimentalChatMessagesTransformOutput {
  messages?: Array<{ info: any; parts: any[] }>;
}

export interface ExperimentalChatSystemTransformOutput {
  system?: string[];
}

export interface ExperimentalCompactionAutocontinueOutput {
  enabled?: boolean;
}

export interface ExperimentalTextCompleteOutput {
  text?: string;
}

export interface PermissionAskOutput {
  status?: "ask" | "deny" | "allow";
}

// Config type - maps hook name to output partial type
export interface OHIConfig {
  version?: string;
  hooks?: {
    "chat.message"?: Partial<ChatMessageOutput>;
    "chat.params"?: Partial<ChatParamsOutput>;
    "chat.headers"?: Partial<ChatHeadersOutput>;
    "command.execute.before"?: Partial<CommandExecuteBeforeOutput>;
    "tool.execute.before"?: Partial<ToolExecuteBeforeOutput>;
    "tool.execute.after"?: Partial<ToolExecuteAfterOutput>;
    "tool.definition"?: Partial<ToolDefinitionOutput>;
    "experimental.session.compacting"?: Partial<ExperimentalSessionCompactingOutput>;
    "experimental.chat.messages.transform"?: Partial<ExperimentalChatMessagesTransformOutput>;
    "experimental.chat.system.transform"?: Partial<ExperimentalChatSystemTransformOutput>;
    "experimental.compaction.autocontinue"?: Partial<ExperimentalCompactionAutocontinueOutput>;
    "experimental.text.complete"?: Partial<ExperimentalTextCompleteOutput>;
    "permission.ask"?: Partial<PermissionAskOutput>;
  };
  // Environment variable interpolation
  env?: Record<string, string>;
}
