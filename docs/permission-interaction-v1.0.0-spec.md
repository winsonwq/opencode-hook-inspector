# SPEC: OpenCode Hook Inspector - Permission Interaction

**版本**: v1.0.0
**日期**: 2026-04-27
**状态**: 待实现
**项目路径**: `/Users/aqiu/projects/opencode-hook-inspector`

---

## 背景

OpenCode Hook Inspector (OHI) 是一个用于监控和调试 OpenCode hooks 的工具。目前 OHI 能够显示各种 hook 事件（如 `permission.asked`），但当需要用户交互控制权限响应时，CLI 无法显示选项菜单让用户选择。

**问题描述**：
- `permission.asked` hook 被正确触发
- 插件发送的消息包含 `canReply: true`
- 但 CLI 收到的消息中 `canReply` 是 `undefined`，导致选项菜单无法显示

---

## 目标

实现 CLI 与插件之间的双向通信，使 CLI 能够在 `permission.asked` 事件时显示选项菜单，并将用户选择发送回插件，插件据此设置权限状态。

**量化指标**：
- CLI 收到 `permission.asked` 消息后，3 秒内显示选项菜单
- 用户选择后，插件在 1 秒内收到回复
- 支持 4 种回复选项：Once / Always / Reject / Ask

---

## 范围

### 包含
- `permission.asked` hook 的交互功能
- Unix Socket 双向通信机制
- CLI 选项菜单 UI
- 插件回复处理逻辑

### 不包含
- `permission.ask` hook（OpenCode 不调用此 hook）
- 其他权限类型的处理
- 持久化权限规则

---

## 方案

### 架构

```
┌─────────────────┐     Unix Socket      ┌─────────────────┐
│   Inspector     │◄───────────────────►│   OpenCode      │
│   (CLI)         │   /tmp/ohi.sock     │   Plugin        │
│                 │                      │                 │
│  - 显示选项     │                      │  - 发送事件     │
│  - 发送回复     │                      │  - 接收回复     │
└─────────────────┘                      └─────────────────┘
```

### 消息格式

#### 1. 插件 → CLI：`hook_event` 消息
```typescript
interface HookEventMessage {
  type: 'hook_event';
  hook: 'permission.asked';
  input: {
    type: 'permission.asked';
    properties: {
      id: string;           // permission ID, e.g. "per_xxx"
      sessionID: string;    // session ID
      permission: string;   // e.g. "external_directory"
      patterns: string[];   // e.g. ["/Users/aqiu/Downloads/*"]
      metadata: {
        filepath?: string;
        parentDir?: string;
      };
    };
  };
  canReply: true;           // 关键字段！必须为 true
  permissionId: string;
  permission: string;
  sessionId: string;
  timestamp: string;
}
```

#### 2. CLI → 插件：`permission_reply` 消息
```typescript
interface PermissionReplyMessage {
  type: 'permission_reply';
  permissionId: string;
  sessionId: string;
  reply: 'once' | 'always' | 'reject' | 'ask';
}
```

### CLI 选项菜单

```
╔═══════════════════════════════════════════════════╗
║       🔐 Permission Request                        ║
╚═══════════════════════════════════════════════════╝

  Permission Type: external_directory

  Patterns:
    - /Users/aqiu/Downloads/*

  Choose a reply:
    [1] Once    - Allow this time only
    [2] Always  - Always allow for this permission
    [3] Reject  - Deny this request
    [4] Ask     - Let OpenCode ask normally (default)

  > _
```

### 插件回复处理

根据 CLI 发送的 `reply` 值设置 `output.status`：

| reply    | output.status |
|----------|--------------|
| "once"   | "allow"      |
| "always" | "allow"      |
| "reject" | "deny"       |
| "ask"    | "ask"        |

### 超时处理

- CLI 等待用户输入：60 秒超时
- 超时后默认发送 `reply: 'ask'`（让 OpenCode 处理）
- 插件等待 CLI 回复：60 秒超时
- 超时后不做任何操作（让 OpenCode 默认处理）

---

## 任务拆解

- [ ] **T1**: 验证消息格式 - 确认插件发送的消息包含 `canReply: true`
- [ ] **T2**: CLI 解析 `canReply` - 检查 CLI 是否正确读取该字段
- [ ] **T3**: 实现选项菜单 UI - 在 CLI 中显示权限选项
- [ ] **T4**: 实现回复发送 - CLI 发送 `permission_reply` 到插件
- [ ] **T5**: 实现回复接收 - 插件接收并处理 `permission_reply`
- [ ] **T6**: 集成测试 - 端到端测试完整流程

---

## 测试验证

### 手动测试步骤

1. 启动 CLI: `./bin/cli.js`
2. 在 OpenCode 中执行写入外部目录的操作（如写入 `/tmp/ohi.sock` 以外的目录）
3. 验证 CLI 显示权限选项菜单
4. 输入选项编号（1-4）
5. 验证插件收到回复并正确处理

### 预期结果

- 选项菜单正确显示权限类型和路径
- 用户输入后，插件收到正确的回复
- OpenCode 根据回复执行相应操作

---

## 成功标准

1. **消息可达性**：CLI 能收到包含 `canReply: true` 的 `permission.asked` 消息
2. **选项显示**：收到消息后 3 秒内显示选项菜单
3. **回复传递**：用户选择后，插件在 1 秒内收到 `permission_reply` 消息
4. **状态控制**：插件正确设置 `output.status`
5. **超时容错**：60 秒无响应时自动降级为 "ask"

---

## 待调查问题

### 问题：canReply 为 undefined

**现象**：CLI 收到的消息中 `canReply` 是 `undefined`

**可能原因**：
1. OpenCode 只调用 `permission.asked` hook，不调用通用的 `event` hook
2. 插件发送消息时 `canReply` 被意外覆盖
3. Socket 传输过程中消息被截断或修改
4. JSON 解析问题

**调查步骤**：
1. 检查 `/tmp/ohi-debug.log` 中插件发送的完整消息
2. 检查 CLI 收到的原始 JSON 数据
3. 验证两者的 `canReply` 字段是否一致

---

## Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-04-27 | 初始版本 |
