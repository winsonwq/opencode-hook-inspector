# SPEC: OpenCode Hook Inspector - Permission Interaction

**版本**: v1.0.1
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
- 支持 3 种回复选项：Once / Always / Reject ✅
- 通过 OpenCode Client API 控制权限响应 ✅

---

## 关键发现：permission.asked vs permission.ask

### 两种 Hook 的区别

| Hook 名称 | 类型 | 用途 | 能否控制输出 |
|-----------|------|------|-------------|
| `permission.asked` | SSE 事件（通过 `event` hook 接收） | OpenCode SSE 流推送的事件 | ❌ 不能（无 output 参数） |
| `permission.ask` | Dedicated Hook | 官方定义的权限拦截 hook | ✅ 能（可设置 `output.status`） |

**重要发现**：OpenCode 目前**只通过 `event` hook 发送 `permission.asked` SSE 事件**，**不调用** `permission.ask` dedicated hook。

这意味着：
1. Plugin 无法通过 hook 的 `output.status` 来控制权限
2. 需要通过 OpenCode Client API (`POST /session/{id}/permissions/{permissionID}`) 来控制

### OpenCode SDK 类型定义

```typescript
// @opencode-ai/plugin/dist/index.d.ts
export interface Hooks {
  // event hook - 只能观察，无法控制
  event?: (input: { event: Event }) => Promise<void>;

  // permission.ask - 理论上可以控制，但 OpenCode 暂未调用
  "permission.ask"?: (input: Permission, output: {
    status: "ask" | "deny" | "allow";
  }) => Promise<void>;
}

// @opencode-ai/sdk/dist/gen/types.gen.d.ts
export type EventPermissionAsked = {
  type: "permission.asked";
  properties: PermissionRequest;  // 包含 id, sessionID, permission, patterns 等
};
```

---

## 实现方案

由于 `event` hook 无法控制输出，采用以下方案：

1. 捕获 `event` hook 中的 `permission.asked` 事件
2. 通过 Unix Socket 转发到 CLI 显示选项
3. 用户选择后，CLI 发送 `permission_reply` 消息
4. Plugin 收到后，调用 OpenCode Client API 发送回复

### API 调用

```typescript
// 使用 OpenCode Client API 控制权限
await opencodeClient.postSessionIdPermissionsPermissionId({
  path: { id: sessionId, permissionID: permissionId },
  body: { response: "once" }  // "once" | "always" | "reject"
});
```

---

## 架构

```
┌─────────────────┐     Unix Socket      ┌─────────────────┐     Client API      ┌─────────────────┐
│   Inspector     │◄───────────────────►│   OpenCode      │───────────────────►│   OpenCode      │
│   (CLI)         │   /tmp/ohi.sock     │   Plugin        │   POST /session/... │   Server        │
│                 │                      │                 │                      │                 │
│  - 显示选项     │                      │  - 发送事件     │                      │                 │
│  - 发送回复     │                      │  - 调用 API     │                      │                 │
└─────────────────┘                      └─────────────────┘                      └─────────────────┘
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
  reply: 'once' | 'always' | 'reject';
}
```

### 3. 插件 → OpenCode Server：API 调用

```typescript
POST /session/{id}/permissions/{permissionID}
Body: { response: "once" | "always" | "reject" }
```

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
| v1.0.1 | 2026-04-27 | 发现 `permission.ask` hook 未被调用，改用 Client API 方案；记录 `ask` vs `asked` 区别 |
