# Opencode Hook Inspector

监控和调试 OpenCode hooks 的开发工具。

## 安装

```bash
npm install -g opencode-hook-inspector
```

安装时会自动链接插件到 OpenCode。

## 运行

```bash
# 启动 Inspector
ohi

# 启动 OpenCode
opencode
```

## 注入上下文

当 `experimental.session.compacting` hook 触发时，Inspector 会提示输入上下文：

```
  [HOOK] [experimental.session.compacting] CALLED
  💡 Context injection available

  Enter context to inject (empty to skip, "cancel" to abort):

  > remember to add error handling
```

## 设计

### 组件

- **Plugin** (`src/index.ts`) - OpenCode 插件，捕获所有 hooks
- **CLI** (`src/cli.ts`) - 统一 CLI，包含交互式 REPL

### 通信协议

通过 Unix Domain Socket (`/tmp/ohi.sock`) 通信，JSON 格式消息：

| Type | Direction | 说明 |
|------|-----------|------|
| `hook_event` | Plugin → CLI | Hook 触发事件 |
| `inject_context` | CLI → Plugin | 注入上下文 |

### 支持的 Hooks

| Hook | 说明 | 可注入 |
|------|------|--------|
| `event` | 通用事件捕获 | - |
| `shell.env` | Shell 环境变量 | 修改 output.env |
| `tool.execute.before` | 工具执行前 | 修改 output.args |
| `experimental.session.compacting` | Session 压缩 | 修改 output.context |
