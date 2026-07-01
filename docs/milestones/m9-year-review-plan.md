# Milestone 9 实现路线：年度回顾

> 状态：规划中。M9 在 M7 阶段总结和 M8 成长画像之上，构建年度级别的长叙事回顾能力。不替换现有周/月总结，而是在其上做更高维度的聚合与叙事。

## 背景与目标

M7 完成了周/月阶段总结，M8 完成了成长画像与推荐增强。PRD 第 9 节"连续记录与阶段性产出"中提到的"阶段性大奖章"和"个人成长画像更新"已分别由 M7 和 M8 落地，但还缺一个年度维度的长叙事回顾。

年度回顾与周/月总结的差异在于：

- 周/月总结是"这段时间发生了什么"，年度回顾是"这一整年我走过了什么路"。
- 周/月总结以经历为输入，年度回顾以奖章、阶段总结、成长画像为多源输入。
- 周/月总结是短叙事（150-280 字），年度回顾是长叙事（800-1500 字），包含主题提炼、里程碑、成长弧线。
- 年度回顾是用户最有动力分享和回看的产物，视觉和交互需要更强。

M9 的目标：

- 在年底或用户主动触发时，从年度奖章、阶段总结、成长画像中提取年度回顾。
- 生成包含年度主题、里程碑奖章、成长弧线、情绪轨迹、关键词演化的结构化长叙事。
- 在前端以独立页面展示年度回顾，支持分享卡片导出。
- 保持 Go API 为唯一数据写入入口，Agent 只负责结构化生成。

## 范围

本阶段做：

- 后端新增 `annual_reviews` 数据模型。
- Agent 新增年度回顾 prompt / schema / graph / route。
- Go API 新增年度回顾查询与生成接口。
- Worker 支持年底定时生成 + 手动触发。
- 前端新增年度回顾独立页面，包含长叙事展示、里程碑时间线、关键词云、情绪轨迹、年度奖章精选。
- 年度回顾生成后触发成长画像刷新（年度信号是画像的重要输入）。
- 补充后端测试、Agent 类型校验、前端类型校验和构建校验。

本阶段不做：

- 不做年度回顾的公开展示和社交分享流（M10 再做）。
- 不做年度报告的 PDF 导出（先 HTML 页面，后续可扩展）。
- 不做跨年对比（先做单年回顾）。
- 不做年度奖章视觉特殊生成（复用现有奖章视觉体系）。
- 不引入新的外部依赖（复用现有 LLM Provider、asynq、GORM）。

## 数据设计

### annual_reviews

用户年度回顾，一人一年一行。

建议字段：

- `user_id`：用户 ID。
- `year`：年份整数，如 2026。
- `status`：`pending` / `completed` / `failed`。
- `title`：年度回顾标题，如"在不确定中站稳的一年"。
- `narrative`：年度长叙事正文，800-1500 字。
- `annual_themes_json`：年度主题数组，2-4 个，如"独立"、"连接"、"突破"。
- `milestone_medals_json`：里程碑奖章数组，每个含 medal_id、title、short_reason、milestone_type（`action` / `emotion` / `growth` / `relation`）、agent_note。
- `growth_arc_json`：成长弧线，含 start_state、turning_points、end_state。
- `emotion_arc_json`：情绪轨迹，按季度或半年的情绪摘要数组。
- `keyword_evolution_json`：关键词演化，对比年初/年末的关键词变化。
- `medal_count`：年度奖章总数。
- `stage_summary_count`：年度阶段总结数。
- `experience_count`：年度经历数。
- `generated_by`：`agent`。
- `trigger`：`manual` / `scheduled` / `year_end`。
- `error_msg`：失败时的错误信息。

唯一索引：`(user_id, year)`，保证一人一年只有一份年度回顾。

### 不新增 growth_insights 变体

年度回顾生成时，可以复用 M8 的 `growth_insights` 表写入一条 `period_type = "year"` 的洞察记录，无需新增表。年度回顾本身的详细内容存在 `annual_reviews` 表中，`growth_insights` 只作为画像系统的信号索引。

