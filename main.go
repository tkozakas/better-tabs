package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxPRs              = 100
	httpPort            = 19222
	defaultSyncInterval = 5 * time.Minute
	groupMyPRs          = "My PRs"
	launchdLabel        = "com.tab-grouper.daemon"
	systemdService      = "tab-grouper"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type PR struct {
	URL        string     `json:"url"`
	Repository Repository `json:"repository"`
}

type Repository struct {
	IsArchived bool `json:"isArchived"`
}

type AuthoredResponse struct {
	Data struct {
		Viewer struct {
			PullRequests struct {
				Nodes []PR `json:"nodes"`
			} `json:"pullRequests"`
		} `json:"viewer"`
	} `json:"data"`
}

type Group struct {
	URLs      []string `json:"urls"`
	GroupName string   `json:"groupName"`
}

type Message struct {
	Type    string   `json:"type"`
	Groups  []Group  `json:"groups,omitempty"`
	ToClose []string `json:"toClose,omitempty"`
}

type PRServer struct {
	mu           sync.RWMutex
	myPRs        []string
	syncInterval time.Duration
	ticker       *time.Ticker
	clients      map[*websocket.Conn]bool
	clientsMu    sync.RWMutex
	broadcast    chan Message
}

func main() {
	daemonMode := flag.Bool("daemon", false, "Run sync daemon")
	startCmd := flag.Bool("start", false, "Start daemon as background service")
	shutdownCmd := flag.Bool("shutdown", false, "Shutdown running daemon")
	refreshCmd := flag.Bool("refresh", false, "Trigger immediate refresh")
	groupCmd := flag.Bool("group", false, "Group all tabs by domain")
	flag.Parse()

	switch {
	case *startCmd:
		startService()
	case *shutdownCmd:
		shutdownService()
	case *refreshCmd:
		postToEndpoint("/refresh", nil, "Refreshed")
	case *groupCmd:
		postToEndpoint("/group", nil, "Grouping tabs by domain")
	case *daemonMode:
		runDaemon()
	default:
		flag.Usage()
	}
}

func postToEndpoint(path string, body map[string]any, successMsg string) {
	url := fmt.Sprintf("http://localhost:%d%s", httpPort, path)

	var resp *http.Response
	var err error

	if body != nil {
		data, _ := json.Marshal(body)
		resp, err = http.Post(url, "application/json", strings.NewReader(string(data)))
	} else {
		resp, err = http.Post(url, "application/json", nil)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "Daemon not running\n")
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Request failed: %s\n", resp.Status)
		os.Exit(1)
	}

	fmt.Println(successMsg)
}

func startService() {
	switch runtime.GOOS {
	case "darwin":
		startLaunchd()
	case "linux":
		startSystemd()
	default:
		fmt.Fprintf(os.Stderr, "Unsupported OS: %s\n", runtime.GOOS)
		os.Exit(1)
	}
}

func shutdownService() {
	url := fmt.Sprintf("http://localhost:%d/shutdown", httpPort)
	resp, err := http.Post(url, "application/json", nil)
	if err == nil {
		resp.Body.Close()
	}

	switch runtime.GOOS {
	case "darwin":
		shutdownLaunchd()
	case "linux":
		shutdownSystemd()
	default:
		fmt.Fprintf(os.Stderr, "Unsupported OS: %s\n", runtime.GOOS)
		os.Exit(1)
	}
}

