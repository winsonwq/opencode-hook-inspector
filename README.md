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

> **注意**：OpenCode 大部分 hooks 只提供只读的 Input 信息，不支持反向修改。只有 `experimental.session.compacting` 支持通过修改 `output.context` 来注入上下文。

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
