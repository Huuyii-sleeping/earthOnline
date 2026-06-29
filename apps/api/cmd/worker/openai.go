package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

// openAIClient is a minimal client for the two endpoints the worker needs:
// the Whisper transcription endpoint and the multimodal chat completions
// endpoint. It intentionally avoids pulling in a third-party SDK so that the
// worker binary stays small.
type openAIClient struct {
	apiKey  string
	baseURL string
	model   string
	http    *http.Client
}

func newOpenAIClient(apiKey, baseURL, model string) *openAIClient {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	if model == "" {
		model = "gpt-4o"
	}
	return &openAIClient{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		model:   model,
		http:    &http.Client{},
	}
}

// transcribeAudio sends raw audio bytes to the Whisper API and returns the
// transcribed text.
func (c *openAIClient) transcribeAudio(ctx context.Context, audioBytes []byte, mimeType string) (string, error) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)

	if err := w.WriteField("model", "whisper-1"); err != nil {
		return "", fmt.Errorf("write model field: %w", err)
	}
	if err := w.WriteField("response_format", "json"); err != nil {
		return "", fmt.Errorf("write response_format field: %w", err)
	}

	filename := "audio." + audioExtension(mimeType)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", fmt.Errorf("create file field: %w", err)
	}
	if _, err := fw.Write(audioBytes); err != nil {
		return "", fmt.Errorf("write audio bytes: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("close multipart writer: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/audio/transcriptions", &b)
	if err != nil {
		return "", fmt.Errorf("create whisper request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("call whisper: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("whisper returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode whisper response: %w", err)
	}
	return strings.TrimSpace(result.Text), nil
}

// describeImage sends an image to the multimodal chat completions endpoint and
// returns the model's natural-language understanding of the image.
func (c *openAIClient) describeImage(ctx context.Context, imageBytes []byte, mimeType string, prompt string) (string, error) {
	if prompt == "" {
		prompt = "请用中文简洁地描述这张图片中的关键内容、场景和情绪氛围，便于后续用于生成个人经历奖章。"
	}

	dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(imageBytes)

	payload := map[string]interface{}{
		"model": c.model,
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": prompt},
					{"type": "image_url", "image_url": map[string]string{"url": dataURL}},
				},
			},
		},
		"max_tokens": 512,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal vision request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create vision request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("call vision api: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("vision api returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode vision response: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("vision api returned no choices")
	}
	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

// audioExtension maps a mime type to a file extension for the Whisper upload.
func audioExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "audio/mpeg", "audio/mp3":
		return "mp3"
	case "audio/wav", "audio/x-wav":
		return "wav"
	case "audio/ogg":
		return "ogg"
	case "audio/m4a", "audio/x-m4a":
		return "m4a"
	case "audio/webm":
		return "webm"
	default:
		return "bin"
	}
}