## API 设计

- `GET /api/v1/annual-reviews`
  返回当前用户的年度回顾列表（按年份倒序），支持分页。

- `GET /api/v1/annual-reviews/:year`
  返回指定年份的年度回顾详情。不存在时返回 404。

- `POST /api/v1/annual-reviews/generate`
  手动生成年度回顾。请求体：

  ```json
  { "year": 2026 }
  ```

  如果该年回顾已存在，返回 409 Conflict（不覆盖已有回顾；如需重新生成，先删除再生成）。生成过程同步调用 Agent，超时 180 秒。

- `DELETE /api/v1/annual-reviews/:year`
  删除指定年份的年度回顾。删除后可以重新生成。

## Agent 设计

新增 Agent 能力：

- `POST /year/review`
  输入用户年度奖章、阶段总结、成长画像摘要、经历统计，输出结构化年度回顾。

### 输入结构

```typescript
interface YearReviewInput {
  year: number;
  medals: YearMedalItem[]; // 年度奖章精选（最多 20 枚）
  stageSummaries: YearStageItem[]; // 年度阶段总结（最多 12 条）
  growthProfile?: GrowthProfileSnapshot; // 当前成长画像快照（可能为空）
  stats: {
    medalCount: number;
    experienceCount: number;
    stageSummaryCount: number;
  };
}
```

### 输出 Schema

```typescript
const yearReviewSchema = z.object({
  title: z.string().min(1).max(30),
  narrative: z.string().min(200).max(2000),
  annualThemes: z.array(z.string()).min(1).max(5),
  milestoneMedals: z
    .array(
      z.object({
        medalId: z.string().optional(),
        title: z.string(),
        shortReason: z.string(),
        milestoneType: z.enum(["action", "emotion", "growth", "relation"]),
        agentNote: z.string(),
      }),
    )
    .max(6),
  growthArc: z.object({
    startState: z.string(),
    turningPoints: z.array(z.string()).max(3),
    endState: z.string(),
  }),
  emotionArc: z
    .array(
      z.object({
        period: z.string(), // "Q1" | "Q2" | "H1" | "Q3" | "Q4" | "H2"
        emotion: z.string(),
        summary: z.string(),
      }),
    )
    .max(4),
  keywordEvolution: z.object({
    earlierKeywords: z.array(z.string()),
    laterKeywords: z.array(z.string()),
    shift: z.string(), // 描述关键词变化的一句话
  }),
});
```

### Prompt 原则

- 年度回顾不是简历，不是绩效考评，是"回望自己走过的一年"。
- 叙事风格偏"散文式回顾"，不是罗列成就清单。
- 允许识别"平淡的一年"、"艰难的一年"、"突破的一年"等整体基调。
- 里程碑奖章不超过 6 枚，选择最有代表性的，不追求数量。
- 情绪轨迹按季度或半年度划分，不细化到月。
- 关键词演化对比年初和年末，识别变化方向。
- 不编造用户未记录的经历，所有结论必须基于输入数据。
- 用"从记录中呈现出……"而非"你是一个……的人"。
- 允许低置信：数据不足时输出简短回顾，不强行填充。

### Prompt 版本管理

```
apps/agent/src/prompts/
  year-review.v1.ts        // 年度回顾 prompt
```

记录 `prompt_name`、`prompt_version`、`model_provider`、`model_name` 用于回溯。

## Worker 设计

新增任务类型：

- `year_review.generate_user`
  生成单个用户的年度回顾。

触发点：

- 手动生成接口同步执行（不经过 Worker，直接在 HTTP handler 中调 Domain Service）。
- 年底定时任务：每年 1 月 1 日 05:00 自动生成上一年的年度回顾（错开 stage summary 的 03:00 和 growth profile 的 04:00）。
- 用户也可以在年内任意时间手动生成当前年的回顾（数据可能不完整，但允许）。

执行策略：

