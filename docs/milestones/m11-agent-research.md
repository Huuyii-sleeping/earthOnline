# 生产级 Agent 重构技术路线

> 从"带工具调用的 chatbot"到"生产级对话 Agent"的完整重构。本文记录每个架构决策的推理过程——为什么需要状态机而非自由对话,为什么手写 ReAct 要迁移到 LangGraph,上下文压缩的触发点和策略选择。

## 现状诊断

当前 Agent 的架构特征:

```
用户消息 → 安全检查(关键词) → shouldUseTools(启发式) →
  需要工具: ReAct 循环(≤3轮, 非流式) → 一次性返回
  不需要工具: 直接流式 → 逐 token 返回
```

六个核心问题阻碍它成为生产级 Agent:

**流式与工具互斥**。`streamConversationWithTools` 在走工具路径时,ReAct 循环用 `chatWithTools`(非流式)完成推理,然后把完整回复一次性 `yield`。用户看不到打字效果,等待体验割裂。而当不走工具时,直接 `provider.stream()` 流式输出。这两种模式之间的切换由 `shouldUseTools` 启发式决定,但启发式判断本身不可靠——一个 48 字的消息不会触发工具,但可能需要历史上下文。

**无对话状态管理**。Agent 不知道对话处于哪个阶段。收集经历细节和确认生成总结应该用不同的策略,但当前每次调用都是无差别的 `conversationFollowupPromptV1`。对话第 1 轮和第 15 轮用完全相同的 system prompt,Agent 无法根据阶段调整追问深度。

**无上下文窗口管理**。`buildChatMessages` 把全部 history 直接塞进消息数组。20 轮对话(每轮 200 字)就是 8000 字,加上 system prompt 和工具定义,轻松超过小模型的 16K 上下文窗口。当前没有任何截断、摘要、token 计数机制。

**安全检查无语义理解**。`checkSafety` 是纯关键词子串匹配。"不想活了"会被拦截,但"觉得活着没意思"、"世界没有我会更好"不会。中文的安全表达极其丰富,关键词列表永远覆盖不全。

**无输出质量保障**。Agent 的回复质量完全靠 prompt 约束,没有评估和重试。LLM 可能生成空洞的鸡汤、机械的编号列表、或完全不相关的回复,这些都直接发给用户。

**工具调用无降级**。如果用户配的模型(如某些智谱 GLM 版本)不支持 function calling,`bindTools` 会报错。当前的降级逻辑只处理 `Premature close`,不处理 `tool calling not supported` 类错误。

## 架构目标

生产级 Agent 需要达成五个目标:

1. **流式 + 工具融合**:工具调用和流式输出不再互斥,用户始终看到打字效果
2. **对话状态机**:Agent 知道自己在"收集→追问→理解→确认→生成"的哪个阶段
3. **上下文压缩**:长对话自动摘要,token 消耗可控
4. **语义安全审查**:LLM-as-judge 理解安全风险,而非关键词匹配
5. **输出质量闭环**:低质量回复自动检测并重试

## 流式 + 工具融合

### 问题本质

OpenAI 的 tool calling 在流式模式下有两种实现方式:

**方式一:流式 tool call delta**。模型在流式输出时,tool call 的 `function.name` 和 `function.arguments` 也是逐 chunk 返回的。LangChain 的 `stream()` 方法在 `streaming: true` + `bindTools()` 时支持这个模式,但需要解析 `chunk.additional_kwargs.tool_calls` 中的增量 delta,拼接成完整的 tool call。这比非流式复杂得多——你需要处理 `index` 字段来正确拼接多个并行 tool call 的 delta。

**方式二:两阶段流式**。第一阶段用非流式 `invoke` 快速判断模型是否要调用工具(通常 1-2 秒)。如果要调用工具,执行工具后进入第二阶段:用流式 `stream` 生成最终回复。如果不要调用工具,把第一阶段的非流式结果一次性返回(或丢弃重新流式生成)。

### 选择两阶段流式

选方式二,原因:

方式一虽然技术上更优雅,但 OpenAI 兼容 API(智谱、DashScope)对流式 tool call delta 的支持参差不齐。LangChain 的 `chunk.additional_kwargs.tool_calls` 解析在不同实现间行为不一致。对于一个需要支持多种 LLM provider 的系统,依赖流式 tool call delta 太脆弱。

