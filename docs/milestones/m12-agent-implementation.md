# 生产级 Agent 实现路线

> 6 个阶段,22 个任务,每个任务标注涉及的文件、函数签名、依赖关系和验证方式。
> 按依赖顺序排列——前面的任务是后面的前置条件。

---

## Phase 1: 流式 + 工具融合 (P0)

解决"工具调用时无法流式输出"的体验割裂问题。

### Task 1.1: OpenAIProvider 新增 streamWithTools 方法

**文件**: `apps/agent/src/providers/openai.ts`

**改动**: 在 `OpenAIProvider` 类中新增方法

```typescript
/**
 * 两阶段流式:先用非流式 invoke 判断是否需要工具,
 * 需要工具则执行后流式输出最终回复,不需要则直接返回。
 */
async *streamWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<StreamChunk, void, unknown>
```

**StreamChunk 类型** (新增到 `providers/types.ts`):

```typescript
export type StreamChunk =
  | { type: "token"; content: string }
  | { type: "tool_start"; tool_names: string[] }
  | { type: "tool_end"; results: Record<string, string> }
  | { type: "done"; finish_reason: string };
```

**核心逻辑**:

1. `const result = await this.chatWithTools(messages, tools)` — 非流式,2-5s
2. 如果 `result.tool_calls` 存在:
   - `yield { type: "tool_start", tool_names: [...] }`
   - 执行工具(由调用方做,这里只 yield tool_calls 信息)
   - 实际上这个方法不应该执行工具——它只负责 LLM 交互
   - 改为:这个方法只做"判断是否需要工具 + 流式最终回复",工具执行由 react-loop 做
3. 如果不需要工具:`yield { type: "token", content: result.content }` 一次性返回

**重新设计**: `streamWithTools` 不执行工具,它是一个纯 LLM 交互方法:

```typescript
async *streamWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  // 阶段1: 非流式判断是否需要工具
  const result = await this.chatWithTools(messages, tools);

  if (result.tool_calls && result.tool_calls.length > 0) {
    // 需要工具 — 返回 tool_calls,由调用方执行后再次调用
    yield { type: "tool_calls", tool_calls: result.tool_calls };
    return;
  }

  // 不需要工具 — 直接返回内容(不再重新流式,省一次调用)
  yield { type: "token", content: result.content };
  yield { type: "done", finish_reason: "stop" };
}

/**
 * 纯流式输出,用于工具执行完成后的最终回复生成。
 */
async *streamFinalReply(messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
  for await (const token of this.stream(messages)) {
    yield { type: "token", content: token };
  }
  yield { type: "done", finish_reason: "stop" };
}
```

**StreamChunk 更新**:

```typescript
export type StreamChunk =
  | { type: "token"; content: string }
  | { type: "tool_calls"; tool_calls: ToolCall[] }
  | { type: "done"; finish_reason: string };
```

**依赖**: 无
**验证**: `pnpm typecheck` 通过

---

### Task 1.2: ReAct 循环改为流式 chunk 输出

**文件**: `apps/agent/src/agent/react-loop.ts`

**改动**: 新增 `runReActLoopStream` 函数,输出 `AsyncGenerator<StreamChunk>`

```typescript
export async function* runReActLoopStream(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
): AsyncGenerator<StreamChunk, void, unknown>
```

**核心逻辑**:

```
1. 安全检查 (短路)
2. 构建 messages
3. 循环 (≤MAX_ITERATIONS):
   a. provider.streamWithTools(messages, toolDefs)
   b. 如果收到 tool_calls chunk:
      - 执行工具: tools.executeAll()
      - 把 assistant tool_call + tool results 加入 messages
      - 继续循环 (回到 a)
   c. 如果收到 token chunks:
      - 逐个 yield token
   d. 如果收到 done:
      - break
4. yield done
```

**关键**: 当 `streamWithTools` 返回 `tool_calls` 时,循环不结束——执行工具后把结果加入 messages,再次调用 `streamWithTools`。当返回 `token` 时,直接 yield 给上层(用户看到打字效果)。这样工具调用后的最终回复是流式的。

**同时保留** `runReActLoop` (非流式版本) 供非流式端点使用。

