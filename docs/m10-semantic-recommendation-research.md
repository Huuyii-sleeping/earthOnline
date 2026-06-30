# 语义推荐引擎技术路线

> 从子串匹配到向量语义检索的完整重构。本文不是实现检查清单,而是每个技术决策背后的推理过程——为什么选 HNSW 而非 IVFFlat,为什么 RRF 比加权平均更适合这个场景,embedding 维度截断会损失多少信息。

## 问题定义

当前 `similarFeed` 的核心是 `scoreMedalByKeywords` 函数:

```go
haystack := strings.ToLower(medal.Title + " " + medal.ShortReason)
for _, kw := range keywords {
    if strings.Contains(haystack, kw) {
        score++
    }
}
```

它做的是字面子串匹配。这导致两个根本性的问题:

**同义不匹配**:用户画像关键词是"独立",但奖章标题写的是"一个人搬到了新城市"。字面无交集,语义高度相关。中文的同义表达尤其丰富——"克服恐惧"、"面对恐惧"、"战胜害怕"表达的是相近的意思,但子串匹配会把它们当成完全无关的内容。

**跨语言断裂**:用户的经历可能中英混杂(比如工作场合用英文记录),关键词匹配无法跨越语言边界。

语义推荐引擎的目标:把每枚奖章的文本内容编码成一个高维向量,使得语义相近的奖章在向量空间中距离也近,然后用 ANN(Approximate Nearest Neighbor)算法在毫秒级找到最相似的奖章。

## Embedding 模型选型

### MRL 与维度截断

OpenAI 的 `text-embedding-3-small` 和 `text-embedding-3-large` 采用了 Matryoshka Representation Learning(MRL,套娃表示学习)训练方法。MRL 的核心思想是:模型的输出向量在前 N 维就包含了足够的语义信息,后面的维度提供更精细的区分度。这意味着你可以把一个 1536 维的向量截断到 256 维使用,只损失少量精度。

这在工程上的意义是:维度是可调的成本旋钮。1536 维向量在 pgvector 中每行占 6KB 存储,256 维只占 1KB。对于一个可能有数万到数十万枚奖章的系统,存储和索引内存的差距是显著的。MRL 让你在召回率(recall)和资源消耗之间做精细权衡,而不是在"全量"和"不用"之间做二选一。

### 选型决策

| 模型                   | 维度                    | 中文质量       | 单价(每1M token) | 适用场景         |
| ---------------------- | ----------------------- | -------------- | ---------------- | ---------------- |
| text-embedding-3-small | 1536(可截断到512/256)   | 良好           | $0.02            | 本项目首选       |
| text-embedding-3-large | 3072(可截断到1536/1024) | 优秀           | $0.13            | 召回率瓶颈时升级 |
| BAAI/bge-m3(开源)      | 1024                    | 优秀(中英双语) | 自部署成本       | 需离线/私有化时  |

选择 `text-embedding-3-small` 并截断到 512 维。理由:

512 维在 pgvector 中每行占 2KB,HNSW 索引内存占用可控。MRL 截断到 512 维时,在 MTEB 基准测试上的召回率下降约 2-3%,对本应用的语义匹配场景可接受——我们不需要做法律级别的精确匹配,只需要找到"大致在说类似事情"的奖章。如果后续发现召回率不够,升到 1536 维只需要重新生成 embedding 并重建索引,代码不需要改。

### Embedding 输入设计

给 embedding 模型的输入不是原始的 `title` 字段,而是拼接后的富文本:

```
标题：一个人搬到了新城市
授奖理由：第一次独自处理搬家全过程,从找房到签约
记忆重量：heavy
意义聚焦：独立
```

把结构化字段拼接成自然语言文本再 embedding,比单独 embedding 标题效果更好。原因:embedding 模型是在自然语言上训练的,结构化字段拼接成句子后,模型能更好地捕捉字段间的语义关系。`memory_weight` 和 `meaning_focus` 是重要的语义信号,如果只 embedding 标题会丢失这些上下文。

## pgvector 索引选型

### HNSW vs IVFFlat 的算法差异

pgvector 支持两种 ANN 索引:HNSW 和 IVFFlat。理解它们的算法原理才能做出正确的选择。

