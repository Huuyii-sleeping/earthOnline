package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/earth-online/api/internal/integrations/agent"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ConversationHandler struct {
	db          *gorm.DB
	logger      *slog.Logger
	agentClient *agent.Client
}

func NewConversationHandler(db *gorm.DB, agentClient *agent.Client, logger *slog.Logger) *ConversationHandler {
	return &ConversationHandler{db: db, agentClient: agentClient, logger: logger}
}

// CreateSession handles POST /experiences/:id/sessions
func (h *ConversationHandler) CreateSession(c *gin.Context) {
	userID, _ := c.Get("user_id")
	experienceID := c.Param("id")

	// Verify experience belongs to user
	var exp database.Experience
	if err := h.db.Where("id = ? AND user_id = ?", experienceID, userID).First(&exp).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "experience not found"})
			return
		}
		h.logger.Error("failed to query experience", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Get or create agent profile for user
	var agentProfile database.AgentProfile
	if err := h.db.Where("user_id = ?", userID).First(&agentProfile).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			agentProfile = database.AgentProfile{
				UserID:         userID.(string),
				Name:           "My Agent",
				ProactiveLevel: 1,
			}
			h.db.Create(&agentProfile)
		} else {
			h.logger.Error("failed to query agent profile", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
	}

	session := database.ConversationSession{
		UserID:         userID.(string),
		ExperienceID:   experienceID,
		AgentProfileID: agentProfile.ID,
		Status:         "active",
	}

	if err := h.db.Create(&session).Error; err != nil {
		h.logger.Error("failed to create session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": dto.SessionResponse{
		ID:             session.ID,
		UserID:         session.UserID,
		ExperienceID:   session.ExperienceID,
		AgentProfileID: session.AgentProfileID,
		Status:         session.Status,
		CreatedAt:      session.CreatedAt,
		UpdatedAt:      session.UpdatedAt,
	}})
}

