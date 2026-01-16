package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNormalizeURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://github.com/user/repo/pull/1", "https://github.com/user/repo/pull/1"},
		{"https://github.com/user/repo/pull/1/", "https://github.com/user/repo/pull/1"},
		{"https://github.com/user/repo/pull/1/files", "https://github.com/user/repo/pull/1"},
		{"https://github.com/user/repo/pull/1/commits", "https://github.com/user/repo/pull/1"},
		{"https://github.com/user/repo/pull/1/files/", "https://github.com/user/repo/pull/1"},
	}

	for _, tt := range tests {
		result := normalizeURL(tt.input)
		if result != tt.expected {
			t.Errorf("normalizeURL(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestExtractDomain(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://github.com/user/repo", "github.com"},
		{"https://google.com/search?q=test", "google.com"},
		{"http://localhost:8080/path", "localhost"},
		{"invalid", ""},
	}

	for _, tt := range tests {
		result := extractDomain(tt.input)
		if result != tt.expected {
			t.Errorf("extractDomain(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func newTestServer() *PRServer {
	return &PRServer{
		syncInterval: 5 * time.Second,
		ticker:       time.NewTicker(5 * time.Second),
		clients:      make(map[*websocket.Conn]bool),
		broadcast:    make(chan Message, 10),
	}
}

func TestHandleConfig(t *testing.T) {
	server := newTestServer()

	body := `{"includeReview":true}`
	req := httptest.NewRequest(http.MethodPost, "/config", strings.NewReader(body))
	w := httptest.NewRecorder()

	server.handleConfig(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if !server.includeReview {
		t.Error("expected includeReview to be true")
	}
}

func TestHandleConfigInterval(t *testing.T) {
	server := newTestServer()

	body := `{"interval":"10s"}`
	req := httptest.NewRequest(http.MethodPost, "/config", strings.NewReader(body))
	w := httptest.NewRecorder()

	server.handleConfig(w, req)

	if server.syncInterval != 10*time.Second {
		t.Errorf("expected interval 10s, got %v", server.syncInterval)
	}
}

func TestHandleRefresh(t *testing.T) {
	server := newTestServer()

	req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
	w := httptest.NewRecorder()

	server.handleRefresh(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestHandleGroup(t *testing.T) {
	server := newTestServer()
	go server.broadcastLoop()

	req := httptest.NewRequest(http.MethodPost, "/group", nil)
	w := httptest.NewRecorder()

	server.handleGroup(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	select {
	case msg := <-server.broadcast:
		if msg.Type != "group" {
			t.Errorf("expected group message, got %s", msg.Type)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("expected group message in broadcast channel")
	}
}

func TestHandleMethodNotAllowed(t *testing.T) {
	server := newTestServer()

	endpoints := []struct {
		path    string
		handler func(http.ResponseWriter, *http.Request)
	}{
		{"/config", server.handleConfig},
		{"/refresh", server.handleRefresh},
		{"/group", server.handleGroup},
		{"/shutdown", server.handleShutdown},
	}

	for _, ep := range endpoints {
		req := httptest.NewRequest(http.MethodGet, ep.path, nil)
		w := httptest.NewRecorder()
		ep.handler(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: expected status 405, got %d", ep.path, w.Code)
		}
	}
}

func TestBroadcastPRs(t *testing.T) {
	server := newTestServer()
	server.myPRs = []string{"https://github.com/user/repo/pull/1"}
	server.reviewPRs = []string{"https://github.com/user/repo/pull/2"}

	go server.broadcastLoop()
	server.broadcastPRs()

	select {
	case msg := <-server.broadcast:
		if msg.Type != "prs" {
			t.Errorf("expected prs message, got %s", msg.Type)
		}
		if len(msg.Groups) != 2 {
			t.Errorf("expected 2 groups, got %d", len(msg.Groups))
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("expected message in broadcast channel")
	}
}