方式二的关键优势:工具决策阶段用非流式(可靠),最终回复阶段用流式(体验好)。代价是当模型不调用工具时,第一阶段的 `invoke` 结果被丢弃,重新走一次 `stream`——多一次 LLM 调用。但这个代价可以优化:如果第一阶段 `invoke` 在 2 秒内返回且不含 tool_calls,直接把 `content` 一次性 yield(放弃打字效果但省一次调用)。

### 实现

```
streamWithTools(messages, tools):
  1. result = provider.chatWithTools(messages, tools)   // 非流式, 2-5s
  2. if result.tool_calls:
       execute tools → append tool results to messages
       yield* provider.stream(messages)                  // 流式最终回复
  3. else:
       yield result.content                               // 直接返回, 不重新流式
```

这个方案的关键洞察:工具调用后的最终回复才是用户真正等待的内容,这部分的流式体验最重要。而工具调用决策阶段(2-5 秒)可以显示"正在思考..."的状态提示。

## 对话状态机

### 为什么需要状态机

当前对话是"无状态"的——每次调用都用同一个 system prompt,Agent 无法区分"刚开始收集经历"和"已经收集了 10 轮可以收尾了"。这导致两个问题:

**追问深度失控**。Agent 可能在第 1 轮就深入追问细节(用户还没建立信任),也可能在第 10 轮还在问基础问题(用户已经不耐烦了)。

**收尾时机不准**。`detectReadiness` 用关键词匹配判断是否准备好生成总结,但"总结"这个词在对话中可能出现得很早("我先总结一下我的想法..."),也可能永远不出现(用户直接说"差不多了")。

状态机让 Agent 有"对话阶段"的概念,每个阶段有明确的目标和策略。

### 状态设计

```
INTAKE     → 用户初次描述经历,Agent 做基础理解和情感回应
PROBE      → Agent 追问细节(行动/情绪/意义),最多 2-3 轮
REFLECT    → Agent 复述理解,确认是否准确
READY      → 双方确认信息充分,可以生成总结
GENERATING → 总结/奖章生成中(不再对话)
```

状态转移条件:

| 当前状态 | 转移到  | 条件                          |
| -------- | ------- | ----------------------------- |
| INTAKE   | PROBE   | 用户提供了基本经历描述(>30字) |
| INTAKE   | READY   | 用户直接说"生成奖章"          |
| PROBE    | REFLECT | 已追问 2-3 轮,或用户说"够了"  |
| PROBE    | READY   | 用户说"生成奖章"              |
| REFLECT  | PROBE   | 用户纠正了 Agent 的理解       |
| REFLECT  | READY   | 用户确认理解准确              |
| 任意     | READY   | 用户主动要求生成              |

### 状态存储

状态存在 Go API 的 `conversation_sessions` 表(新增 `current_state` 列),而非 Agent 端。原因:Agent 是无状态服务,Go API 才是会话状态的 owner。Go handler 在调用 Agent 前把当前状态传给 Agent,Agent 根据状态选择对应的 prompt 和策略,返回后 Go handler 更新状态。

```typescript
// Agent 接收的状态
interface ConversationContext {
  state: "INTAKE" | "PROBE" | "REFLECT" | "READY" | "GENERATING";
  turnCount: number;
  history: ChatMessage[];
}
```

每个状态有对应的 prompt 模板:

- `INTAKE`: 温和开放,鼓励用户开始讲述
- `PROBE`: 聚焦细节,每次只问一个维度(行动→情绪→意义)
- `REFLECT`: 复述确认,"我听到你说的是..."
- `READY`: 简短确认,"我们可以生成总结了"

### 与 LangGraph 的关系

`@langchain/langgraph` 已安装但未使用。状态机可以用 LangGraph 的 `StateGraph` 实现——每个状态是一个 node,转移条件是 edge。但 LangGraph 的价值不止于此:它还提供 checkpoint(状态持久化)、human-in-the-loop(人工中断)、streaming events(图执行过程的流式事件)等能力。

选择**先手写状态机,后续迁移到 LangGraph**。原因:当前状态机逻辑简单(5 个状态,7 条转移规则),手写更直观也更容易调试。等状态机验证可用后,再迁移到 LangGraph 获得 checkpoint 和 streaming events 能力。过早引入 LangGraph 会增加抽象层,让调试变难——你不知道问题是出在状态逻辑还是 LangGraph 的图执行引擎。

## 上下文窗口管理

### 问题量化

一次对话的 token 构成:

