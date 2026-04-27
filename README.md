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

### 上下文注入

当 `experimental.session.compacting` hook 触发时（OpenCode 进行上下文压缩时），可以注入额外的上下文：

```
[10:30:15] [HOOK] [experimental.session.compacting] CALLED
  Context items: 12

  💡 Context injection available

  Enter context to inject (empty to skip, "cancel" to abort):

  > remember to add error handling
  [Injecting] "remember to add error handling"
```

注入的上下文会被添加到 OpenCode 的 context 数组中，影响后续的对话。

### Permission 交互控制

当 `permission.asked` 事件触发时，可以控制权限请求的响应：

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
```

#### 技术实现细节

**关键发现**：`event` hook 接收的 `permission.asked` 事件只有观察性质，无法直接修改 `output.status`。

OHI 通过以下方式实现控制：
1. 捕获 `permission.asked` 事件并通过 Unix Socket 转发给 CLI
2. 用户选择后，CLI 发送 `permission_reply` 消息
3. Plugin 收到后，调用 OpenCode Client API (`POST /session/{id}/permissions/{permissionID}`) 发送回复

```typescript
// API 调用方式
await opencodeClient.postSessionIdPermissionsPermissionId({
  path: { id: sessionId, permissionID: permissionId },
  body: { response: reply }  // "once" | "always" | "reject"
});
```

## Hook 参考

### 支持注入上下文的 Hooks

| Hook | 说明 | 触发时机 |
|------|------|----------|
| `experimental.session.compacting` | Session 压缩 | 上下文即将压缩时（官方 API） |

### 通用 Hooks（仅监控）

| Hook | 说明 |
|------|------|
| `event` | 通用事件捕获器 |
| `shell.env` | Shell 环境变量 |
| `tool.execute.before` | 工具执行前 |

### Permission Hooks

| Hook | 类型 | 说明 |
|------|------|------|
| `permission.asked` | SSE 事件 (via `event` hook) | 权限请求事件（仅观察） |
| `permission.ask` | Dedicated Hook | 权限拦截 hook（OpenCode 暂未调用） |

> **注意**：`event` hook 只能观察事件，无法修改 `output`。通过 CLI + OpenCode Client API 方式实现交互控制。

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