**IVFFlat**(Inverted File with Flat compression)的原理是把向量空间用 k-means 聚类成 `lists` 个区域。查询时只搜索查询向量最近的 `probes` 个区域。它是一种"分而治之"的策略:把全量扫描变成局部扫描。问题是聚类是静态的——数据分布变化后,聚类质量会下降,需要重建索引。而且 IVFFlat 需要先有数据才能建索引(需要 k-means 训练),不适合空表。

**HNSW**(Hierarchical Navigable Small World)的原理是构建一个多层图。最底层包含所有节点,上层是稀疏化的"快速通道"。查询时从最顶层开始贪心搜索,逐层下降,最终在底层找到近邻。它是一种"跳表式"的策略:用空间换时间,多层结构让查询能快速跳过大量不相关的节点。

关键差异在构建和查询的权衡:

| 维度                 | HNSW                                  | IVFFlat                               |
| -------------------- | ------------------------------------- | ------------------------------------- |
| 查询速度(相同召回率) | 更快                                  | 较慢                                  |
| 索引构建时间         | 较慢(需构建多层图)                    | 较快(k-means 一次)                    |
| 内存占用             | 较大(存储图结构)                      | 较小                                  |
| 是否需要训练数据     | 不需要(可空表建索引)                  | 需要(k-means 聚类)                    |
| 增量插入性能         | 较好(局部更新图)                      | 较差(聚类不变,新数据可能落入错误区域) |
| 参数调优复杂度       | `m` + `ef_construction` + `ef_search` | `lists` + `probes`                    |

### 选择 HNSW

本项目的数据特征是持续增量写入(用户不断创建新奖章),且初始数据量可能为空(新部署的系统)。HNSW 不需要训练数据就能建索引,且增量插入性能更好,适合这种场景。IVFFlat 的聚类在数据分布变化后需要重建,维护成本更高。

HNSW 的三个参数:

- `m`(每层最大连接数,默认16):控制图的密度。m 越大,召回率越高,但内存和构建时间增加。本项目的奖章文本语义区分度不高(都是个人经历),用默认 16 即可。如果召回率不够,升到 24。
- `ef_construction`(构建时候选列表大小,默认64):控制构建时的搜索范围。值越大,图质量越高,构建越慢。用默认 64。
- `ef_search`(查询时候选列表大小,默认40):控制查询时的搜索范围。这是唯一需要在运行时调优的参数——值越大召回率越高但查询越慢。初始设为 100(略高于默认 40),通过 A/B 测试找到召回率和延迟的平衡点。

### 距离函数

pgvector 支持余弦距离(`<=>`)、L2 距离(`<->`)、内积(`<#>`)。选择余弦距离,因为:

embedding 模型的输出向量模长不固定,我们不希望向量模长影响相似度计算——两段语义相同但长度不同的文本(比如"独立"和"一个人处理了所有事情,没有依赖任何人")应该被认为是相似的。余弦距离只关注向量方向,忽略模长,符合这个需求。

