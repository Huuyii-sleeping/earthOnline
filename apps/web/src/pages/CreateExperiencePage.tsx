import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Award,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMockAgentReply,
  streamAgentMessage,
  type AgentChatMessage,
} from "@/features/agent/agentClient";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  useAgentRuntimeConfigStore,
} from "@/features/agent/runtimeConfig";
import { createMockMedalDraft, generateMedalDraftWithAgent } from "@/features/medals/medalGenerator";
import {
  type MedalDraft,
  type MedalVisibility,
  useMedalStore,
} from "@/features/medals/medalStore";

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
    return <span className="text-muted-foreground">Agent 正在输入...</span>;
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
  const [isGeneratingMedal, setIsGeneratingMedal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medalDraft, setMedalDraft] = useState<MedalDraft | null>(null);
  const runtimeConfig = useAgentRuntimeConfigStore();
  const addMedal = useMedalStore((state) => state.addMedal);
  const [isConfigOpen, setIsConfigOpen] = useState(!runtimeConfig.isConfigured);
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

  const runtimeApiLabel = (() => {
    if (!runtimeConfig.isConfigured) return null;

    try {
      return new URL(runtimeConfig.apiUrl).host;
    } catch {
      return runtimeConfig.apiUrl;
    }
  })();

  const handleApplyRuntimeConfig = () => {
    runtimeConfig.setConfig({
      apiUrl,
      apiKey,
      model,
      systemPrompt,
    });
    setError(null);
    setIsConfigOpen(false);
  };

  const handleClearRuntimeConfig = () => {
    runtimeConfig.clearConfig();
    setApiUrl("");
    setApiKey("");
    setModel("gpt-4o-mini");
    setSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT);
    setError(null);
    setIsConfigOpen(true);
  };

  const appendAssistantToken = (messageId: string, token: string) => {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, content: `${item.content}${token}` } : item,
      ),
    );
  };

  const replaceAssistantMessage = (messageId: string, content: string) => {
    setMessages((current) =>
      current.map((item) => (item.id === messageId ? { ...item, content } : item)),
    );
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    const userContent = message.trim();
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userContent,
    };

    const nextMessages = [...messages, userMessage];
    const assistantMessageId = `assistant-${Date.now()}`;

    setMessages(
      runtimeConfig.isConfigured
        ? [
            ...nextMessages,
            {
              id: assistantMessageId,
              role: "assistant",
              content: "",
            },
          ]
        : nextMessages,
    );
    setMessage("");
    setError(null);
    setIsSending(true);
    let receivedStreamContent = false;

    try {
      if (runtimeConfig.isConfigured) {
        await streamAgentMessage(
          runtimeConfig,
          nextMessages.map<AgentChatMessage>((item) => ({
            role: item.role,
            content: item.content,
          })),
          (token) => {
            receivedStreamContent = true;
            appendAssistantToken(assistantMessageId, token);
          },
        );
      } else {
        const reply = createMockAgentReply(userContent, nextMessages.length);

        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: reply,
          },
        ]);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Agent 调用失败，请检查 API URL、Key 或跨域设置";
      setError(errorMessage);

      if (runtimeConfig.isConfigured && !receivedStreamContent) {
        replaceAssistantMessage(
          assistantMessageId,
          "我暂时没有连上你配置的 Agent API。你可以检查运行时配置，或者清空配置继续用本地 mock 测试。",
        );
      } else if (!runtimeConfig.isConfigured) {
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content:
              "我暂时没有连上你配置的 Agent API。你可以检查运行时配置，或者清空配置继续用本地 mock 测试。",
          },
        ]);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleGenerateMedal = async () => {
    if (!canGenerateMedal || isGeneratingMedal) return;

    setError(null);
    setIsGeneratingMedal(true);

    const transcriptMessages = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    try {
      const draft = runtimeConfig.isConfigured
        ? await generateMedalDraftWithAgent(runtimeConfig, transcriptMessages)
        : createMockMedalDraft(transcriptMessages);

      setMedalDraft(draft);
    } catch (err) {
      const fallbackDraft = createMockMedalDraft(transcriptMessages);
      setMedalDraft(fallbackDraft);
      setError(
        err instanceof Error
          ? `Agent 奖章生成失败，已用本地规则生成预览：${err.message}`
          : "Agent 奖章生成失败，已用本地规则生成预览",
      );
    } finally {
      setIsGeneratingMedal(false);
    }
  };

  const handleVisibilityChange = (visibility: MedalVisibility) => {
    setMedalDraft((current) => (current ? { ...current, visibility } : current));
  };

  const handleSaveMedal = () => {
    if (!medalDraft) return;
    const savedMedal = addMedal(medalDraft);
    navigate(`/medals/${savedMedal.id}`);
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col">
      {/* 顶部标题 */}
      <div className="flex items-center gap-3 border-b pb-4">
        <MessageSquare className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">记录今天的经历</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {runtimeConfig.isConfigured
              ? `正在使用真实 API：${runtimeConfig.model} · ${runtimeApiLabel}${
                  runtimeConfig.isPersisted ? " · 已保存到本机" : ""
                }`
              : "未配置 API，当前使用本地 mock Agent"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsConfigOpen((current) => !current)}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          本页配置
          <ChevronDown
            className={`ml-2 h-4 w-4 transition-transform ${isConfigOpen ? "rotate-180" : ""}`}
          />
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/agent">
            <Settings className="mr-2 h-4 w-4" />
            Agent API
          </Link>
        </Button>
      </div>

      {isConfigOpen && (
        <div className="mt-4 rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">运行时 Agent API</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                配置会保存到当前浏览器的 localStorage，用于本机开发测试；生产环境应改为服务端托管
                API Key。
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                runtimeConfig.isConfigured
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {runtimeConfig.isConfigured
                ? runtimeConfig.isPersisted
                  ? "真实 API 已保存"
                  : "真实 API 已启用"
                : "当前是 mock"}
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
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              <span className="text-xs leading-5 text-muted-foreground">
                不要在公共电脑保存真实 API Key；如果调用失败，请看下方错误提示。
              </span>
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
                ? "ml-auto max-w-[82%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground"
                : "mr-auto max-w-[82%] rounded-lg border bg-card px-4 py-3 text-sm leading-6 shadow-sm"
            }
          >
            {item.role === "assistant" ? (
              <AssistantMarkdown content={item.content} />
            ) : (
              <span className="whitespace-pre-wrap">{item.content}</span>
            )}
          </div>
        ))}

        {isSending && !runtimeConfig.isConfigured && (
          <div className="mr-auto max-w-[82%] rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            Agent 正在思考...
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {medalDraft && (
        <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-1 gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border bg-amber-100 text-amber-800">
                <Award className="h-8 w-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{medalDraft.title}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {medalDraft.source === "agent" ? "Agent 生成" : "本地生成"}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{medalDraft.summary}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{medalDraft.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {medalDraft.tags.map((tag) => (
                    <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:w-56">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={medalDraft.visibility === "public" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleVisibilityChange("public")}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  公开
                </Button>
                <Button
                  type="button"
                  variant={medalDraft.visibility === "private" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleVisibilityChange("private")}
                >
                  <EyeOff className="mr-2 h-4 w-4" />
                  私密
                </Button>
              </div>
              <Button type="button" onClick={handleSaveMedal}>
                <Save className="mr-2 h-4 w-4" />
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
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你今天的经历..."
          className="flex-1"
          disabled={isSending || isGeneratingMedal}
        />
        <div className="flex gap-2">
          <Button
            onClick={handleGenerateMedal}
            disabled={!canGenerateMedal || isSending || isGeneratingMedal}
            variant="outline"
          >
            {isGeneratingMedal ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Award className="mr-2 h-4 w-4" />
            )}
            生成奖章
          </Button>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isSending || isGeneratingMedal}
            aria-label="发送经历"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