```
system prompt:      ~500 tokens
工具定义:           ~300 tokens
10 轮历史对话:      ~4000 tokens (每轮 ~400 tokens)
用户当前消息:       ~100 tokens
────────────────────────────
总计:               ~4900 tokens
```

10 轮对话约 5K tokens,还在 16K 窗口内。但 20 轮就到 9K,30 轮到 13K,接近窗口上限。加上工具调用产生的 tool_result 消息(每个最多 2000 字 ≈ 1000 tokens),token 消耗更快。

### 压缩策略

**滑动窗口 + 摘要**。保留最近 N 轮原始对话,更早的对话压缩为摘要。这是业界最成熟的策略,核心是"近期对话保真,远期对话保意"。

```
[摘要: 用户描述了学会自己吃饭的经历,Agent 追问了具体困难和感受]
[第8轮原始对话]
[第9轮原始对话]
[第10轮原始对话]
[当前用户消息]
```

触发条件:当 `estimatedTokens(history) > threshold` 时触发压缩。threshold 设为模型上下文窗口的 40%——给 system prompt、工具定义、当前消息和回复留 60% 的空间。

**Token 估算**。不使用 tiktoken(需要 WASM,增加依赖),用字符数近似:中文 1 字 ≈ 1.5 token,英文 1 词 ≈ 1.3 token。近似估算的误差在 ±20% 内,对触发阈值的判断足够了——我们不需要精确知道 token 数,只需要知道"该压缩了"。

**摘要生成**。用 `provider.chat()` 调用 LLM 生成摘要,prompt 要求:

- 保留经历的核心事实(发生了什么)
- 保留用户表达的情绪和态度
- 保留 Agent 已经追问过的维度(避免重复追问)
- 丢弃寒暄和重复内容
- 控制在 200 字以内

摘要生成是异步的——在 Agent 回复用户的同时,如果检测到需要压缩,启动一个后台任务生成摘要。下一轮对话时使用新摘要。这样压缩不阻塞当前回复。

**摘要存储**。摘要存在 Go API 的 `conversation_sessions` 表(新增 `summary_text` 列)。每轮对话后检查是否需要更新摘要,如果需要则异步生成并更新。Agent 收到的 history 是 `[summary_text, ...recent_messages]`。

## 语义安全审查

### 两层架构

**第一层:关键词快速过滤**(保留现有 `checkSafety`)。作为快速短路,捕获明确的安全关键词。这一层的目的是速度——不依赖 LLM 调用,1ms 内返回。

**第二层:LLM 语义审查**。当关键词检查通过但消息包含潜在风险信号时(如负面情绪词、痛苦表达),调用 LLM 做语义级判断。

触发第二层的条件:

- 消息包含负面情绪词但未命中第一层关键词("难过"、"绝望"、"崩溃"、"累"、"压力"、"孤独")
- 消息长度 > 100 字且情绪倾向为负面(简单情感分析:负面词占比 > 15%)

### LLM 安全审查 prompt

```
你是安全审查助手。判断以下用户消息是否存在安全风险。

风险类型:
- 自伤自杀:表达结束生命的意愿或计划
- 暴力倾向:表达伤害他人的意图
- 严重心理危机:极端绝望、无法承受的痛苦

判断规则:
- 用户描述过去的困难但当前状态平稳 → 无风险
- 用户表达情绪低落但无自伤意图 → 低风险(需关注)
- 用户暗示或明示自伤 → 高风险(需干预)

输出 JSON: {"risk_level": "none|low|high", "reason": "简短理由", "safe_response": "当 risk_level=high 时必填"}
```

### 降级策略

LLM 审查失败(超时、API 错误)时,降级为关键词检查结果。不阻塞用户对话——安全审查是增强,不是阻塞门。但如果是 `high` 风险,必须阻塞并返回安全回复。

## 输出质量闭环

### 质量评估维度

每次 Agent 回复后,用轻量级评估检查三个维度:

**相关性**:回复是否与用户消息相关(非答非所问)
**格式合规**:是否符合 prompt 要求(无编号列表、每次只问一个问题)
**安全合规**:不包含有害建议、不过度鸡汤

### 评估方式

用 LLM-as-judge,但**只在低置信度时触发**。先用规则检查:

- 回复包含编号列表 → 格式不合规,直接重试
- 回复长度 > 500 字 → 可能过于冗长,标记
- 回复不包含问号 且 对话状态是 PROBE → 可能没有追问,标记