**依赖**: Task 1.1
**验证**: typecheck 通过;手动测试流式对话,工具调用后回复有打字效果

---

### Task 1.3: conversation route 使用流式 ReAct 循环

**文件**: `apps/agent/src/server/routes/conversation.ts`

**改动**: `POST /sessions/:sessionId/messages/stream` 端点改用 `runReActLoopStream`

```typescript
// SSE 端点改造
for await (const chunk of runReActLoopStream(...)) {
  switch (chunk.type) {
    case "token":
      reply.raw.write(`data: ${JSON.stringify({ token: chunk.content })}\n\n`);
      break;
    case "tool_calls":
      // 可选: 推送 "thinking" 状态给前端
      reply.raw.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
      break;
    case "done":
      reply.raw.write(`data: ${JSON.stringify({ done: true, reply: fullReply })}\n\n`);
      break;
  }
}
```

**依赖**: Task 1.2
**验证**: 浏览器测试——发一条长消息,观察是否有"思考中"状态 + 打字效果

---

### Task 1.4: 前端适配 thinking 状态

**文件**: `apps/web/src/features/agent/conversationApi.ts`

**改动**: `StreamCallbacks` 新增 `onThinking` 回调

```typescript
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (data: { userMessageId: string; agentMessageId: string }) => void;
  onError: (error: string) => void;
  onThinking?: () => void; // 新增: Agent 正在调用工具
}
```

**文件**: `apps/web/src/pages/CreateExperiencePage.tsx`

**改动**: 对话区域增加"思考中"动画指示器

```tsx
{
  isThinking && (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      正在思考...
    </div>
  );
}
```

**依赖**: Task 1.3
**验证**: 浏览器测试——发送消息后先看到"思考中",然后看到打字效果

---

## Phase 2: 上下文窗口管理 (P0)

解决长对话 token 超限崩溃问题。

### Task 2.1: Token 估算工具

**文件**: 新建 `apps/agent/src/utils/tokens.ts`

```typescript
/**
 * 估算字符串的 token 数。
 * 中文 1 字 ≈ 1.5 token,英文 1 词 ≈ 1.3 token。
 * 误差 ±20%,足够用于触发阈值判断。
 */
export function estimateTokens(text: string): number;

/**
 * 估算 ChatMessage[] 的总 token 数。
 * 包含每条消息的 role 开销 (~4 tokens)。
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number;

/**
 * 根据模型名返回上下文窗口大小。
 */
export function getContextWindowSize(model: string): number;
```

**模型窗口映射**:

```typescript
const CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  "glm-4": 128000,
  "glm-4-flash": 128000,
  "glm-4-air": 128000,
  default: 16384, // 保守默认
};
```

**依赖**: 无
**验证**: 单元测试 — `estimateTokens("你好世界")` ≈ 6, `estimateTokens("hello world")` ≈ 3

---

### Task 2.2: 对话历史压缩器

**文件**: 新建 `apps/agent/src/utils/context-compressor.ts`

```typescript
export interface CompressedHistory {
  summary: string; // 早期对话的摘要
  recentMessages: ChatMessage[]; // 保留的近期原始对话
  totalTokens: number; // 压缩后的估算 token 数
}

export class ContextCompressor {
  constructor(
    private provider: LLMProvider,
    private contextWindow: number,
  ) {}

  /**
   * 压缩对话历史。
   * @param messages 完整历史
   * @param existingSummary 已有的摘要(增量压缩)
   * @returns 压缩后的历史
   */
  async compress(messages: ChatMessage[], existingSummary?: string): Promise<CompressedHistory>;

  /**
   * 判断是否需要压缩。
   * 触发条件:估算 token > 窗口的 40%
   */
  needsCompression(messages: ChatMessage[]): boolean;
}
```

**压缩策略**:

1. 保留最后 N 轮原始对话(N 根据窗口大小动态计算:`recentTokens = contextWindow * 0.3`)
2. 更早的消息 + 已有摘要 → 生成新摘要
3. 摘要 prompt:
   ```
   请将以下对话历史压缩为一段不超过 200 字的摘要。
   保留:经历的核心事实、用户表达的情绪、Agent 已追问过的维度。
   丢弃:寒暄、重复内容。
   如有已有摘要,在其基础上增量更新。
   ```

