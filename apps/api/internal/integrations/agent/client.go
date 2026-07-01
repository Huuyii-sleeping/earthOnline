package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Client calls the TypeScript Agent service.
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewClient(baseURL string, logger *slog.Logger) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
		logger: logger,
	}
}

// SendMessageRequest is the payload sent to the Agent service.
type SendMessageRequest struct {
	SessionID    string                 `json:"session_id"`
	Content      string                 `json:"content"`
	Context      map[string]interface{} `json:"context,omitempty"`
	AgentRuntime *AgentRuntimePayload   `json:"agent_runtime,omitempty"`
	// UserID is passed so the Agent can use it as tool context — tools
	// call back to the Go API to fetch user-specific data (medals, etc.).
	UserID string `json:"user_id,omitempty"`
	// SummaryText is the compressed conversation summary (for context window management).
	SummaryText string `json:"summary_text,omitempty"`
	// ConversationState is the current state machine phase (INTAKE/PROBE/REFLECT/READY).
	ConversationState string `json:"conversation_state,omitempty"`
}

// AgentRuntimePayload carries browser-side LLM credentials so the Agent
// service can call the LLM without a server-side API key.
type AgentRuntimePayload struct {
	APIURL       string `json:"api_url"`
	APIKey       string `json:"api_key"`
	Model        string `json:"model"`
	SystemPrompt string `json:"system_prompt"`
}

// SendMessageResponse is what the Agent service returns for a non-streaming message.
type SendMessageResponse struct {
	Reply               string   `json:"reply"`
	Done                bool     `json:"done"`
	ConversationState   string   `json:"conversation_state,omitempty"`
	TurnCount           int      `json:"turn_count,omitempty"`
	ProbeCount          int      `json:"probe_count,omitempty"`
	CollectedDimensions []string `json:"collected_dimensions,omitempty"`
}

// SendMessage sends a user message to the Agent and gets a reply.
func (c *Client) SendMessage(ctx context.Context, req *SendMessageRequest) (*SendMessageResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/sessions/" + req.SessionID + "/messages"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result SendMessageResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// SendMessageStream sends a user message to the Agent and returns an SSE stream
// of tokens. The caller is responsible for closing the returned ReadCloser.
func (c *Client) SendMessageStream(ctx context.Context, req *SendMessageRequest) (io.ReadCloser, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/sessions/" + req.SessionID + "/messages/stream"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create stream request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent stream: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("agent stream returned status %d: %s", resp.StatusCode, string(raw))
	}

	return resp.Body, nil
}

// StreamSession opens an SSE connection to the Agent service and returns the raw response body
// for the Go API to proxy through to the frontend.
func (c *Client) StreamSession(ctx context.Context, sessionID string) (io.ReadCloser, error) {
	url := c.baseURL + "/sessions/" + sessionID + "/stream"
	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create stream request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent stream: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("agent stream returned status %d: %s", resp.StatusCode, string(raw))
	}

	return resp.Body, nil
}

// GenerateMedalRequest is the payload sent to the Agent for medal generation.
type GenerateMedalRequest struct {
	SessionID    string               `json:"session_id"`
	Experience   string               `json:"experience,omitempty"`
	History      []HistoryItem        `json:"history,omitempty"`
	Direction    string               `json:"direction,omitempty"`
	UserInput    string               `json:"user_input,omitempty"`
	AgentRuntime *AgentRuntimePayload `json:"agent_runtime,omitempty"`
}

type HistoryItem struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// GenerateMedalResponse is what the Agent returns after generating a medal.
type GenerateMedalResponse struct {
	Title        string `json:"title"`
	ShortReason  string `json:"shortReason"`
	MemoryWeight string `json:"memoryWeight"`
	MeaningFocus string `json:"meaningFocus"`
	Story        string `json:"story"`
}

// GenerateMedal asks the Agent to generate a medal from conversation history.
func (c *Client) GenerateMedal(ctx context.Context, req *GenerateMedalRequest) (*GenerateMedalResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/medals/generate"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent medal generation returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result GenerateMedalResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode medal response: %w", err)
	}

	return &result, nil
}

