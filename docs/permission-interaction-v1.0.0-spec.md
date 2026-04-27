# SPEC: OpenCode Hook Inspector - Permission Interaction

**版本**: v1.0.0
**日期**: 2026-04-27
**状态**: ✅ 已实现
**项目路径**: `~/opencode-hook-inspector`

---

## 背景

OpenCode Hook Inspector (OHI) 是一个用于监控和调试 OpenCode hooks 的工具。OHI 能够显示各种 hook 事件（如 `permission.asked`），并支持用户通过 CLI 交互控制权限响应。

---

## 目标

实现 CLI 与插件之间的双向通信，使 CLI 能够在 `permission.asked` 事件时显示选项菜单，并将用户选择发送回插件，插件据此设置权限状态。

**量化指标**：
- CLI 收到 `permission.asked` 消息后，3 秒内显示选项菜单 ✅
- 用户选择后，插件在 1 秒内收到回复 ✅
- 支持 4 种回复选项：Once / Always / Reject / Ask ✅

---

## 架构

```
┌─────────────────┐     Unix Socket      ┌─────────────────┐
│   Inspector     │◄───────────────────►│   OpenCode      │
│   (CLI)         │   /tmp/ohi.sock     │   Plugin        │
│                 │                      │                 │
│  - 显示选项     │                      │  - 发送事件     │
│  - 发送回复     │                      │  - 接收回复     │
└─────────────────┘                      └─────────────────┘
```

---

## 消息格式

### 1. 插件 → CLI：`hook_event` 消息
```typescript
interface HookEventMessage {
  type: 'hook_event';
  hook: 'permission.asked';
  input: {
    permissionId: string;
    sessionId: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
  };
  canReply: true;
  timestamp: string;
}
```

### 2. CLI → 插件：`permission_reply` 消息
```typescript
interface PermissionReplyMessage {
  type: 'permission_reply';
  permissionId: string;
  sessionId: string;
  reply: 'once' | 'always' | 'reject' | 'ask';
}
```

### 3. 插件回复处理

| reply    | output.status |
|----------|--------------|
| "once"   | "allow"      |
| "always" | "allow"      |
| "reject" | "deny"       |
| "ask"    | "ask"        |

---

## 测试验证

### 回归测试（自动化）

```bash
# 测试 Allow once
node scripts/test-permission-reply.cjs once

# 测试 Always allow
node scripts/test-permission-reply.cjs always

# 测试 Reject
node scripts/test-permission-reply.cjs reject

# 测试 Ask
node scripts/test-permission-reply.cjs ask
```

**预期结果：**
```
✓ PASS: Plugin received permission_reply from CLI
✓ PASS: Reply option matches: <option> === <option>
✓ PASS: Permission ID preserved: <id>
```

### 手动测试

1. 终端 1: `ohi`（启动 CLI）
2. 终端 2: `opencode`（启动 OpenCode）
3. 在 OpenCode 中触发权限请求
4. CLI 显示选项菜单，输入 1-4 选择
5. 验证 OpenCode 根据选择执行相应操作

---

## Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-04-27 | 初始版本，实现 permission 交互功能 |