**依赖**: Task 2.1
**验证**: 构造 30 条消息的测试用例,压缩后 token < 窗口的 50%

---

### Task 2.3: Go API 新增 summary 字段 + 压缩端点

**文件**: `apps/api/internal/database/models.go`

**改动**: `ConversationSession` 新增字段

```go
type ConversationSession struct {
  // ... 现有字段 ...
  SummaryText  string `gorm:"type:text" json:"summary_text"`     // 对话摘要
  CurrentState string `gorm:"type:varchar(50);default:'INTAKE'" json:"current_state"` // Task 3.1 用
}
```

**文件**: `apps/api/internal/http/handlers/conversation.go`

**改动**: `SendMessageStream` 和 `SendMessage` 在调用 Agent 前:

1. 从 DB 读取 `session.SummaryText`
2. 把 summary 作为 history 的第一条 system 消息传给 Agent
3. 如果消息数 > 阈值(如 20 条),调用 Agent 的压缩端点生成新摘要

**文件**: `apps/api/internal/integrations/agent/client.go`

**改动**: 新增 `CompressHistory` 方法

```go
func (c *Client) CompressHistory(ctx context.Context, messages []HistoryItem, existingSummary string) (string, error)
```

**文件**: `apps/agent/src/server/routes/conversation.ts`

**改动**: 新增 `POST /sessions/:sessionId/compress` 端点

```typescript
// 请求: { history: [], existing_summary?: string }
// 响应: { summary: string }
```

**依赖**: Task 2.2
**验证**: 数据库中 summary_text 字段有值;Agent 收到的 history 第一条是摘要

---

### Task 2.4: conversation graph 集成上下文压缩

**文件**: `apps/agent/src/graphs/conversation.graph.ts`

**改动**: `processConversation` 和 `streamConversation` 接收 `summary` 参数

```typescript
export async function* streamConversation(
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  runtime?: AgentRuntimeConfig | null,
  tools?: ToolRegistry | null,
  context?: ToolContext,
  summary?: string,  // 新增:历史摘要
): AsyncGenerator<string, void, unknown>
```

**buildChatMessages 改动**: 如果有 summary,在 system prompt 后插入

```typescript
function buildChatMessages(systemPrompt, history, userMessage, summary?) {
  const messages = [{ role: "system", content: systemPrompt }];
  if (summary) {
    messages.push({ role: "system", content: `之前的对话摘要:\n${summary}` });
  }
  messages.push(...history, { role: "user", content: userMessage });
  return messages;
}
```

**依赖**: Task 2.3
**验证**: 20 轮对话后 Agent 仍正常回复,不报 token 超限

---

## Phase 3: 对话状态机 (P1)

让 Agent 有"对话阶段"概念,根据阶段调整策略。

### Task 3.1: 定义状态和转移规则

**文件**: 新建 `apps/agent/src/agent/conversation-state.ts`

```typescript
export type ConversationState =
  | "INTAKE" // 初次描述
  | "PROBE" // 追问细节
  | "REFLECT" // 复述确认
  | "READY" // 可以生成
  | "GENERATING"; // 生成中

export interface StateContext {
  state: ConversationState;
  turnCount: number;
  probeCount: number; // PROBE 阶段已追问轮数
  collectedDimensions: string[]; // 已收集的维度: action/emotion/meaning
}

/**
 * 根据当前状态和用户消息,计算下一个状态。
 * 纯函数,无副作用,易于测试。
 */
export function transition(
  current: StateContext,
  userMessage: string,
  agentReply: string,
): StateContext;

/**
 * 根据状态返回对应的 system prompt。
 */
export function getPromptForState(state: ConversationState): string;
```

**转移规则** (在 `transition` 函数中实现):

```
INTAKE + 用户消息 >30字 → PROBE
INTAKE + "生成奖章" → READY
PROBE + probeCount >= 3 → REFLECT
PROBE + "生成奖章"/"够了" → READY
REFLECT + 用户确认 → READY
REFLECT + 用户纠正 → PROBE (probeCount 重置)
任意 + "生成奖章" → READY
```

