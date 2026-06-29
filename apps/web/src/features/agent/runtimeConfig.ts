import { create } from "zustand";

export interface AgentRuntimeConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

interface AgentRuntimeConfigState extends AgentRuntimeConfig {
  isConfigured: boolean;
  isPersisted: boolean;
  setConfig: (config: AgentRuntimeConfig) => void;
  clearConfig: () => void;
}

export const DEFAULT_AGENT_SYSTEM_PROMPT =
  "你是经历成就官的 Agent。你会用专业采访加轻陪伴的方式，帮助用户讲清楚真实经历，并追问这段经历中最值得被记住的行动、情绪和意义。";

const initialConfig: AgentRuntimeConfig = {
  apiUrl: "",
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
};

const STORAGE_KEY = "earth_online_agent_runtime_config";

interface PersistedAgentRuntimeConfig extends AgentRuntimeConfig {
  version: 1;
}

function normalizeConfig(config: AgentRuntimeConfig): AgentRuntimeConfig {
  return {
    apiUrl: config.apiUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    systemPrompt: config.systemPrompt.trim() || DEFAULT_AGENT_SYSTEM_PROMPT,
  };
}

function isConfigComplete(config: AgentRuntimeConfig) {
  return Boolean(config.apiUrl && config.apiKey && config.model);
}

function readPersistedConfig(): AgentRuntimeConfig | null {
  if (typeof window === "undefined") return null;

  try {
    const rawConfig = window.localStorage.getItem(STORAGE_KEY);
    if (!rawConfig) return null;

    const parsedConfig = JSON.parse(rawConfig) as Partial<PersistedAgentRuntimeConfig>;
    if (parsedConfig.version !== 1) return null;
    if (
      typeof parsedConfig.apiUrl !== "string" ||
      typeof parsedConfig.apiKey !== "string" ||
      typeof parsedConfig.model !== "string" ||
      typeof parsedConfig.systemPrompt !== "string"
    ) {
      return null;
    }

    return normalizeConfig({
      apiUrl: parsedConfig.apiUrl,
      apiKey: parsedConfig.apiKey,
      model: parsedConfig.model,
      systemPrompt: parsedConfig.systemPrompt,
    });
  } catch {
    return null;
  }
}

function writePersistedConfig(config: AgentRuntimeConfig) {
  if (typeof window === "undefined") return;

  const persistedConfig: PersistedAgentRuntimeConfig = {
    version: 1,
    ...config,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedConfig));
}

function removePersistedConfig() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

const persistedConfig = readPersistedConfig();
const bootConfig = persistedConfig ?? initialConfig;

export const useAgentRuntimeConfigStore = create<AgentRuntimeConfigState>((set) => ({
  ...bootConfig,
  isConfigured: isConfigComplete(bootConfig),
  isPersisted: Boolean(persistedConfig),
  setConfig: (config) => {
    const nextConfig = normalizeConfig(config);
    writePersistedConfig(nextConfig);

    set({
      ...nextConfig,
      isConfigured: isConfigComplete(nextConfig),
      isPersisted: true,
    });
  },
  clearConfig: () => {
    removePersistedConfig();
    set({
      ...initialConfig,
      isConfigured: false,
      isPersisted: false,
    });
  },
}));
