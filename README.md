# OHI - Opencode Hook Inspector

实时监控和调试 OpenCode hooks 的交互式 CLI 工具。

## 安装

```bash
npm install -g opencode-hook-inspector
```

安装时会自动链接插件到 OpenCode。

## 快速开始

```bash
# 启动调试器
ohi

# 新开终端启动 OpenCode
opencode
```

## 功能说明

### 监控模式

运行后，所有 OpenCode hook 事件都会被捕获并实时显示：

```
[10:30:15] [HOOK] [session.idle] CALLED
  INPUT:
    { sessionId: "abc123", status: "idle" }
────────────────────────────────────────────────────────────
```

### 交互式 Hooks

OHI 支持部分 hooks 的交互式控制。当触发这些 hooks 时，会暂停事件流，显示交互提示，用户输入后继续：

#### Permission 交互控制

```
[15:21:00] [HOOK] [permission.asked] CALLED
  🔐 Permission Request - external_directory

  Patterns:
    - /Users/aqiu/Downloads/*

  Choose a reply:

    [1] Once    - Allow this time only
    [2] Always  - Always allow for this permission
    [3] Reject  - Deny this request
    [4] Ask     - Let OpenCode ask normally (default)

  > 1
  [Replying: ONCE]

  ── Queued 5 hook(s) during prompt ──

[15:21:00] [HOOK] [message.part.updated] CALLED
...
```

**特性**：交互期间的事件会被排队，交互完成后统一显示，不会丢失。

#### 上下文注入

```
[10:30:15] [HOOK] [experimental.session.compacting] CALLED
  Context items: 12

  💡 Context injection available

  Enter context to inject (empty to skip, "cancel" to abort):

  > remember to add error handling
  [Injecting] "remember to add error handling"
```

## Hook 参考

### Hooks 分类

| 分类 | 说明 |
|------|------|
| **通用 Hooks** | 仅监控，不支持修改 |
| **可注入 Hooks** | 支持通过 `output` 参数修改行为 |
| **交互式 Hooks** | 支持 CLI 用户输入，可控制输出 |
| **SSE 事件** | 通过 `event` hook 接收，只有观察性质 |

### 通用 Hooks（仅监控）

| Hook | 说明 |
|------|------|
| `event` | 通用事件捕获器，接收所有 SSE 事件 |
| `shell.env` | Shell 环境变量 |
| `tool.execute.before` | 工具执行前 |

### 可注入上下文的 Hooks

| Hook | Output 可修改 | 说明 |
|------|--------------|------|
| `experimental.session.compacting` | `context[]`, `prompt` | Session 压缩，可添加上下文 |
| `experimental.chat.system.transform` | `system[]` | 修改 system prompt |
| `experimental.chat.messages.transform` | `messages[]` | 修改消息历史 |
| `experimental.text.complete` | `text` | 文本补全完成 |
| `experimental.compaction.autocontinue` | `enabled` | 控制自动继续 |

### 可修改参数的 Hooks

| Hook | Output 可修改 | 说明 |
|------|--------------|------|
| `chat.params` | `temperature`, `topP`, `topK`, `maxOutputTokens`, `options` | LLM 参数 |
| `chat.headers` | `headers` | HTTP 请求头 |
| `chat.message` | `message`, `parts` | 聊天消息 |
| `command.execute.before` | `parts` | 命令执行 |
| `tool.execute.before` | `args` | 工具参数 |
| `tool.execute.after` | `title`, `output`, `metadata` | 工具执行结果 |
| `tool.definition` | `description`, `parameters` | 工具定义 |

### Permission Hooks

| Hook | 类型 | 说明 |
|------|------|------|
| `permission.asked` | SSE 事件 | 权限请求事件（通过 `event` hook 接收） |
| `permission.ask` | Dedicated Hook | 权限拦截（可控制输出，但 OpenCode 暂未调用） |

### 技术实现细节

**关键发现**：`event` hook 接收的 SSE 事件（如 `permission.asked`）只有观察性质，无法直接修改 `output`。

OHI 通过 OpenCode Client API 实现控制：

```typescript
// Permission 控制示例
await opencodeClient.postSessionIdPermissionsPermissionId({
  path: { id: sessionId, permissionID: permissionId },
  body: { response: "once" }  // "once" | "always" | "reject"
});
```

## 命令

| 命令 | 描述 |
|------|------|
| `ohi` | 启动调试器 |
| `ohi unlink` | 移除插件 |
| `ohi --help` | 显示帮助 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OHI_SOCKET` | `/tmp/ohi.sock` | Unix Socket 路径 |
| `OHI_AUTO_REPLY` | - | 启用自动回复测试模式 |
| `OHI_AUTO_REPLY_OPTION` | `once` | 自动回复选项 |

## License

MIT