// RegenerateMeaning asks the Agent to regenerate the meaning focus of a medal.
func (c *Client) RegenerateMeaning(ctx context.Context, req *GenerateMedalRequest) (*GenerateMedalResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/medals/regenerate-meaning"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent meaning regeneration returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result GenerateMedalResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// GenerateSummary asks the Agent to produce a pre-generation summary of the conversation.
func (c *Client) GenerateSummary(ctx context.Context, sessionID string, history []HistoryItem, runtime *AgentRuntimePayload) (json.RawMessage, error) {
	payload := map[string]interface{}{
		"history": history,
	}
	if runtime != nil {
		payload["agent_runtime"] = runtime
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal summary request: %w", err)
	}

	url := c.baseURL + "/sessions/" + sessionID + "/summary"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create summary request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent summary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent summary returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode summary response: %w", err)
	}

	return result, nil
}

// StageExperienceItem is one experience fed into a stage summary.
type StageExperienceItem struct {
	Title      string `json:"title,omitempty"`
	Summary    string `json:"summary,omitempty"`
	OccurredAt string `json:"occurredAt,omitempty"`
}

// GenerateStageSummaryRequest is the payload sent to the Agent's stage endpoint.
type GenerateStageSummaryRequest struct {
	PeriodLabel  string                `json:"period_label"`
	Experiences  []StageExperienceItem `json:"experiences"`
	AgentRuntime *AgentRuntimePayload  `json:"agent_runtime,omitempty"`
}

// GenerateStageSummaryResponse is what the Agent returns for a stage roll-up.
type GenerateStageSummaryResponse struct {
	Title        string   `json:"title"`
	Summary      string   `json:"summary"`
	MemoryWeight string   `json:"memoryWeight"`
	Story        string   `json:"story"`
	Highlights   []string `json:"highlights"`
}

// GenerateStageSummary asks the Agent to roll up a window of experiences into a
// stage summary and stage medal.
func (c *Client) GenerateStageSummary(ctx context.Context, req *GenerateStageSummaryRequest) (*GenerateStageSummaryResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/stage/summary"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent stage summary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent stage summary returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result GenerateStageSummaryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode stage summary response: %w", err)
	}

	return &result, nil
}

// GrowthMedalItem is a medal signal fed into growth profile extraction.
type GrowthMedalItem struct {
	ID           string `json:"id,omitempty"`
	Title        string `json:"title,omitempty"`
	ShortReason  string `json:"shortReason,omitempty"`
	MeaningFocus string `json:"meaningFocus,omitempty"`
	Story        string `json:"story,omitempty"`
	MemoryWeight string `json:"memoryWeight,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
	ExperienceID string `json:"experienceId,omitempty"`
	Experience   string `json:"experience,omitempty"`
	ExperienceAt string `json:"experienceAt,omitempty"`
}

// GrowthStageSummaryItem is a stage-summary signal fed into growth profile extraction.
type GrowthStageSummaryItem struct {
	ID           string   `json:"id,omitempty"`
	PeriodType   string   `json:"periodType,omitempty"`
	PeriodStart  string   `json:"periodStart,omitempty"`
	PeriodEnd    string   `json:"periodEnd,omitempty"`
	Title        string   `json:"title,omitempty"`
	Summary      string   `json:"summary,omitempty"`
	Story        string   `json:"story,omitempty"`
	MemoryWeight string   `json:"memoryWeight,omitempty"`
	Highlights   []string `json:"highlights,omitempty"`
}

// GenerateGrowthProfileRequest is the payload for Agent growth-profile extraction.
type GenerateGrowthProfileRequest struct {
	Medals         []GrowthMedalItem        `json:"medals"`
	StageSummaries []GrowthStageSummaryItem `json:"stageSummaries"`
	AgentRuntime   *AgentRuntimePayload     `json:"agent_runtime,omitempty"`
}

type GrowthExperienceType struct {
	Type   string  `json:"type"`
	Weight float64 `json:"weight"`
}

type GrowthEmotionTrend struct {
	Label   string `json:"label"`
	Summary string `json:"summary"`
}

type GrowthInsightItem struct {
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Keywords []string `json:"keywords"`
}

type GrowthEvidence struct {
	MedalIDs        []string `json:"medalIds"`
	StageSummaryIDs []string `json:"stageSummaryIds"`
	ExperienceIDs   []string `json:"experienceIds"`
}

// GenerateGrowthProfileResponse is the structured profile returned by Agent.
type GenerateGrowthProfileResponse struct {
	Summary         string                 `json:"summary"`
	TraitKeywords   []string               `json:"traitKeywords"`
	GrowthKeywords  []string               `json:"growthKeywords"`
	ExperienceTypes []GrowthExperienceType `json:"experienceTypes"`
	EmotionTrends   []GrowthEmotionTrend   `json:"emotionTrends"`
	Insights        []GrowthInsightItem    `json:"insights"`
	Evidence        GrowthEvidence         `json:"evidence"`
}

// GenerateGrowthProfile asks the Agent to extract a long-term growth profile.
func (c *Client) GenerateGrowthProfile(ctx context.Context, req *GenerateGrowthProfileRequest) (*GenerateGrowthProfileResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/growth/profile"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent growth profile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent growth profile returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result GenerateGrowthProfileResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode growth profile response: %w", err)
	}

	return &result, nil
}

// --- Year review ---

// YearMedalItem is a medal signal fed into year review generation.
type YearMedalItem struct {
	ID           string `json:"id,omitempty"`
	Title        string `json:"title,omitempty"`
	ShortReason  string `json:"shortReason,omitempty"`
	MemoryWeight string `json:"memoryWeight,omitempty"`
	Story        string `json:"story,omitempty"`
	MeaningFocus string `json:"meaningFocus,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
}

