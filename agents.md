# Opencode Hook Inspector

OpenCode 插件，用于监控和调试所有 OpenCode hooks，并支持上下文注入。

## 架构

```
┌─────────────────┐     Unix Socket      ┌─────────────────┐
│   Inspector     │◄───────────────────►│   OpenCode      │
│   (CLI)         │   /tmp/ohi.sock     │   Plugin        │
│                 │                      │                 │
│  - 显示 hook    │                      │  - 发送 hook    │
│  - 交互式输入   │                      │  - 接收注入     │
└─────────────────┘                      └─────────────────┘
```

## 组件

| 组件 | 路径 | 说明 |
|------|------|------|
| 插件 | `src/index.ts` | OpenCode 插件，捕获 hooks 并发送到 socket |
| CLI | `src/cli.ts` | 统一 CLI，包含交互式 REPL |

## 全局命令

| 命令 | 说明 |
|------|------|
| `ohi` | 启动 Inspector |
| `ohi inject "text"` | 注入上下文 |
| `ohi unlink` | 移除插件 |

## Hooks 支持

| Hook | Input | Output | 说明 |
|------|-------|--------|------|
| `event` | `{ event: Event }` | - | 通用事件捕获器 |
| `shell.env` | `{ env: Env }` | `{ env: Env }` | 环境变量 |
| `tool.execute.before` | `{ tool, args }` | `{ args }` | 工具执行前 |
| `experimental.session.compacting` | `{ sessionId }` | `{ context }` | Session 压缩，可注入上下文 |

## 发布到 NPM

```bash
npm publish
```

构建自动执行（prepublishOnly）。

安装后自动链接插件（postinstall）。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OHI_SOCKET` | `/tmp/ohi.sock` | Unix Socket 路径 |