**每个状态的 prompt**:

- `INTAKE`: "用户刚开始描述经历。温和鼓励,不要追问细节。"
- `PROBE`: "你在追问细节。每次只问一个维度:行动→情绪→意义。已收集维度: {collectedDimensions}。已追问 {probeCount} 轮。"
- `REFLECT`: "复述你的理解,确认是否准确。用'我听到你说的是...'开头。"
- `READY`: "信息已充分。简短确认,引导用户生成总结。"

**依赖**: 无 (纯逻辑)
**验证**: 单元测试 — 各种输入场景的状态转移正确

---

### Task 3.2: Go API 存储和传递对话状态

**文件**: `apps/api/internal/http/handlers/conversation.go`

**改动**:

1. `SendMessage` / `SendMessageStream` 从 DB 读取 `session.CurrentState` 和 `session.SummaryText`
2. 传给 Agent:在 `SendMessageRequest` 中新增字段

**文件**: `apps/api/internal/integrations/agent/client.go`

**改动**: `SendMessageRequest` 新增字段

```go
type SendMessageRequest struct {
  // ... 现有字段 ...
  ConversationState string `json:"conversation_state,omitempty"` // INTAKE/PROBE/REFLECT/READY
  TurnCount         int    `json:"turn_count,omitempty"`
  SummaryText       string `json:"summary_text,omitempty"`
}
```

3. Agent 返回时,从响应中读取新状态,更新 DB

**文件**: `apps/agent/src/server/routes/conversation.ts`

**改动**: 从请求体读取状态,传给 graph;从 graph 结果读取新状态,加入响应

```typescript
// 响应新增
{
  reply: string,
  done: boolean,
  session_id: string,
  conversation_state: string,  // 新增:更新后的状态
  turn_count: number,          // 新增:更新后的轮数
}
```

**依赖**: Task 3.1
**验证**: DB 中 current_state 字段随对话推进变化

---

### Task 3.3: conversation graph 集成状态机

**文件**: `apps/agent/src/graphs/conversation.graph.ts`

**改动**: `processConversation` 和 `streamConversation` 接收 `stateContext` 参数

```typescript
export async function* streamConversation(
  history: ...,
  userMessage: string,
  runtime?: ...,
  tools?: ...,
  context?: ...,
  summary?: string,
  stateContext?: StateContext,  // 新增
): AsyncGenerator<string | StreamChunk, void, unknown>
```

**核心改动**:

1. 用 `getPromptForState(stateContext.state)` 替代固定 system prompt
2. Agent 回复后调用 `transition(stateContext, userMessage, reply)` 计算新状态
3. 返回新状态给 route → Go API → DB

**与 ReAct 循环的关系**: 状态机决定 prompt,ReAct 循环决定工具调用。两者正交——每个状态都可以有工具调用,只是 prompt 不同。`runReActLoopStream` 接收 `systemPrompt` 参数,状态机决定传哪个 prompt。

**依赖**: Task 3.1, Task 3.2
**验证**: 对话从 INTAKE 开始,经过 PROBE,到 READY,状态流转正确

---

## Phase 4: 工具调用降级 (P1)

不支持 function calling 的模型自动降级。

### Task 4.1: 检测工具调用支持

**文件**: `apps/agent/src/providers/openai.ts`

**改动**: `chatWithTools` 方法增加错误检测

```typescript
async chatWithTools(messages, tools): Promise<LLMResponse> {
  try {
    // ... 现有逻辑 ...
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Premature close 降级 (现有)
    if (msg.includes("Premature close")) {
      return await this.streamFallback(messages);
    }

    // 工具调用不支持降级 (新增)
    if (isToolCallingError(err)) {
      throw new ToolCallingNotSupportedError(msg);
    }

    throw err;
  }
}
```

**文件**: `apps/agent/src/providers/types.ts`

**改动**: 新增错误类型

```typescript
export class ToolCallingNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolCallingNotSupportedError";
  }
}

function isToolCallingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("does not support function calling") ||
    (msg.includes("tool_calls") && msg.includes("not supported")) ||
    msg.includes("unrecognized request argument")
  );
}
```

