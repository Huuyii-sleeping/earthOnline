import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Award,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createExperience,
  createSession,
  sendMessageStream,
  generateSummary,
  type ConversationSummary,
} from "@/features/agent/conversationApi";
import {
  generateMedal as generateMedalApi,
  updateMedal as updateMedalApi,
} from "@/features/medals/medalApi";
import { useAgentRuntimeConfigStore } from "@/features/agent/runtimeConfig";
import type { Experience, Medal } from "@earth-online/shared";

type MedalVisibility = "public" | "friends" | "private";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const initialMessages: ChatMessage[] = [
  {
    id: "agent-welcome",
    role: "assistant",
    content: "今天最想被记住的是哪一件事？你可以先随便说，我会帮你抓重点。",
  },
];

const MarkdownMessage = lazy(() =>
  import("@/features/agent/MarkdownMessage").then((module) => ({
    default: module.MarkdownMessage,
  })),
);

function AssistantMarkdown({ content }: { content: string }) {
  if (!content) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Agent 正在思考...
      </span>
    );
  }

  return (
    <Suspense fallback={<span className="whitespace-pre-wrap">{content}</span>}>
      <MarkdownMessage content={content} />
    </Suspense>
  );
}

export default function CreateExperiencePage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isSending, setIsSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isGeneratingMedal, setIsGeneratingMedal] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedMedal, setGeneratedMedal] = useState<Medal | null>(null);
  const [medalVisibility, setMedalVisibility] = useState<MedalVisibility>("public");
  const [summary, setSummary] = useState<ConversationSummary | null>(null);

  // Backend state
  const [experience, setExperience] = useState<Experience | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const runtimeConfig = useAgentRuntimeConfigStore();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(runtimeConfig.apiUrl);
  const [apiKey, setApiKey] = useState(runtimeConfig.apiKey);
  const [model, setModel] = useState(runtimeConfig.model);
  const [systemPrompt, setSystemPrompt] = useState(runtimeConfig.systemPrompt);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const hasCompleteRuntimeConfig = Boolean(apiUrl.trim() && apiKey.trim() && model.trim());
  const canGenerateMedal = messages.some(
    (item) => item.role === "user" && item.content.trim().length > 0,
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isSending]);

  const handleApplyRuntimeConfig = () => {
    runtimeConfig.setConfig({ apiUrl, apiKey, model, systemPrompt });
    setError(null);
    setIsConfigOpen(false);
  };

  const handleClearRuntimeConfig = () => {
    runtimeConfig.clearConfig();
    setApiUrl("");
    setApiKey("");
    setModel("gpt-4o-mini");
    setSystemPrompt(runtimeConfig.systemPrompt);
    setError(null);
    setIsConfigOpen(true);
  };

  // Ensure we have an experience + session before sending messages
  const ensureExperienceAndSession = async (): Promise<string> => {
    if (sessionId) return sessionId;

    // Create experience
    const exp = await createExperience();
    setExperience(exp);

    // Create conversation session
    const session = await createSession(exp.id);
    setSessionId(session.id);

    return session.id;
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    const userContent = message.trim();
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userContent,
    };

    const assistantMessageId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);
    setMessage("");
    setError(null);
    setIsSending(true);
    setIsThinking(false);

    try {
      const currentSessionId = await ensureExperienceAndSession();

      // Stream the agent's reply token by token
      sendMessageStream(currentSessionId, userContent, {
        onThinking: () => {
          setIsThinking(true);
        },
        onToken: (token) => {
          setIsThinking(false);
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId ? { ...item, content: item.content + token } : item,
            ),
          );
        },
        onDone: (data) => {
          setMessages((prev) =>
            prev.map((item) => {
              if (item.id === userMessage.id) {
                return { ...item, id: data.userMessageId || userMessage.id };
              }
              if (item.id === assistantMessageId) {
                return { ...item, id: data.agentMessageId || assistantMessageId };
              }
              return item;
            }),
          );
          setIsSending(false);
          setIsThinking(false);
        },
        onError: (err) => {
          const errorMessage = err instanceof Error ? err.message : "发送消息失败";
          setError(errorMessage);
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId
                ? { ...item, content: "抱歉，我暂时无法回复，请稍后再试。" }
                : item,
            ),
          );
          setIsSending(false);
          setIsThinking(false);
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "发送消息失败";
      setError(errorMessage);

      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? { ...item, content: "抱歉，我暂时无法回复，请稍后再试。" }
            : item,
        ),
      );
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleGenerateSummary = async () => {
    if (!sessionId || isGeneratingSummary) return;

    setError(null);
    setIsGeneratingSummary(true);

    try {
      const result = await generateSummary(sessionId);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? `总结生成失败：${err.message}` : "总结生成失败");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGenerateMedal = async () => {
    if (!canGenerateMedal || isGeneratingMedal) return;
    if (!experience || !sessionId) return;

    setError(null);
    setIsGeneratingMedal(true);

    try {
      // Call Go API → Agent service to generate and persist the medal
      const medal = await generateMedalApi(experience.id, sessionId);
      setGeneratedMedal(medal);
      setMedalVisibility(medal.visibility as MedalVisibility);
    } catch (err) {
      setError(err instanceof Error ? `奖章生成失败：${err.message}` : "奖章生成失败，请稍后再试");
    } finally {
      setIsGeneratingMedal(false);
    }
  };

  const handleVisibilityChange = (visibility: MedalVisibility) => {
    setMedalVisibility(visibility);
  };

  const handleSaveMedal = async () => {
    if (!generatedMedal) return;

    // If user changed visibility, update it via API
    if (medalVisibility !== generatedMedal.visibility) {
      try {
        await updateMedalApi(generatedMedal.id, {
          visibility: medalVisibility,
        });
      } catch {
        // Non-fatal: navigate to medal detail anyway
      }
    }

    navigate(`/medals/${generatedMedal.id}`);
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col">
      {/* 顶部标题 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--glass-border)] pb-3 sm:gap-3 sm:pb-4">
        <MessageSquare className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold sm:text-xl">记录今天的经历</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {experience
              ? `经历 ID：${experience.id.slice(0, 8)}... · 状态：${experience.status}`
              : "开始记录，Agent 会帮你把经历整理成奖章"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setIsConfigOpen((current) => !current)}
        >
          <SlidersHorizontal className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">奖章生成配置</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform sm:ml-2 ${isConfigOpen ? "rotate-180" : ""}`}
          />
        </Button>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/settings/agent">
            <Settings className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Agent API</span>
          </Link>
        </Button>
      </div>

      {/* Runtime config panel (for medal generation LLM) */}
      {isConfigOpen && (
        <div className="glass-card mt-4 p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">奖章生成 LLM 配置（可选）</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                对话由后端 Agent 服务处理。此配置仅用于奖章生成阶段的 LLM 调用，会保存到
                localStorage。
              </p>
            </div>
            <span
              className={`glass-subtle rounded-full px-2.5 py-1 text-xs ${
                runtimeConfig.isConfigured ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {runtimeConfig.isConfigured ? "已配置" : "未配置"}
            </span>
          </div>

          <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <Label htmlFor="create-agent-api-url">API URL</Label>
              <Input
                id="create-agent-api-url"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-agent-api-key">API Key</Label>
              <Input
                id="create-agent-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="会保存到当前浏览器本机存储"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="create-agent-model">模型</Label>
              <Input
                id="create-agent-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="create-agent-system-prompt">系统提示词</Label>
              <textarea
                id="create-agent-system-prompt"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                className="min-h-20 w-full rounded-lg px-3 py-2 text-sm leading-6 transition-all bg-[var(--glass-bg)] backdrop-blur-md border border-[var(--glass-border)] text-foreground placeholder:text-muted-foreground shadow-[var(--shadow-glass)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <Button
                type="button"
                onClick={handleApplyRuntimeConfig}
                disabled={!hasCompleteRuntimeConfig}
              >
                保存并应用
              </Button>
              <Button type="button" variant="outline" onClick={handleClearRuntimeConfig}>
                清空本机配置
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 消息列表区域 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4">
        {messages.map((item) => (
          <div
            key={item.id}
            className={
              item.role === "user"
                ? "ml-auto max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6 glass-strong"
                : "mr-auto max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6 glass"
            }
          >
            {item.role === "assistant" ? (
              <AssistantMarkdown content={item.content} />
            ) : (
              <span className="whitespace-pre-wrap">{item.content}</span>
            )}
          </div>
        ))}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Agent thinking indicator — shown while tools are executing */}
        {isThinking && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>正在查阅你的记录...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 生成前总结 */}
      {summary && (
        <div className="glass-card mb-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">经历总结</h3>
            {summary.readyToGenerate && (
              <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-primary">
                可以生成奖章
              </span>
            )}
          </div>
          <p className="text-sm leading-6">{summary.experienceSummary}</p>
          {summary.keyMoments?.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">关键情节：</span>
              {summary.keyMoments.map((moment, i) => (
                <span key={i} className="ml-2 glass-subtle rounded-full px-2 py-0.5 text-xs">
                  {moment}
                </span>
              ))}
            </div>
          )}
          {summary.detectedEmotions?.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">情绪：</span>
              {summary.detectedEmotions.map((emotion, i) => (
                <span key={i} className="ml-2 glass-subtle rounded-full px-2 py-0.5 text-xs">
                  {emotion}
                </span>
              ))}
            </div>
          )}
          {summary.possibleMeaning && (
            <p className="mt-2 text-xs text-muted-foreground">{summary.possibleMeaning}</p>
          )}
        </div>
      )}

      {/* 奖章预览 */}
      {generatedMedal && (
        <div className="glass-card mb-4 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-1 gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[var(--glass-border)] text-primary"
                style={{ background: "var(--glass-bg)" }}
              >
                <Award className="h-8 w-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{generatedMedal.title}</h2>
                  <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-muted-foreground">
                    Agent 生成
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {generatedMedal.short_reason}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="glass-subtle rounded-full px-2 py-0.5 text-xs">
                    {generatedMedal.memory_weight}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:w-56">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={medalVisibility === "public" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleVisibilityChange("public")}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  公开
                </Button>
                <Button
                  type="button"
                  variant={medalVisibility === "private" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleVisibilityChange("private")}
                >
                  <EyeOff className="mr-2 h-4 w-4" />
                  私密
                </Button>
              </div>
              <Button type="button" onClick={handleSaveMedal}>
                保存奖章
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateMedal}
                disabled={isGeneratingMedal}
              >
                {isGeneratingMedal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                重新生成
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 底部输入区域 */}
      <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3 sm:flex-row sm:items-center sm:gap-3 sm:pt-4">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你今天的经历..."
          className="flex-1"
          disabled={isSending || isGeneratingMedal}
        />
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {sessionId && (
            <Button
              onClick={handleGenerateSummary}
              disabled={isSending || isGeneratingSummary || isGeneratingMedal}
              variant="outline"
              className="shrink-0"
            >
              {isGeneratingSummary ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              <span className="hidden sm:inline">生成总结</span>
              <span className="sm:hidden">总结</span>
            </Button>
          )}
          <Button
            onClick={handleGenerateMedal}
            disabled={!canGenerateMedal || isSending || isGeneratingMedal}
            variant="outline"
            className="shrink-0"
          >
            {isGeneratingMedal ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Award className="mr-2 h-4 w-4" />
            )}
            <span className="hidden sm:inline">生成奖章</span>
            <span className="sm:hidden">奖章</span>
          </Button>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isSending || isGeneratingMedal}
            aria-label="发送经历"
            className="shrink-0"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