- 年度回顾是重任务（输入数据量大、输出长），超时设为 180 秒。
- 使用 `asynq.Unique(24 * time.Hour)` 防止同一用户同一年短时间重复入队。
- Agent 调用失败时记录任务错误，不影响其他用户。
- 年度回顾生成成功后，best-effort 触发成长画像刷新（年度回顾是画像的重要信号）。

### 定时调度

```
0 5 1 1 *  // 每年 1 月 1 日 05:00，生成上一年的回顾
```

定时任务会遍历所有活跃用户，为每个用户生成上一年的年度回顾。已存在回顾的用户跳过（幂等）。

## 前端设计

### 路由

- `/year-review` — 年度回顾列表页（按年份倒序展示所有已生成的年度回顾）
- `/year-review/:year` — 年度回顾详情页

### 列表页

- 展示已生成的年度回顾卡片列表，每张卡片包含：年份、标题、年度主题标签、奖章数/经历数/总结数统计、生成时间。
- 顶部"生成年度回顾"按钮：选择年份后触发生成。
- 空态：无年度回顾时展示引导文案。

### 详情页

年度回顾详情页是 M9 的核心前端交付，需要比阶段总结更丰富的展示：

1. **年度封面区**：年份大字 + 年度回顾标题 + 年度主题标签。
2. **长叙事正文**：narrative 全文展示，支持段落排版。
3. **里程碑奖章**：横向滚动或网格展示 milestone_medals，每枚奖章含标题、授奖理由、里程碑类型标签、Agent 点评。
4. **成长弧线**：起点 → 转折点 → 终点的可视化展示，用简洁的路径图或时间线。
5. **情绪轨迹**：按季度的情绪摘要卡片。
6. **关键词演化**：年初关键词 vs 年末关键词的对比展示，中间用箭头或变化描述连接。
7. **年度统计**：奖章数、经历数、阶段总结数的数字展示。

### 展示原则

- 年度回顾默认仅本人可见。
- 叙事风格克制，不做"年度总结报告"式的冰冷罗列。
- 数据不足（如全年只有 1-2 枚奖章）时，回顾内容简短，不强行拉长。
- 生成中、生成失败、未生成三种状态都有清晰反馈。

## 分阶段实现

### M9.1 后端数据模型与 DTO

- 新增 `AnnualReview` GORM model。
- 注册 AutoMigrate。
- 新增 DTO 与 response mapper。
- 新增 `growth_insights` 的 `period_type = "year"` 支持（已有字段，无需改表）。

验收：

- `go test ./...` 通过。
- 数据表可由 AutoMigrate 创建。
- `(user_id, year)` 唯一索引生效。

### M9.2 Agent 年度回顾生成能力

- 新增 `year-review.v1.ts` prompt。
- 新增 Zod schema。
- 新增 `year-review.graph.ts`：组装多源输入（奖章 + 阶段总结 + 画像快照 + 统计），调用 LLM，Zod 校验输出。
- 新增 `/year/review` route。

验收：

- Agent `typecheck` / `build` 通过。
- malformed JSON 会被 schema 拒绝。
- 输入为空奖章 + 空阶段总结时，Agent 返回简短回顾而非报错。

### M9.3 Go API 年度回顾服务

- 新增 `domain/yearreview` service：
  - 收集用户年度奖章（含 version 详情）。
  - 收集用户年度阶段总结。
  - 获取当前成长画像快照。
  - 统计经历数。
  - 调用 Agent `/year/review`。
  - 持久化 `annual_reviews`。
  - best-effort 写入 `growth_insights`（period_type=year）。
  - best-effort 触发成长画像刷新。
- 新增 `GET /annual-reviews`、`GET /annual-reviews/:year`、`POST /annual-reviews/generate`、`DELETE /annual-reviews/:year`。
- 手动生成需要鉴权，只能操作当前用户。
- 同步生成超时 180 秒。

验收：