```sql
CREATE INDEX idx_medals_embedding_hnsw ON medals
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

## 混合排序策略

### 为什么不能只用语义相似度

纯语义推荐有一个已知问题:它会推荐语义相似但质量不高的内容。一篇关于"独立"的平淡奖章可能和用户画像高度相似,但互动量为零、发布于一年前。如果只按语义相似度排序,这些"相似但无趣"的内容会占据 Feed 前列。

真实的推荐需求是多目标的:既要语义相关,又要有时效性,还要考虑社交关系和社区热度。这就是混合排序(hybrid ranking)要解决的问题。

### 两种融合策略

**加权线性组合**(Weighted Linear Combination)把各维度分数归一化到 [0,1] 后加权求和:

```
final_score = w1 * cosine_similarity + w2 * interaction_score + w3 * recency_score + w4 * following_boost
```

优点:直观,权重可直接解释("语义占 40%,互动占 30%...")。缺点:各维度的分数分布不同——余弦相似度集中在 0.7-0.95 区间,互动计数是长尾分布。归一化方法(min-max、z-score、log)的选择会显著影响最终排序,且不同维度之间的"分数尺度"不可比。

**RRF**(Reciprocal Rank Fusion,倒数排名融合)不用分数,只用排名:

```
RRF_score(d) = Σ 1 / (k + rank_i(d))
```

其中 `rank_i(d)` 是文档 d 在第 i 个排序列表中的排名位置,`k` 是平滑常数(通常取 60)。RRF 的核心优势是对分数尺度不敏感:它只关心"这个奖章在语义排序中排第几"和"在热度排序中排第几",不关心具体分数是多少。

### 选择 RRF

本项目的各维度分数天然不可比:余弦相似度是 0-1 的浮点数,互动计数是 0-500 的整数,时间衰减是指数函数。用 RRF 避免了归一化的陷阱。

`k` 值的选择:pgvector 文档和多数实践案例用默认值 60。较小的 `k`(如 30)让排名靠前的结果权重更大——意味着"语义排名第一"的奖章比"热度排名第一"的更有优势。本项目初始用 `k=40`,偏向让语义匹配的结果有更高权重,因为这是相似推荐(不是热度推荐),语义相关性是首要目标。

### 具体融合维度

对于 `similar` tab,融合三个排序列表:

1. **语义相似度排名**:pgvector ANN 查询返回的 top-K 奖章,按余弦相似度排名。
2. **互动热度排名**:同一批奖章按互动计数排名。
3. **时间衰减排名**:按 `exp(-days_old / 30)` 排名——30 天前的奖章衰减到 e^-1 ≈ 0.37,半年前的衰减到 0.0025,基本退出竞争。

三路 RRF 融合后,语义匹配但冷门的奖章不会被完全埋没(语义排名靠前),但热门且新鲜的语义匹配会排到最前面。

## 冷启动

新奖章刚创建时,没有 embedding、没有互动数据、没有时间衰减信号。三路排名都缺数据。

解决策略分两层:

**embedding 即时生成**:奖章创建成功后,在同一个 HTTP 请求中同步生成 embedding 并写入数据库。embedding 生成延迟约 200-500ms(text-embedding-3-small),对用户可接受。这样奖章一创建就有语义排名,不依赖异步任务。

**互动冷启动用时间衰减兜底**:新奖章的互动计数为 0,在热度排名中排最后。但时间衰减排名中排最前(刚创建,衰减值接近 1)。RRF 融合后,新奖章会被"时间新鲜度"抬升,不会被"零互动"完全压低。这比给新内容一个固定 boost 更优雅——boost 是硬编码的,时间衰减是自然的。

## 增量更新管线

奖章的 embedding 不是一成不变的。当用户修改奖章版本(version 回退或重新生成)时,奖章的文本内容会变化,embedding 需要更新。

设计一个异步 embedding 刷新管线:

```
奖章版本变更 → 写入 embedding_refresh_queue → Worker 异步处理 → 调用 OpenAI API → 更新 medals.embedding
```

不使用同步更新,因为版本回退可能发生在批量操作中(比如用户一次性恢复多个旧版本),同步调用 embedding API 会阻塞主流程。异步队列让 embedding 更新可重试、可限流、可监控。

`embedding_refresh_queue` 可以复用 asynq。任务类型 `medal.embedding_refresh`,payload 是 medal_id。Worker 收到任务后,读取奖章最新版本的文本,调用 embedding API,更新数据库。`asynq.Unique(1h)` 防止短时间重复刷新。

## 用户画像 embedding

当前的 `similarFeed` 用用户画像关键词做匹配。升级到语义后,需要把用户画像也编码成向量。

方案:把用户的成长画像 `summary_text` + `trait_keywords` + `growth_keywords` 拼接成一段文本,生成一个 embedding,存入 `growth_profiles.embedding` 列。这个 embedding 代表"这个用户是谁"的语义指纹。

查询时,用用户画像 embedding 作为查询向量,在奖章 embedding 索引上做 ANN 搜索,找到语义上和用户画像最相近的奖章。这比用关键词子串匹配强得多——画像里写"独立自主",奖章里写"一个人完成了所有事",两者在向量空间中会自然靠近。

画像 embedding 在画像刷新时更新(复用 M8 的 growth profile refresh worker,在刷新画像后同步更新 embedding)。

## 分阶段实现

### 第一阶段:基础设施

给 PostgreSQL 安装 pgvector 扩展,在 Docker Compose 中用 `pgvector/pgvector:pg16` 镜像替换原 `postgres:16-alpine`。这个镜像预装了 pgvector,不需要在容器内编译。

创建 `embedding` 包,封装 OpenAI embedding API 调用:

```go
type EmbeddingClient struct {
    apiKey  string
    model   string  // "text-embedding-3-small"
    dim     int     // 512
}
func (c *EmbeddingClient) Embed(ctx, text) ([]float32, error)
```

`dim=512` 通过 API 参数 `dimensions: 512` 传入,OpenAI 会在服务端做 MRL 截断,返回 512 维向量。

### 第二阶段:数据模型与索引

在 `medals` 表新增 `embedding vector(512)` 列。在 `growth_profiles` 表新增 `embedding vector(512)` 列。创建 HNSW 索引。

为已有奖章做一次性 backfill:遍历所有奖章,生成 embedding,批量写入。这是离线任务,不阻塞服务。

### 第三阶段:相似推荐重写

重写 `similarFeed`:用用户画像 embedding 作为查询向量,通过 pgvector ANN 查询找到 top-K 相似奖章,然后用 RRF 融合热度排名和时间排名。

核心 SQL 查询:

```sql
-- 语义排名:ANN 搜索 top 50
SELECT id, 1 - (embedding <=> $1) AS cosine_sim
FROM medals
WHERE visibility = 'public'
  AND user_id <> $2
