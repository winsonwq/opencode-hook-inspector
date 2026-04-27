# OpenCode Hook Inspector 使用指南

## 完整工作流程

### 准备工作：启动 OHI

**终端 1 - 启动 OHI CLI：**

```bash
# 进入项目目录
cd ~/opencode-hook-inspector

# 安装最新版本（如果需要）
npm install -g opencode-hook-inspector

# 启动 OHI
ohi
```

### 步骤 1：启动 OpenCode

**终端 2 - 启动 OpenCode：**

```bash
opencode
```

**OHI 日志输出：**
```
[14:00:00.000] [HOOK] [session.created] CALLED
  INPUT:
    {
      "sessionId": "ses_abc123",
      ...
    }
────────────────────────────────────────────────────────────
```

### 步骤 2：执行需要权限的操作

在 OpenCode 中输入提示词，例如：
```
请读取 /tmp/test.txt 文件
```

如果需要权限，OHI 会显示：

```
[14:00:05.123] [HOOK] [permission.asked] CALLED
  INPUT:
    {
      "permissionId": "per_xyz789",
      "sessionId": "ses_abc123",
      "permission": "file.read",
      "patterns": [
        "/tmp/test.txt"
      ]
    }
────────────────────────────────────────────────────────────

  🔐 Permission Request - file.read

  Patterns:
    - /tmp/test.txt

  Choose a reply:

    [1] Once    - Allow this time only
    [2] Always  - Always allow for this permission
    [3] Reject  - Deny this request
    [4] Ask     - Let OpenCode ask normally (default)

  > _
```

### 步骤 3：输入选择

在终端 1 的 OHI 界面输入选项编号：

```
  > 1
```

**如果选择 [1] Once：**
```
  [Replying: ONCE]
```

**如果选择 [2] Always：**
```
  [Replying: ALWAYS]
```

**如果选择 [3] Reject：**
```
  [Replying: REJECT]
```

**如果选择 [4] Ask：**
```
  [Letting OpenCode ask normally]
```

### 步骤 4：查看操作结果

OpenCode 会根据你的选择执行或拒绝操作：

```
[14:00:06.456] [HOOK] [tool.execute.before] CALLED
  INPUT:
    {
      "tool": "Read",
      "args": {
        "path": "/tmp/test.txt"
      }
    }
────────────────────────────────────────────────────────────
```

### 步骤 5：退出 OpenCode

在 OpenCode 终端输入：
```
/exit
```

**OHI 日志输出：**
```
  [Plugin disconnected]
```

---

## 日志文件输出

如果你想保存完整的日志，可以在启动 OHI 时重定向输出：

```bash
ohi 2>&1 | tee ohi-session-$(date +%Y%m%d-%H%M%S).log
```

或者使用自动回复模式进行测试：

```bash
# 自动回复 "once"
OHI_AUTO_REPLY=1 OHI_AUTO_REPLY_OPTION=once ohi 2>&1 | tee ohi-test.log

# 自动回复 "reject"
OHI_AUTO_REPLY=1 OHI_AUTO_REPLY_OPTION=reject ohi 2>&1 | tee ohi-test.log
```

---

## 回归测试

```bash
cd ~/opencode-hook-inspector

# 测试所有回复选项
node scripts/test-permission-reply.cjs once
node scripts/test-permission-reply.cjs always
node scripts/test-permission-reply.cjs reject
node scripts/test-permission-reply.cjs ask
```

---

## 故障排除

### OHI 没有收到事件
- 检查 OHI 是否正常运行（Socket 路径：`/tmp/ohi.sock`）
- 检查 OpenCode 是否正确加载了插件

### 权限菜单没有显示
- 确保 OpenCode 触发了 `permission.asked` hook
- 检查 OHI 日志中是否有 `canReply: true`

### 自动回复不工作
- 确保设置了环境变量：`OHI_AUTO_REPLY=1`
- 确保选择了有效的选项：`once`, `always`, `reject`, `ask`
