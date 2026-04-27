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

## 配置文件

OHI 支持配置文件来预设 hooks 的输出修改。配置文件按以下顺序加载（后者覆盖前者）：

1. `~/.ohi/config.json` - 全局配置
2. `.ohi.json` - 本地配置（当前目录）
3. `.ohi/config.json` - 项目配置

### 示例配置

```json
{
  "version": "1.0",
  "hooks": {
    "chat.params": {
      "temperature": 0.7,
      "topP": 0.9
    },
    "experimental.session.compacting": {
      "context": [
        "You are a helpful coding assistant.",
        "Always write clean, well-documented code."
      ]
    },
    "experimental.chat.system.transform": {
      "system": [
        "You are a coding expert.",
        "When writing code, always include comments."
      ]
    }
  }
}
```

详见 [`.ohi.example.json`](.ohi.example.json)

## 功能说明

### 监控模式

运行后，所有 OpenCode hook 事件都会被捕获并实时显示：

```
[10:30:15] [HOOK] [session.idle] CALLED
  INPUT:
    { sessionId: "abc123", status: "idle" }
────────────────────────────────────────────────────────────
```

### Permission 交互控制

当 `permission.asked` 事件触发时（通过 `event` hook），OHI 会显示交互提示：

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
```

### 上下文注入

当 `experimental.session.compacting` hook 触发时，可以注入额外的上下文：

```
[10:30:15] [HOOK] [experimental.session.compacting] CALLED
  Context items: 12

  💡 Context injection available

  Enter context to inject (empty to skip, "cancel" to abort):

  > remember to add error handling
  [Injecting] "remember to add error handling"
```

## Hook 参考

### 通用 Hooks（仅监控）

| Hook | 说明 |
|------|------|
| `event` | 通用事件捕获器，接收所有 SSE 事件 |
| `shell.env` | Shell 环境变量 |
| `tool.execute.before` | 工具执行前 |

### 可通过配置文件修改的 Hooks

| Hook | Output 可修改 | 说明 |
|------|--------------|------|
| `chat.message` | `message`, `parts` | 修改聊天消息 |
| `chat.params` | `temperature`, `topP`, `topK`, `maxOutputTokens`, `options` | LLM 参数 |
| `chat.headers` | `headers` | HTTP 请求头 |
| `command.execute.before` | `parts` | 命令执行 |
| `tool.execute.before` | `args` | 工具参数 |
| `tool.execute.after` | `title`, `output`, `metadata` | 工具执行结果 |
| `tool.definition` | `description`, `parameters` | 工具定义 |
| `experimental.session.compacting` | `context[]`, `prompt` | Session 压缩 |
| `experimental.chat.messages.transform` | `messages[]` | 消息历史 |
| `experimental.chat.system.transform` | `system[]` | System prompt |
| `experimental.compaction.autocontinue` | `enabled` | 自动继续 |
| `experimental.text.complete` | `text` | 文本补全 |

### Permission Hooks

| Hook | 类型 | 说明 |
|------|------|------|
| `permission.asked` | SSE 事件 | 权限请求事件（通过 `event` hook 接收） |
| `permission.ask` | Dedicated Hook | 权限拦截（可控制输出，但 OpenCode 暂未调用） |

### 技术细节

**关键发现**：`event` hook 接收的 SSE 事件只有观察性质，无法直接修改 `output`。

对于 `permission.asked`，OHI 通过 OpenCode Client API 实现控制：

```typescript
await opencodeClient.postSessionIdPermissionsPermissionId({
  path: { id: sessionId, permissionID: permissionId },
  body: { response: "once" }
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

## License

MIT