**依赖**: 无
**验证**: typecheck 通过

---

### Task 4.2: Prompt-based 工具降级

**文件**: 新建 `apps/agent/src/agent/prompt-tools.ts`

```typescript
/**
 * 当模型不支持原生 function calling 时,用 prompt 描述工具。
 * LLM 在回复中输出 JSON 来"调用"工具。
 */
export function buildToolPrompt(tools: ToolDefinition[]): string {
  return `
你可以使用以下工具。需要调用时,在回复中输出 JSON:
{"tool_calls": [{"name": "工具名", "args": {参数}}]}

可用工具:
${tools.map(t => `- ${t.function.name}: ${t.function.description}`).join("\n")}
`.trim();
}

/**
 * 从 LLM 的文本回复中解析工具调用。
 * 返回 { toolCalls, remainingText } — remainingText 是非工具部分。
 */
export function parseToolCallsFromText(
  text: string,
): { toolCalls: ParsedToolCall[]; remainingText: string }

/**
 * 构建降级模式的完整消息序列。
 */
export async function* runPromptBasedToolLoop(
  provider: LLMProvider,
  tools: ToolRegistry,
  messages: ChatMessage[],
  context?: ToolContext,
): AsyncGenerator<StreamChunk>
```

**降级循环逻辑**:

1. 把 `buildToolPrompt(tools)` 加入 system prompt
2. `provider.stream(messages)` — 流式输出
3. 累积完整回复
4. `parseToolCallsFromText(reply)` — 检查是否包含工具调用 JSON
5. 如果有工具调用:执行工具,把结果加入 messages,回到步骤 2
6. 如果没有:回复完成

**依赖**: Task 4.1
**验证**: 用不支持 function calling 的模型测试,工具调用正常工作

---

### Task 4.3: ReAct 循环集成降级

**文件**: `apps/agent/src/agent/react-loop.ts`

**改动**: `runReActLoopStream` 捕获 `ToolCallingNotSupportedError` 后切换到降级模式

```typescript
export async function* runReActLoopStream(...): AsyncGenerator<StreamChunk> {
  // ... 安全检查 ...

  try {
    // 尝试原生 tool calling
    yield* runNativeToolLoop(provider, tools, messages, context);
  } catch (err) {
    if (err instanceof ToolCallingNotSupportedError) {
      // 降级到 prompt-based 工具调用
      yield* runPromptBasedToolLoop(provider, tools, messages, context);
    } else {
      throw err;
    }
  }
}
```

**依赖**: Task 4.2, Task 1.2
**验证**: 用支持和不支持 function calling 的两种模型分别测试

---

## Phase 5: 语义安全审查 (P2)

从关键词匹配升级到 LLM 语义理解。

### Task 5.1: 两层安全审查架构

**文件**: `apps/agent/src/safety/index.ts`

**改动**: 保留现有 `checkSafety` 作为第一层,新增第二层

```typescript
export interface SafetyResult {
  safe: boolean;
  reason?: string;
  safeResponse?: string;
  riskLevel?: "none" | "low" | "high"; // 新增
  needsSemanticCheck?: boolean; // 新增:是否需要第二层
}

// 第一层:关键词快速过滤 (现有,增加 needsSemanticCheck 判断)
export function checkSafety(content: string): SafetyResult {
  // ... 现有关键词检查 ...

  // 关键词未命中,但可能需要语义检查
  const negativeWords = [
    "难过",
    "绝望",
    "崩溃",
    "累",
    "压力",
    "孤独",
    "没意思",
    "撑不住",
    "放弃",
    "痛苦",
    "绝望",
  ];
  const hasNegativeSignal = negativeWords.some((w) => content.includes(w));

  if (hasNegativeSignal || content.length > 100) {
    return { safe: true, needsSemanticCheck: true };
  }

  return { safe: true };
}
```

---

### Task 5.2: LLM 语义安全审查

**文件**: 新建 `apps/agent/src/safety/semantic-check.ts`

```typescript
import type { LLMProvider, ChatMessage } from "../providers/types.js";

const SAFETY_CHECK_PROMPT = `你是安全审查助手。判断以下用户消息是否存在安全风险。