// ListMessages handles GET /sessions/:id/messages
func (h *ConversationHandler) ListMessages(c *gin.Context) {
	userID, _ := c.Get("user_id")
	sessionID := c.Param("id")

	// Verify session belongs to user
	var session database.ConversationSession
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("failed to query session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var messages []database.ConversationMessage
	if err := h.db.Where("session_id = ?", sessionID).Order("created_at ASC").Find(&messages).Error; err != nil {
		h.logger.Error("failed to list messages", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	resp := make([]dto.MessageResponse, len(messages))
	for i, msg := range messages {
		resp[i] = h.toMessageResponse(&msg)
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// SendMessage handles POST /sessions/:id/messages
func (h *ConversationHandler) SendMessage(c *gin.Context) {
	userID, _ := c.Get("user_id")
	sessionID := c.Param("id")

	// Verify session belongs to user
	var session database.ConversationSession
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("failed to query session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.CreateMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	contentType := "text"
	if req.ContentType != nil {
		contentType = *req.ContentType
	}

	// Save user message
	userMsg := database.ConversationMessage{
		SessionID:   sessionID,
		Role:        "user",
		Content:     req.Content,
		ContentType: contentType,
		AssetID:     req.AssetID,
	}
	if err := h.db.Create(&userMsg).Error; err != nil {
		h.logger.Error("failed to save user message", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	// Call Agent service
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	agentReq := &agent.SendMessageRequest{
		SessionID:         sessionID,
		Content:           req.Content,
		UserID:            userID.(string),
		SummaryText:       session.SummaryText,
		ConversationState: session.CurrentState,
	}

	// Forward browser-side LLM credentials if provided
	if req.AgentRuntime != nil && req.AgentRuntime.APIKey != "" {
		agentReq.AgentRuntime = &agent.AgentRuntimePayload{
			APIURL:       req.AgentRuntime.APIURL,
			APIKey:       req.AgentRuntime.APIKey,
			Model:        req.AgentRuntime.Model,
			SystemPrompt: req.AgentRuntime.SystemPrompt,
		}
	}

	agentResp, err := h.agentClient.SendMessage(ctx, agentReq)
	if err != nil {
		h.logger.Error("agent call failed", "error", err)
		// Still return the user message, agent reply will be empty
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"user_message":  h.toMessageResponse(&userMsg),
				"agent_message": nil,
				"error":         "agent service unavailable",
			},
		})
		return
	}

	// Save agent reply
	agentMsg := database.ConversationMessage{
		SessionID:   sessionID,
		Role:        "agent",
		Content:     agentResp.Reply,
		ContentType: "text",
	}
	if err := h.db.Create(&agentMsg).Error; err != nil {
		h.logger.Error("failed to save agent message", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save agent reply"})
		return
	}

	// Update session's conversation state if the Agent returned one
	if agentResp.ConversationState != "" {
		h.db.Model(&database.ConversationSession{}).
			Where("id = ?", sessionID).
			Update("current_state", agentResp.ConversationState)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"user_message":  h.toMessageResponse(&userMsg),
			"agent_message": h.toMessageResponse(&agentMsg),
		},
	})
}

// SendMessageStream handles POST /sessions/:id/messages/stream
// Streams the agent's reply token by token via SSE, then saves the complete message.
func (h *ConversationHandler) SendMessageStream(c *gin.Context) {
	userID, _ := c.Get("user_id")
	sessionID := c.Param("id")

	// Verify session belongs to user
	var session database.ConversationSession
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("failed to query session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.CreateMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	contentType := "text"
	if req.ContentType != nil {
		contentType = *req.ContentType
	}

	// Save user message
	userMsg := database.ConversationMessage{
		SessionID:   sessionID,
		Role:        "user",
		Content:     req.Content,
		ContentType: contentType,
		AssetID:     req.AssetID,
	}
	if err := h.db.Create(&userMsg).Error; err != nil {
		h.logger.Error("failed to save user message", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	// Build agent request
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	agentReq := &agent.SendMessageRequest{
		SessionID:         sessionID,
		Content:           req.Content,
		UserID:            userID.(string),
		SummaryText:       session.SummaryText,
		ConversationState: session.CurrentState,
	}

	if req.AgentRuntime != nil && req.AgentRuntime.APIKey != "" {
		agentReq.AgentRuntime = &agent.AgentRuntimePayload{
			APIURL:       req.AgentRuntime.APIURL,
			APIKey:       req.AgentRuntime.APIKey,
			Model:        req.AgentRuntime.Model,
			SystemPrompt: req.AgentRuntime.SystemPrompt,
		}
	}

	// Call Agent service with streaming
	streamBody, err := h.agentClient.SendMessageStream(ctx, agentReq)
	if err != nil {
		h.logger.Error("agent stream call failed", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "agent service unavailable"})
		return
	}
	defer streamBody.Close()

	// Set SSE headers
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache, no-transform")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)

	// Read SSE from Agent service, parse tokens, proxy to frontend
	scanner := bufio.NewScanner(streamBody)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	var fullReply strings.Builder

	for scanner.Scan() {
		line := scanner.Text()

		// Only process data: lines
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")

		var data struct {
			Token               string   `json:"token"`
			Done                bool     `json:"done"`
			Reply               string   `json:"reply"`
			Error               string   `json:"error"`
			Thinking            bool     `json:"thinking"`
			ConversationState   string   `json:"conversation_state"`
			TurnCount           int      `json:"turn_count"`
			ProbeCount          int      `json:"probe_count"`
			CollectedDimensions []string `json:"collected_dimensions"`
		}
		if err := json.Unmarshal([]byte(payload), &data); err != nil {
			continue
		}

		if data.Error != "" {
			errJSON, _ := json.Marshal(map[string]any{"error": data.Error})
			c.Writer.Write([]byte("data: " + string(errJSON) + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
			break
		}

		if data.Thinking {
			thinkingJSON, _ := json.Marshal(map[string]any{"thinking": true})
			c.Writer.Write([]byte("data: " + string(thinkingJSON) + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}

		if data.Token != "" {
			fullReply.WriteString(data.Token)
			tokenJSON, _ := json.Marshal(map[string]any{"token": data.Token})
			c.Writer.Write([]byte("data: " + string(tokenJSON) + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}

		if data.Done {
			reply := data.Reply
			if reply == "" {
				reply = fullReply.String()
			}

			// Save agent message to database
			agentMsg := database.ConversationMessage{
				SessionID:   sessionID,
				Role:        "agent",
				Content:     reply,
				ContentType: "text",
			}
			if saveErr := h.db.Create(&agentMsg).Error; saveErr != nil {
				h.logger.Error("failed to save agent message", "error", saveErr)
			}

			// Update session's conversation state
			if data.ConversationState != "" {
				h.db.Model(&database.ConversationSession{}).
					Where("id = ?", sessionID).
					Update("current_state", data.ConversationState)
			}

			doneJSON, _ := json.Marshal(map[string]any{
				"done":               true,
				"user_message_id":    userMsg.ID,
				"agent_message_id":   agentMsg.ID,
				"conversation_state": data.ConversationState,
			})
			c.Writer.Write([]byte("data: " + string(doneJSON) + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
			break
		}
	}

	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		h.logger.Error("stream scan error", "error", err)
	}
}

// StreamSession handles GET /agent/sessions/:id/stream
// Proxies SSE from Agent service to frontend
func (h *ConversationHandler) StreamSession(c *gin.Context) {
	userID, _ := c.Get("user_id")
	sessionID := c.Param("id")

	// Verify session belongs to user
	var session database.ConversationSession
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("failed to query session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Proxy SSE from Agent service
	ctx := c.Request.Context()
	body, err := h.agentClient.StreamSession(ctx, sessionID)
	if err != nil {
		h.logger.Error("agent stream failed", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "agent stream unavailable"})
		return
	}
	defer body.Close()

	// Set SSE headers
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache, no-transform")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, err := body.Read(buf)
		if n > 0 {
			c.Writer.Write(buf[:n])
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			if err != io.EOF {
				h.logger.Error("stream read error", "error", err)
			}
			break
		}
	}
}

// GenerateSummary handles POST /sessions/:id/summary
func (h *ConversationHandler) GenerateSummary(c *gin.Context) {
	userID, _ := c.Get("user_id")
	sessionID := c.Param("id")

	// Verify session belongs to user
	var session database.ConversationSession
	if err := h.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		h.logger.Error("failed to query session", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Parse request body for agent_runtime
	var req dto.SummaryRequest
	_ = c.ShouldBindJSON(&req)

	// Load conversation history from DB — the Agent needs this to generate
	// a meaningful summary. Without it, the LLM has zero context.
	var messages []database.ConversationMessage
	if err := h.db.Where("session_id = ?", sessionID).Order("created_at ASC").Find(&messages).Error; err != nil {
		h.logger.Error("failed to query messages for summary", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load conversation history"})
		return
	}

	history := make([]agent.HistoryItem, 0, len(messages))
	for _, msg := range messages {
		history = append(history, agent.HistoryItem{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	// Call Agent service for summary
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	var runtime *agent.AgentRuntimePayload
	if req.AgentRuntime != nil && req.AgentRuntime.APIKey != "" {
		runtime = &agent.AgentRuntimePayload{
			APIURL:       req.AgentRuntime.APIURL,
			APIKey:       req.AgentRuntime.APIKey,
			Model:        req.AgentRuntime.Model,
			SystemPrompt: req.AgentRuntime.SystemPrompt,
		}
	}

	rawSummary, err := h.agentClient.GenerateSummary(ctx, sessionID, history, runtime)
	if err != nil {
		h.logger.Error("agent summary failed", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("agent summary failed: %v", err)})
		return
	}

	// Parse the raw JSON into our response
	var summary dto.SummaryResponse
	if err := json.Unmarshal(rawSummary, &summary); err != nil {
		h.logger.Error("failed to parse summary", "error", err)
		// Return raw JSON if it doesn't match our struct
		c.JSON(http.StatusOK, gin.H{"data": json.RawMessage(rawSummary)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": summary})
}

func (h *ConversationHandler) toMessageResponse(msg *database.ConversationMessage) dto.MessageResponse {
	return dto.MessageResponse{
		ID:          msg.ID,
		SessionID:   msg.SessionID,
		Role:        msg.Role,
		Content:     msg.Content,
		ContentType: msg.ContentType,
		AssetID:     msg.AssetID,
		CreatedAt:   msg.CreatedAt,
	}
}
