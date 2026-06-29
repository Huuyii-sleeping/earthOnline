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
	SessionID string                 `json:"session_id"`
	Content   string                 `json:"content"`
	Context   map[string]interface{} `json:"context,omitempty"`
}

// SendMessageResponse is what the Agent service returns for a non-streaming message.
type SendMessageResponse struct {
	Reply   string `json:"reply"`
	Done    bool   `json:"done"`
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
	SessionID   string                 `json:"session_id"`
	Experience  string                 `json:"experience,omitempty"`
	History     []HistoryItem           `json:"history,omitempty"`
	Direction   string                 `json:"direction,omitempty"`
	UserInput   string                 `json:"user_input,omitempty"`
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
func (c *Client) GenerateSummary(ctx context.Context, sessionID string) (json.RawMessage, error) {
	url := c.baseURL + "/sessions/" + sessionID + "/summary"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create summary request: %w", err)
	}

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