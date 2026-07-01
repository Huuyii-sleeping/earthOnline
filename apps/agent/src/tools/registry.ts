/**
 * Tool registry and built-in tools for the conversation agent.
 *
 * Tools are functions the LLM can call during a ReAct loop to fetch
 * contextual information about the user — existing medals, recent
 * experiences, growth profile, etc. This transforms the Agent from a
 * stateless chatbot into one that can reason about the user's history
 * before responding.
 *
 * Architecture:
 * - Each tool is a {definition, handler} pair registered in a ToolRegistry.
 * - The ReAct loop calls `registry.execute()` to run a tool by name.
 * - Tools receive a ToolContext (userId, sessionId) so they can query
 *   the Go API on behalf of the user.
 */

import type {
  ToolDefinition,
  ToolHandler,
  ToolContext,
  RegisteredTool,
  ToolCall,
} from "../providers/types.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.function.name, { definition, handler });
  }

  /** Get all registered tool definitions (for sending to the LLM). */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool call. Returns the result string (to be fed back to the LLM)
   * or an error message if the tool doesn't exist or fails.
   */
  async execute(call: ToolCall, context?: ToolContext): Promise<string> {
    const name = call.function.name;
    const tool = this.tools.get(name);

    if (!tool) {
      return JSON.stringify({ error: `Tool "${name}" not found` });
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "Invalid JSON arguments" });
    }

    try {
      return await tool.handler(args, context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Tool "${name}" failed: ${msg}` });
    }
  }

  /**
   * Execute multiple tool calls in parallel and return a map of
   * tool_call_id → result string.
   */
  async executeAll(calls: ToolCall[], context?: ToolContext): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const settled = await Promise.allSettled(calls.map((call) => this.execute(call, context)));
    settled.forEach((result, i) => {
      const callId = calls[i].id;
      if (result.status === "fulfilled") {
        results.set(callId, result.value);
      } else {
        results.set(
          callId,
          JSON.stringify({
            error: `Tool execution failed: ${result.reason}`,
          }),
        );
      }
    });
    return results;
  }
}

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

/**
 * The Go API base URL. Tools call the Go API (not the LLM API) to fetch
 * user data. In production this would be configured via env var.
 */
const API_BASE = process.env.AGENT_API_URL || "http://localhost:8080";

/**
 * Helper: call the Go API with the user's auth context.
 * Tools don't have the user's JWT, so they use an internal endpoint or
 * the userId directly. For now, we pass userId as a query param — the Go
 * API's internal tool endpoints accept this.
 */
async function fetchFromAPI(path: string, context?: ToolContext): Promise<string> {
  if (!context?.userId) {
    return JSON.stringify({ error: "No user context available" });
  }

  const url = `${API_BASE}${path}`;
  try {
    const resp = await fetch(url, {
      headers: { "X-Internal-User-Id": context.userId },
    });
    if (!resp.ok) {
      return JSON.stringify({
        error: `API returned ${resp.status}`,
      });
    }
    const text = await resp.text();
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: `API call failed: ${msg}` });
  }
}

/**
 * Query the user's recent medals. The LLM can use this to understand
 * what experiences the user has already recorded, avoid suggesting
 * duplicate topics, and provide more personalized follow-up questions.
 */
const queryUserMedals: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "query_user_medals",
      description:
        "查询用户最近获得的奖章列表。用于了解用户已经记录了哪些经历，避免重复提问，提供更有针对性的追问。返回奖章标题、授奖理由和记忆重量。",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "返回数量，默认5，最多20",
          },
        },
      },
    },
  },
  handler: async (args, context) => {
    const limit = Math.min((args.limit as number) ?? 5, 20);
    return fetchFromAPI(`/api/v1/agent/tools/medals?limit=${limit}`, context);
  },
};

/**
 * Query the user's growth profile. The LLM can use this to understand
 * the user's personality traits, growth keywords, and emotional trends,
 * enabling more empathetic and contextually relevant responses.
 */
const queryGrowthProfile: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "query_growth_profile",
      description:
        "查询用户的成长画像快照。包含人格特质关键词、成长关键词、经历类型分布、情绪趋势等。用于理解用户的整体成长脉络，提供更有深度的对话。",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  handler: async (_args, context) => {
    return fetchFromAPI("/api/v1/agent/tools/growth-profile", context);
  },
};

/**
 * Query the user's recent experiences. This gives the LLM visibility into
 * what the user has been doing recently, beyond just medals.
 */
const queryRecentExperiences: RegisteredTool = {
  definition: {
    type: "function",
    function: {
      name: "query_recent_experiences",
      description: "查询用户最近的经历记录。用于了解用户最近在关注什么，提供更有时效性的追问。",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "返回数量，默认3，最多10",
          },
        },
      },
    },
  },
  handler: async (args, context) => {
    const limit = Math.min((args.limit as number) ?? 3, 10);
    return fetchFromAPI(`/api/v1/agent/tools/experiences?limit=${limit}`, context);
  },
};

/**
 * Create the default tool registry with all built-in tools registered.
 * Callers can add more tools if needed.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(queryUserMedals.definition, queryUserMedals.handler);
  registry.register(queryGrowthProfile.definition, queryGrowthProfile.handler);
  registry.register(queryRecentExperiences.definition, queryRecentExperiences.handler);
  return registry;
}