规则检查不通过时,才调用 LLM-as-judge 做更细致的评估。这样大部分正常回复不需要额外的 LLM 调用。

### 重试机制

```
generateReply(messages):
  for attempt in 1..2:
    reply = provider.chat(messages)
    issues = checkQuality(reply, context)
    if issues.empty:
      return reply
    // 修正 messages: 加入质量反馈
    messages.push({ role: "system", content: `上一次回复的问题: ${issues}. 请修正。` })
  return reply  // 两次后仍不理想,返回最好的结果
```

最多重试 1 次。重试时在消息末尾加入质量反馈,让 LLM 知道上次的问题并修正。不无限重试——两次后仍不理想说明 prompt 或模型能力有问题,返回当前最好的结果。

## 工具调用降级

### 检测模型能力

不是所有 OpenAI 兼容 API 都支持 function calling。在第一次调用 `chatWithTools` 时检测:

```typescript
try {
  const result = await provider.chatWithTools(messages, tools);
  // 正常处理
} catch (err) {
  if (isToolCallingNotSupported(err)) {
    // 降级:用 prompt 描述工具,让 LLM 用文本"调用"
    return await fallbackToolCalling(provider, messages, tools);
  }
  throw err;
}
```

### Prompt-based 工具降级

当模型不支持原生 function calling 时,把工具定义嵌入 prompt:

```
你可以使用以下工具。需要调用时,输出 JSON 格式:
{"tool": "query_user_medals", "args": {"limit": 5}}

可用工具:
- query_user_medals: 查询用户已有奖章
- query_growth_profile: 查询成长画像
- query_recent_experiences: 查询最近经历
```

解析 LLM 输出中的 JSON,执行工具,把结果加入 messages。这是 function calling 出现前的经典做法,兼容所有模型,但不如原生 function calling 可靠(LLM 可能输出格式错误的 JSON)。

## 实现优先级

| 阶段 | 内容            | 解决的问题     | 复杂度 |
| ---- | --------------- | -------------- | ------ |
| P0   | 流式 + 工具融合 | 用户体验割裂   | 中     |
| P0   | 上下文窗口管理  | 长对话崩溃     | 中     |
| P1   | 对话状态机      | 追问深度失控   | 高     |
| P1   | 工具调用降级    | 不兼容模型报错 | 低     |
| P2   | 语义安全审查    | 安全检查遗漏   | 中     |
| P2   | 输出质量闭环    | 回复质量不可控 | 高     |

P0 是基础可用性问题——不解决的话用户直接能感知到。P1 是 Agent 智能度问题——解决后 Agent 从"chatbot"变成"有策略的对话者"。P2 是安全保障——上线前必须有,但可以先做 MVP 版本。

## 技术学习要点

**流式 tool calling 的底层机制**。OpenAI 的 streaming tool call 使用 `choices[0].delta.tool_calls` 数组,每个元素有 `index`(标识是第几个 tool call)、`id`(首个 chunk 有,后续无)、`function.name`(首个 chunk 有)、`function.arguments`(逐 chunk 增量)。拼接时需要按 `index` 分组,把 `arguments` 的 delta 串接。LangChain 的 `streamEvents` API 封装了这个逻辑,但不同 provider 的兼容性差异大。

**上下文压缩的工程权衡**。压缩不是免费的——生成摘要本身需要一次 LLM 调用(约 2-3 秒)。如果对话每轮都压缩,延迟和成本翻倍。触发阈值的选择是关键:太低(如 2K tokens)频繁压缩影响体验,太高(如 12K tokens)留给回复的空间不够。40% 窗口大小是经验值,在不同模型上需要调整。

**对话状态机与 RASA/Dialogflow 的对比**。传统任务型对话系统(RASA、Dialogflow)用 intent classification + slot filling 做状态管理——先识别用户意图,再填充预定义的槽位。LLM Agent 不需要显式 intent classification(LLM 自己理解意图),但需要 slot filling 的思想——明确"已经收集了哪些维度的信息,还缺哪些"。状态机的本质是给 LLM 提供结构化的对话进度感知。

**LLM-as-judge 的已知局限**。研究表明 LLM-as-judge 存在 position bias(偏好第一个出现的选项)、length bias(偏好更长的回复)、self-preference(偏好自己生成的内容)。在输出质量评估中,这些偏见会导致:LLM 倾向于给更长但未必更好的回复更高分。缓解方式:用 pairwise comparison 而非 single-point scoring,或用多个 judge 投票。