风险类型:
- 自伤自杀:表达结束生命的意愿或计划
- 暴力倾向:表达伤害他人的意图
- 严重心理危机:极端绝望、无法承受的痛苦

判断规则:
- 描述过去的困难但当前状态平稳 → 无风险
- 表达情绪低落但无自伤意图 → 低风险
- 暗示或明示自伤 → 高风险

输出 JSON: {"risk_level": "none|low|high", "reason": "简短理由", "safe_response": "high时必填"}`;

export async function semanticSafetyCheck(
  provider: LLMProvider,
  content: string,
): Promise<SafetyResult>;
```

**降级策略**: LLM 审查失败(超时/API 错误)时,返回 `{ safe: true, riskLevel: "none" }` — 不阻塞对话,宁可漏检不可误杀(误杀会让正常用户困惑)。

**依赖**: Task 5.1
**验证**: 测试 "觉得活着没意思" 返回 riskLevel=low, "不想活了" 返回 riskLevel=high

---

### Task 5.3: 安全审查集成到对话流

**文件**: `apps/agent/src/agent/react-loop.ts`

**改动**: `runReActLoopStream` 和 `runReActLoop` 中集成两层审查

```typescript
// 第一层:关键词
const safety = checkSafety(userMessage);
if (!safety.safe) {
  yield { type: "token", content: safety.safeResponse };
  yield { type: "done", finish_reason: "safety" };
  return;
}

// 第二层:语义审查 (异步,不阻塞主流程)
if (safety.needsSemanticCheck) {
  const semantic = await semanticSafetyCheck(provider, userMessage);
  if (semantic.riskLevel === "high") {
    yield { type: "token", content: semantic.safeResponse };
    yield { type: "done", finish_reason: "safety" };
    return;
  }
  // low/none: 继续正常对话,但 Agent 可以在回复中表达关注
}
```

**依赖**: Task 5.2, Task 1.2
**验证**: 发送 "觉得活着没意思" → Agent 正常回复但表达关注;发送 "不想活了" → 安全回复

---

## Phase 6: 输出质量闭环 (P2)

### Task 6.1: 规则检查器

**文件**: 新建 `apps/agent/src/agent/quality-check.ts`

```typescript
export interface QualityIssue {
  type: "format" | "relevance" | "safety";
  description: string;
  severity: "low" | "high";
}

export interface QualityResult {
  passed: boolean;
  issues: QualityIssue[];
}

/**
 * 规则检查 — 不调用 LLM,纯文本分析。
 */
export function checkReplyQuality(
  reply: string,
  context: {
    state: ConversationState;
    userMessage: string;
  },
): QualityResult {
  const issues: QualityIssue[] = [];

  // 格式检查
  if (/^\s*[\d一二三四五][.、)]/.test(reply)) {
    issues.push({ type: "format", description: "包含编号列表", severity: "high" });
  }
  if (reply.length > 500) {
    issues.push({ type: "format", description: "回复过长", severity: "low" });
  }

  // 追问检查
  if (context.state === "PROBE" && !reply.includes("?") && !reply.includes("？")) {
    issues.push({ type: "relevance", description: "PROBE 阶段没有追问", severity: "high" });
  }

  // 鸡汤检查 (简单关键词)
  const鸡汤Keywords = ["加油", "你一定可以", "相信自己", "永远不要放弃"];
  if (鸡汤Keywords.some((kw) => reply.includes(kw)) && reply.length < 50) {
    issues.push({ type: "relevance", description: "空洞鸡汤", severity: "low" });
  }

  return { passed: issues.length === 0, issues };
}
```

**依赖**: Task 3.1 (需要 ConversationState 类型)
**验证**: 单元测试 — 编号列表被检测,正常回复通过

---

### Task 6.2: LLM-as-judge 质量评估

**文件**: `apps/agent/src/agent/quality-check.ts` (同文件,追加)

```typescript
const JUDGE_PROMPT = `评估以下 Agent 回复的质量。

用户消息: {userMessage}
Agent 回复: {reply}
对话阶段: {state}