- 当前用户只能读写自己的年度回顾。
- Agent 失败时返回明确错误，不写入半成品。
- 已存在回顾时 generate 返回 409。
- 数据不足（如 0 枚奖章）时返回 422，提示"今年还没有足够的记录来生成年度回顾"。

### M9.4 Worker 年度定时任务

- 新增 `year_review.generate_user` 任务。
- 新增 `year_review.generate_year` 批量任务（遍历活跃用户，为每人入队单用户任务）。
- 定时调度：每年 1 月 1 日 05:00 生成上一年回顾。
- `asynq.Unique(24h)` 防重复。

验收：

- 同一用户同一年短时间重复触发只入队一次。
- 已有回顾的用户被跳过。
- Agent 失败不影响其他用户。

### M9.5 前端年度回顾页面

- 新增 `features/year-review/yearReviewApi.ts`。
- 新增 `pages/YearReviewListPage.tsx`：年度回顾列表 + 生成年度回顾按钮。
- 新增 `pages/YearReviewDetailPage.tsx`：年度回顾详情页，包含长叙事、里程碑奖章、成长弧线、情绪轨迹、关键词演化、年度统计。
- 路由注册到 `app/routes.tsx`。
- 个人主页和导航栏增加年度回顾入口。

验收：

- Web `typecheck` / `build` 通过。
- 未生成、生成中、生成失败、生成成功四种状态都有可见反馈。
- 详情页各区块在数据为空时有合理的空态处理。

### M9.6 成长画像联动

- 年度回顾生成后触发成长画像刷新（复用 M8 的 taskqueue 机制）。
- 成长画像刷新时，将年度回顾作为信号纳入（period_type=year 的 growth_insight 已在 M9.3 写入）。
- 前端成长档案区域展示年度洞察记录（growth_insights 列表已支持，只需确认 period_type=year 的记录正常展示）。

验收：

- 年度回顾生成后，成长画像在异步刷新后纳入年度信号。
- 成长档案页面的"近期洞察"列表能展示年度级别的洞察。

### M9.7 全量校验与总结

- Go：`test` / `vet` / `build`。
- Agent：`typecheck` / `build`。
- Web：`typecheck` / `build`。
- 更新本文档状态、完成摘要、遗留问题。
- 提交代码与文档。

## 风险与取舍

- **Agent 输出过长导致质量下降**：年度叙事 800-1500 字是单次 LLM 调用能稳定生成的上限。如果质量不够，M9 后续可拆分为"主题提炼 + 叙事生成"两步调用，但第一版先做单次。
- **多源输入 token 消耗**：年度奖章可能很多，需要在 Domain Service 层做精选（如按 memory_weight 排序取 top 20），而非全量传入。
- **年底集中生成的并发压力**：定时任务遍历所有用户逐个入队，通过 `asynq.Queue("low")` + `Concurrency=5` + `Unique(24h)` 限流。如用户量大可后续改为分批。
- **年度回顾与成长画像的循环依赖**：年度回顾读取成长画像作为输入，生成后又触发画像刷新。这不是循环依赖——年度回顾读的是"当前快照"，刷新后画像更新的是"纳入年度信号后的新画像"，下次年度回顾会读到新画像。M9 的刷新只追加 growth_insight，不修改 annual_reviews 已有内容。
- **年内手动生成的数据不完整**：用户在年中被触发生成时，数据只覆盖半年。这是允许的行为，回顾内容会反映"截至生成时"的状态。年底定时任务会为已有回顾的用户跳过，不会覆盖年中版本。如需更新，用户可先删除再重新生成。
- **隐私风险**：年度回顾默认仅本人可见，不进入社交流。公开展示和分享留到 M10。

## 实现顺序建议

先做 M9.1-M9.3，打通"手动生成年度回顾"的最小闭环；再做 Worker 定时任务（M9.4）；然后做前端页面（M9.5）；最后做画像联动（M9.6）和全量校验（M9.7）。

这样即使定时任务和前端页面延期，后端 API 也能独立交付，前端可以先通过 API 手动触发生成和查看。