ORDER BY embedding <=> $1
LIMIT 50;

-- 热度排名:同一批奖章按互动数排
-- 时间排名:同一批奖章按时间衰减排
-- 三路 RRF 融合,取 top pageSize
```

### 第四阶段:embedding 刷新管线

新增 asynq 任务 `medal.embedding_refresh`,奖章版本变更后异步刷新 embedding。新增画像 embedding,在画像刷新时更新。

### 第五阶段:评估与调优

这是最有研究价值的部分。搭建评估管线:

**离线评估**:构造 100 对奖章(人工标注语义相似度:相关/不相关),用 embedding 余弦相似度排序,计算 AUC 和 NDCG@10。与原子串匹配方案对比,量化提升幅度。

**参数调优**:在评估集上网格搜索 `ef_search`(40/60/80/100/150)和 RRF `k`(30/40/60)的组合,画出召回率-延迟帕累托前沿,选择帕累托最优参数。

**在线 A/B**:前端把 `similar` tab 的请求按用户 ID 哈希分流,50% 走旧逻辑(子串匹配),50% 走新逻辑(语义+RRF),比较点击率和停留时长。

## 技术学习要点

这个方向涉及的深度技术内容:

**ANN 算法原理**:HNSW 论文(Malkov & Yashunin, 2018)中的多层图构建算法、贪心搜索策略、ef 参数对召回率的影响。IVFFlat 的 k-means 聚类和倒排表结构。为什么 HNSW 在实际场景中通常优于 IVFFlat(图结构的增量更新能力)。

**Embedding 与 MRL**:Matryoshka Representation Learning 论文(Kusupati et al., 2022)中的嵌套向量结构,为什么前 N 维就包含足够信息,维度截断的理论上界和实际损失。OpenAI embedding 模型的训练方式和 MTEB 基准测试。

**混合排序理论**:RRF 论文(Cormack et al., 2009)中的排名融合公式推导,为什么 k=60 是常用值,RRF 与 CombSUM、CombMNZ 等其他融合方法的对比。Learning to Rank 的三种方法(pointwise/pairwise/listwise)以及为什么在数据量不足时不适合用。

**推荐系统冷启动**:新物品冷启动的经典策略(内容-based 兜底、探索-利用平衡),为什么时间衰减比固定 boost 更符合自然衰减直觉。

**PostgreSQL 向量索引优化**:`maintenance_work_mem` 对 HNSW 构建时间的影响,`hnsw.ef_search` 的 `SET LOCAL` 事务级设置,partial index 和 partition 在过滤查询中的应用。
