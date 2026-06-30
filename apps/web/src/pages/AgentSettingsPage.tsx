import { useState } from "react";
import { Bot, Loader2, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  useAgentRuntimeConfigStore,
} from "@/features/agent/runtimeConfig";
import { getAgentProfile, updateAgentProfile } from "@/features/stage/stageApi";

export default function AgentSettingsPage() {
  const queryClient = useQueryClient();
  const runtimeConfig = useAgentRuntimeConfigStore();
  const [apiUrl, setApiUrl] = useState(runtimeConfig.apiUrl);
  const [apiKey, setApiKey] = useState(runtimeConfig.apiKey);
  const [model, setModel] = useState(runtimeConfig.model);
  const [systemPrompt, setSystemPrompt] = useState(runtimeConfig.systemPrompt);
  const [saved, setSaved] = useState(runtimeConfig.isPersisted);
  const [profileSaved, setProfileSaved] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["agent-profile"],
    queryFn: getAgentProfile,
  });

  const profileMutation = useMutation({
    mutationFn: updateAgentProfile,
    onSuccess: (profile) => {
      queryClient.setQueryData(["agent-profile"], profile);
      setProfileSaved(true);
    },
  });

  const profile = profileQuery.data;

  const handleSaveAgentProfile = (formData: FormData) => {
    setProfileSaved(false);
    profileMutation.mutate({
      name: String(formData.get("name") ?? "").trim(),
      personality: String(formData.get("personality") ?? "").trim(),
      dialogue_style: String(formData.get("dialogue_style") ?? "").trim(),
      identity_prompt: String(formData.get("identity_prompt") ?? "").trim(),
      avatar_url: String(formData.get("avatar_url") ?? "").trim(),
      proactive_level: Number(formData.get("proactive_level") ?? 1),
    });
  };

  const handleSaveRuntimeConfig = () => {
    runtimeConfig.setConfig({
      apiUrl,
      apiKey,
      model,
      systemPrompt,
    });
    setSaved(true);
  };

  const handleClearRuntimeConfig = () => {
    runtimeConfig.clearConfig();
    setApiUrl("");
    setApiKey("");
    setModel("gpt-4o-mini");
    setSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT);
    setSaved(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold">Agent 设置</h1>
      </div>

      {/* 设置表单 */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">主动设置</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            这些配置会保存到后端，用于阶段回顾、主动提醒和后续对话个性化。
          </p>
        </div>

        {profileQuery.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载 Agent 设置
          </div>
        ) : profileQuery.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Agent 设置加载失败，请稍后重试。
          </div>
        ) : (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveAgentProfile(new FormData(e.currentTarget));
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent 名称</Label>
              <Input
                id="agent-name"
                name="name"
                defaultValue={profile?.name ?? "My Agent"}
                placeholder="给你的 Agent 取个名字"
                onChange={() => setProfileSaved(false)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-personality">性格</Label>
              <Input
                id="agent-personality"
                name="personality"
                defaultValue={profile?.personality ?? ""}
                placeholder="例如：温和、鼓励型、幽默"
                onChange={() => setProfileSaved(false)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-style">对话风格</Label>
              <Input
                id="agent-style"
                name="dialogue_style"
                defaultValue={profile?.dialogue_style ?? ""}
                placeholder="例如：简洁、详细、引导式"
                onChange={() => setProfileSaved(false)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-identity">身份提示</Label>
              <textarea
                id="agent-identity"
                name="identity_prompt"
                defaultValue={profile?.identity_prompt ?? ""}
                placeholder="描述这个 Agent 应该如何理解你、陪伴你、主动提醒你"
                onChange={() => setProfileSaved(false)}
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-avatar">头像 URL</Label>
              <Input
                id="agent-avatar"
                name="avatar_url"
                defaultValue={profile?.avatar_url ?? ""}
                placeholder="可选：Agent 头像图片地址"
                onChange={() => setProfileSaved(false)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proactive-level">主动程度</Label>
              <select
                id="proactive-level"
                name="proactive_level"
                defaultValue={profile?.proactive_level ?? 1}
                onChange={() => setProfileSaved(false)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value={0}>关闭主动提醒</option>
                <option value={1}>克制：仅 App 内提醒</option>
                <option value={2}>积极：允许更主动的站内提醒</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={profileMutation.isPending}>
                {profileMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                保存设置
              </Button>
              <span className="text-sm text-muted-foreground">
                {profileMutation.error
                  ? "保存失败，请检查输入后重试"
                  : profileSaved
                    ? "已保存到后端"
                    : "修改后保存才会生效"}
              </span>
            </div>
          </form>
        )}
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">运行时 Agent API</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            仅用于本地前端测试。API Key 和 URL 会保存到当前浏览器的
            localStorage；不要在公共电脑保存真实 API Key，生产环境应改为服务端托管。
          </p>
        </div>

        <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <Label htmlFor="agent-api-url">API URL</Label>
            <Input
              id="agent-api-url"
              value={apiUrl}
              onChange={(event) => {
                setApiUrl(event.target.value);
                setSaved(false);
              }}
              placeholder="例如：https://api.openai.com/v1 或 http://localhost:8787/v1"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              支持 OpenAI-compatible Chat Completions。可以填 `/v1` 基础地址，系统会自动补
              `/chat/completions`。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-api-key">API Key</Label>
            <Input
              id="agent-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setSaved(false);
              }}
              placeholder="会保存到当前浏览器本机存储"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-model">模型</Label>
            <Input
              id="agent-model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setSaved(false);
              }}
              placeholder="例如：gpt-4o-mini"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-system-prompt">系统提示词</Label>
            <textarea
              id="agent-system-prompt"
              value={systemPrompt}
              onChange={(event) => {
                setSystemPrompt(event.target.value);
                setSaved(false);
              }}
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleSaveRuntimeConfig}>
              保存并应用
            </Button>
            <Button type="button" variant="outline" onClick={handleClearRuntimeConfig}>
              清空本机配置
            </Button>
            <span className="text-sm text-muted-foreground">
              {runtimeConfig.isConfigured
                ? saved
                  ? "已保存到当前浏览器"
                  : "当前配置有修改，保存后生效"
                : "未配置时创建经历页会使用本地 mock Agent"}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