评分维度 (1-5):
1. 相关性: 回复与用户消息相关
2. 格式: 符合要求(无编号列表,每次一个问题)
3. 共情: 表达理解,不过度鸡汤

输出 JSON: {"score": 1-5, "issues": ["问题1", "问题2"], "should_retry": true|false}`;

export async function llmJudgeQuality(
  provider: LLMProvider,
  reply: string,
  context: { state: ConversationState; userMessage: string },
): Promise<QualityResult>;
```

**触发条件**: 只在规则检查发现 `severity: "low"` 的问题时触发(高 severity 直接重试,不需要 LLM 判断)。

**依赖**: Task 6.1
**验证**: 构造低质量回复,LLM judge 返回 should_retry=true

---

### Task 6.3: 质量闭环集成到 ReAct 循环

**文件**: `apps/agent/src/agent/react-loop.ts`

**改动**: 在最终回复 yield 前插入质量检查

```typescript
// 获得最终回复后
let finalReply = collectTokensFromStream();

// 质量检查
const quality = checkReplyQuality(finalReply, { state, userMessage });

if (!quality.passed && attempt < MAX_RETRIES) {
  // 在 messages 末尾加入质量反馈
  messages.push({ role: "assistant", content: finalReply });
  messages.push({
    role: "system",
    content: `上一次回复的问题: ${quality.issues.map(i => i.description).join(", ")}。请修正。`,
  });

  // 重新生成
  finalReply = collectTokensFromStream();
}

yield { type: "token", content: finalReply };
```

**MAX_RETRIES = 1** — 最多重试一次。两次都不行说明 prompt 或模型能力有问题。

**依赖**: Task 6.2, Task 1.2, Task 3.3
**验证**: 构造会导致编号列表的对话,观察 Agent 自动修正

---

## 实现顺序和依赖图

```
Phase 1 (流式+工具):
  1.1 streamWithTools ──→ 1.2 runReActLoopStream ──→ 1.3 route 改造 ──→ 1.4 前端适配

Phase 2 (上下文管理):          Phase 3 (状态机):
  2.1 token 估算                   3.1 状态定义
    ↓                                ↓
  2.2 压缩器                      3.2 Go API 存状态
    ↓                                ↓
  2.3 Go API + DB               3.3 graph 集成
    ↓
  2.4 graph 集成

Phase 4 (工具降级):              Phase 5 (安全审查):        Phase 6 (质量闭环):
  4.1 检测不支持                    5.1 两层架构              6.1 规则检查
    ↓                                ↓                          ↓
  4.2 prompt 降级                  5.2 LLM 审查              6.2 LLM judge
    ↓                                ↓                          ↓
  4.3 ReAct 集成                   5.3 对话流集成             6.3 ReAct 集成
```

**建议并行**: Phase 2 和 Phase 3 可以并行开发(不同文件,无依赖)。Phase 4 可以和 Phase 5 并行。Phase 6 依赖 Phase 3(需要状态类型)。

**总工作量估算**:

- Phase 1: ~2 天 (流式架构改造)
- Phase 2: ~2 天 (上下文压缩)
- Phase 3: ~3 天 (状态机设计和调试)
- Phase 4: ~1.5 天 (降级逻辑)
- Phase 5: ~1.5 天 (安全审查)
- Phase 6: ~2 天 (质量闭环)
- **总计: ~12 天**

---

## 每个阶段完成后的验证标准

| 阶段    | 验证方式                                                           |
| ------- | ------------------------------------------------------------------ |
| Phase 1 | 发长消息 → 看到"思考中" → 看到打字效果;发短消息 → 直接打字效果     |
| Phase 2 | 30 轮对话不崩溃;DB 中 summary_text 有值;Agent 回复引用早期对话信息 |
| Phase 3 | 对话从 INTAKE → PROBE → REFLECT → READY 流转;每阶段 prompt 不同    |
| Phase 4 | 用 GLM 模型测试工具调用正常;用 GPT-4o 测试原生 tool calling 正常   |
| Phase 5 | "觉得活着没意思" → Agent 关注但不拦截;"不想活了" → 安全回复        |
| Phase 6 | Agent 回复包含编号列表 → 自动修正为非编号格式                      |