// YearStageItem is a stage-summary signal fed into year review generation.
type YearStageItem struct {
	PeriodType  string   `json:"periodType,omitempty"`
	PeriodStart string   `json:"periodStart,omitempty"`
	Title       string   `json:"title,omitempty"`
	Summary     string   `json:"summary,omitempty"`
	Story       string   `json:"story,omitempty"`
	Highlights  []string `json:"highlights,omitempty"`
}

// GrowthProfileSnapshot is a trimmed view of the growth profile for year
// review input. May be nil for users without a profile.
type GrowthProfileSnapshot struct {
	TraitKeywords  []string `json:"traitKeywords,omitempty"`
	GrowthKeywords []string `json:"growthKeywords,omitempty"`
	SummaryText    string   `json:"summaryText,omitempty"`
}

// YearReviewStats holds aggregate counts for the year.
type YearReviewStats struct {
	MedalCount        int `json:"medalCount"`
	ExperienceCount   int `json:"experienceCount"`
	StageSummaryCount int `json:"stageSummaryCount"`
}

// GenerateYearReviewRequest is the payload sent to the Agent's year-review endpoint.
type GenerateYearReviewRequest struct {
	Year           int                    `json:"year"`
	Medals         []YearMedalItem        `json:"medals"`
	StageSummaries []YearStageItem        `json:"stage_summaries"`
	GrowthProfile  *GrowthProfileSnapshot `json:"growth_profile,omitempty"`
	Stats          YearReviewStats        `json:"stats"`
	AgentRuntime   *AgentRuntimePayload   `json:"agent_runtime,omitempty"`
}

// MilestoneMedal is a medal selected as a year milestone.
type MilestoneMedal struct {
	MedalID       string `json:"medalId,omitempty"`
	Title         string `json:"title"`
	ShortReason   string `json:"shortReason"`
	MilestoneType string `json:"milestoneType"`
	AgentNote     string `json:"agentNote"`
}

// GrowthArc describes the start–turning–end trajectory of the year.
type GrowthArc struct {
	StartState    string   `json:"startState"`
	TurningPoints []string `json:"turningPoints"`
	EndState      string   `json:"endState"`
}

// EmotionArcEntry is one period's emotion summary.
type EmotionArcEntry struct {
	Period  string `json:"period"`
	Emotion string `json:"emotion"`
	Summary string `json:"summary"`
}

// KeywordEvolution compares earlier vs later year keywords.
type KeywordEvolution struct {
	EarlierKeywords []string `json:"earlierKeywords"`
	LaterKeywords   []string `json:"laterKeywords"`
	Shift           string   `json:"shift"`
}

// GenerateYearReviewResponse is the structured year review returned by Agent.
type GenerateYearReviewResponse struct {
	Title            string            `json:"title"`
	Narrative        string            `json:"narrative"`
	AnnualThemes     []string          `json:"annualThemes"`
	MilestoneMedals  []MilestoneMedal  `json:"milestoneMedals"`
	GrowthArc        GrowthArc         `json:"growthArc"`
	EmotionArc       []EmotionArcEntry `json:"emotionArc"`
	KeywordEvolution KeywordEvolution  `json:"keywordEvolution"`
}

// GenerateYearReview asks the Agent to generate a year-level review.
// This is a heavy call so the client uses a 180s timeout.
func (c *Client) GenerateYearReview(ctx context.Context, req *GenerateYearReviewRequest) (*GenerateYearReviewResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/year/review"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	// Use a per-request timeout override for this heavy call.
	yearReviewCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	httpReq = httpReq.WithContext(yearReviewCtx)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call agent year review: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent year review returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result GenerateYearReviewResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode year review response: %w", err)
	}

	return &result, nil
}