func startLaunchd() {
	exe, _ := os.Executable()
	exe, _ = filepath.Abs(exe)

	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>-daemon</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/tmp/tab-grouper.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/tab-grouper.log</string>
</dict>
</plist>`, launchdLabel, exe)

	plistPath := filepath.Join(os.Getenv("HOME"), "Library/LaunchAgents", launchdLabel+".plist")
	os.MkdirAll(filepath.Dir(plistPath), 0755)

	if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write plist: %v\n", err)
		os.Exit(1)
	}

	exec.Command("launchctl", "unload", plistPath).Run()
	if err := exec.Command("launchctl", "load", plistPath).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load service: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Started daemon (logs: /tmp/tab-grouper.log)")
}

func shutdownLaunchd() {
	plistPath := filepath.Join(os.Getenv("HOME"), "Library/LaunchAgents", launchdLabel+".plist")
	exec.Command("launchctl", "unload", plistPath).Run()
	os.Remove(plistPath)
	fmt.Println("Stopped daemon")
}

func startSystemd() {
	exe, _ := os.Executable()
	exe, _ = filepath.Abs(exe)

	unit := fmt.Sprintf(`[Unit]
Description=Tab Grouper Daemon
After=network.target

[Service]
ExecStart=%s -daemon
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`, exe)

	unitDir := filepath.Join(os.Getenv("HOME"), ".config/systemd/user")
	unitPath := filepath.Join(unitDir, systemdService+".service")
	os.MkdirAll(unitDir, 0755)

	if err := os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write unit file: %v\n", err)
		os.Exit(1)
	}

	exec.Command("systemctl", "--user", "daemon-reload").Run()
	exec.Command("systemctl", "--user", "enable", systemdService).Run()
	if err := exec.Command("systemctl", "--user", "start", systemdService).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start service: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Started daemon (logs: journalctl --user -u %s -f)\n", systemdService)
}

func shutdownSystemd() {
	exec.Command("systemctl", "--user", "stop", systemdService).Run()
	exec.Command("systemctl", "--user", "disable", systemdService).Run()
	unitPath := filepath.Join(os.Getenv("HOME"), ".config/systemd/user", systemdService+".service")
	os.Remove(unitPath)
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	fmt.Println("Stopped daemon")
}

func runDaemon() {
	server := &PRServer{
		syncInterval: defaultSyncInterval,
		ticker:       time.NewTicker(defaultSyncInterval),
		clients:      make(map[*websocket.Conn]bool),
		broadcast:    make(chan Message, 10),
	}

	go server.broadcastLoop()
	fetchAndUpdate(server)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.handleWebSocket)
	mux.HandleFunc("/refresh", server.handleRefresh)
	mux.HandleFunc("/config", server.handleConfig)
	mux.HandleFunc("/group", server.handleGroup)
	mux.HandleFunc("/shutdown", server.handleShutdown)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", httpPort),
		Handler: mux,
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		for range server.ticker.C {
			fetchAndUpdate(server)
			server.broadcastPRs()
		}
	}()

	go func() {
		<-sigChan
		fmt.Println("\nShutting down...")
		httpServer.Close()
	}()

	fmt.Printf("Daemon running on :%d (interval: %v)\n", httpPort, defaultSyncInterval)

	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func (s *PRServer) broadcastLoop() {
	for msg := range s.broadcast {
		s.clientsMu.RLock()
		for client := range s.clients {
			err := client.WriteJSON(msg)
			if err != nil {
				client.Close()
				s.clientsMu.RUnlock()
				s.clientsMu.Lock()
				delete(s.clients, client)
				s.clientsMu.Unlock()
				s.clientsMu.RLock()
			}
		}
		s.clientsMu.RUnlock()
	}
}

func (s *PRServer) broadcastPRs() {
	s.mu.RLock()
	msg := Message{
		Type: "prs",
		Groups: []Group{
			{URLs: s.myPRs, GroupName: groupMyPRs},
		},
	}
	s.mu.RUnlock()

	select {
	case s.broadcast <- msg:
	default:
	}
}

func (s *PRServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	s.clientsMu.Lock()
	s.clients[conn] = true
	s.clientsMu.Unlock()

	s.broadcastPRs()

	for {
		var msg struct {
			Type     string   `json:"type"`
			OpenUrls []string `json:"openUrls"`
		}
		err := conn.ReadJSON(&msg)
		if err != nil {
			s.clientsMu.Lock()
			delete(s.clients, conn)
			s.clientsMu.Unlock()
			conn.Close()
			return
		}

		if msg.Type == "tabs" {
			s.handleTabsUpdate(conn, msg.OpenUrls)
		}
	}
}

func (s *PRServer) handleTabsUpdate(conn *websocket.Conn, openUrls []string) {
	s.mu.RLock()
	allPRs := make(map[string]bool)
	for _, u := range s.myPRs {
		allPRs[normalizeURL(u)] = true
	}
	s.mu.RUnlock()

	var toClose []string
	for _, u := range openUrls {
		if strings.Contains(u, "github.com") && strings.Contains(u, "/pull/") {
			if !allPRs[normalizeURL(u)] {
				toClose = append(toClose, u)
			}
		}
	}

	if len(toClose) > 0 {
		conn.WriteJSON(Message{Type: "close", ToClose: toClose})
	}
}

func setCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")
}

func (s *PRServer) handleShutdown(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Write([]byte(`{"status":"ok"}`))
	go func() {
		time.Sleep(100 * time.Millisecond)
		syscall.Kill(syscall.Getpid(), syscall.SIGTERM)
	}()
}

func (s *PRServer) handleConfig(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Interval *string `json:"interval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	if req.Interval != nil {
		if dur, err := time.ParseDuration(*req.Interval); err == nil && dur > 0 {
			s.syncInterval = dur
			s.ticker.Reset(dur)
			fmt.Printf("[%s] Interval: %v\n", time.Now().Format("15:04:05"), dur)
		}
	}
	s.mu.Unlock()

	go func() {
		fetchAndUpdate(s)
		s.broadcastPRs()
	}()
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *PRServer) handleRefresh(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	fetchAndUpdate(s)
	s.broadcastPRs()
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *PRServer) handleGroup(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	select {
	case s.broadcast <- Message{Type: "group"}:
	default:
	}

	w.Write([]byte(`{"status":"ok"}`))
}

func fetchAndUpdate(server *PRServer) {
	myPRs := fetchPRs(fmt.Sprintf(`{
		viewer {
			pullRequests(first: %d, states: OPEN) {
				nodes { url repository { isArchived } }
			}
		}
	}`, maxPRs), func(data []byte) []PR {
		var resp AuthoredResponse
		json.Unmarshal(data, &resp)
		return resp.Data.Viewer.PullRequests.Nodes
	})

	server.mu.Lock()
	server.myPRs = myPRs
	server.mu.Unlock()

	fmt.Printf("[%s] %d PRs\n", time.Now().Format("15:04:05"), len(myPRs))
}

func fetchPRs(query string, extract func([]byte) []PR) []string {
	cmd := exec.Command("gh", "api", "graphql", "-f", "query="+query)
	output, _ := cmd.Output()
	if len(output) == 0 {
		return nil
	}

	var urls []string
	for _, pr := range extract(output) {
		if pr.URL != "" && !pr.Repository.IsArchived {
			urls = append(urls, pr.URL)
		}
	}
	return urls
}

func normalizeURL(u string) string {
	u = strings.TrimSuffix(u, "/")
	u = strings.TrimSuffix(u, "/files")
	u = strings.TrimSuffix(u, "/commits")
	return u
}
