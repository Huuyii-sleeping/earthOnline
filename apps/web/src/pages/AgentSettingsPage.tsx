import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  useAgentRuntimeConfigStore,
} from "@/features/agent/runtimeConfig";

export default function AgentSettingsPage() {
  const runtimeConfig = useAgentRuntimeConfigStore();
  const [apiUrl, setApiUrl] = useState(runtimeConfig.apiUrl);
  const [apiKey, setApiKey] = useState(runtimeConfig.apiKey);
  const [model, setModel] = useState(runtimeConfig.model);
  const [systemPrompt, setSystemPrompt] = useState(runtimeConfig.systemPrompt);
  const [saved, setSaved] = useState(runtimeConfig.isPersisted);

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
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent 名称</Label>
            <Input id="agent-name" placeholder="给你的 Agent 取个名字" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-personality">性格</Label>
            <Input id="agent-personality" placeholder="例如：温和、鼓励型、幽默" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-style">对话风格</Label>
            <Input id="agent-style" placeholder="例如：简洁、详细、引导式" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-greeting">开场白</Label>
            <Input id="agent-greeting" placeholder="Agent 每次对话的开场白" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-language">语言偏好</Label>
            <Input id="agent-language" placeholder="例如：中文、English" />
          </div>

          <Button type="submit">保存设置</Button>
        </form>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">运行时 Agent API</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            仅用于本地前端测试。API Key 和 URL 会保存到当前浏览器的 localStorage；不要在公共电脑保存真实
            API Key，生产环境应改为服务端托管。
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
