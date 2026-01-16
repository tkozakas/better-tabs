package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	maxPRs              = 100
	httpPort            = 19222
	defaultSyncInterval = 5 * time.Minute
	groupMyPRs          = "My PRs"
	groupReviewPRs      = "Review PRs"
	launchdLabel        = "com.tab-grouper.daemon"
	systemdService      = "tab-grouper"
)

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

type ReviewResponse struct {
	Data struct {
		Search struct {
			Nodes []PR `json:"nodes"`
		} `json:"search"`
	} `json:"data"`
}

type PRServer struct {
	mu            sync.RWMutex
	myPRs         []string
	reviewPRs     []string
	includeReview bool
	syncInterval  time.Duration
}

type OpenUrlsRequest struct {
	OpenUrls []string `json:"openUrls"`
}

type PRResponse struct {
	Groups  []PRGroup `json:"groups"`
	ToClose []string  `json:"toClose"`
}

type PRGroup struct {
	URLs      []string `json:"urls"`
	GroupName string   `json:"groupName"`
}

func main() {
	reviewMode := flag.Bool("review", false, "Include review requests")
	daemonMode := flag.Bool("daemon", false, "Run sync daemon")
	refreshCmd := flag.Bool("refresh", false, "Trigger refresh")
	installCmd := flag.Bool("install", false, "Install launchd service")
	uninstallCmd := flag.Bool("uninstall", false, "Uninstall launchd service")
	interval := flag.Duration("interval", defaultSyncInterval, "Sync interval")
	flag.Parse()

	if *installCmd {
		installService(*reviewMode, *interval)
		return
	}

	if *uninstallCmd {
		uninstallService()
		return
	}

	if *refreshCmd {
		triggerRefresh(*reviewMode)
		return
	}

	if *daemonMode {
		runDaemon(*reviewMode, *interval)
		return
	}

	flag.Usage()
}

func installService(review bool, interval time.Duration) {
	switch runtime.GOOS {
	case "darwin":
		installLaunchd(review, interval)
	case "linux":
		installSystemd(review, interval)
	default:
		fmt.Fprintf(os.Stderr, "Unsupported OS: %s\n", runtime.GOOS)
		os.Exit(1)
	}
}

func uninstallService() {
	switch runtime.GOOS {
	case "darwin":
		uninstallLaunchd()
	case "linux":
		uninstallSystemd()
	default:
		fmt.Fprintf(os.Stderr, "Unsupported OS: %s\n", runtime.GOOS)
		os.Exit(1)
	}
}

func installLaunchd(review bool, interval time.Duration) {
	exe, _ := os.Executable()
	exe, _ = filepath.Abs(exe)

	args := fmt.Sprintf(`<string>%s</string>
		<string>-daemon</string>`, exe)
	if review {
		args += "\n\t\t<string>-review</string>"
	}
	if interval != defaultSyncInterval {
		args += fmt.Sprintf("\n\t\t<string>-interval</string>\n\t\t<string>%s</string>", interval)
	}

	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		%s
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
</plist>`, launchdLabel, args)

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

	fmt.Printf("Installed and started launchd service\nLogs: /tmp/tab-grouper.log\n")
}

func uninstallLaunchd() {
	plistPath := filepath.Join(os.Getenv("HOME"), "Library/LaunchAgents", launchdLabel+".plist")
	exec.Command("launchctl", "unload", plistPath).Run()
	os.Remove(plistPath)
	fmt.Println("Uninstalled launchd service")
}

func installSystemd(review bool, interval time.Duration) {
	exe, _ := os.Executable()
	exe, _ = filepath.Abs(exe)

	args := exe + " -daemon"
	if review {
		args += " -review"
	}
	if interval != defaultSyncInterval {
		args += fmt.Sprintf(" -interval %s", interval)
	}

	unit := fmt.Sprintf(`[Unit]
Description=Tab Grouper Daemon
After=network.target

[Service]
ExecStart=%s
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`, args)

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

	fmt.Printf("Installed and started systemd service\nLogs: journalctl --user -u %s -f\n", systemdService)
}

func uninstallSystemd() {
	exec.Command("systemctl", "--user", "stop", systemdService).Run()
	exec.Command("systemctl", "--user", "disable", systemdService).Run()
	unitPath := filepath.Join(os.Getenv("HOME"), ".config/systemd/user", systemdService+".service")
	os.Remove(unitPath)
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	fmt.Println("Uninstalled systemd service")
}

func triggerRefresh(includeReview bool) {
	url := fmt.Sprintf("http://localhost:%d/refresh", httpPort)
	body := fmt.Sprintf(`{"includeReview":%v}`, includeReview)

	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Daemon not running: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Refresh failed: %s\n", resp.Status)
		os.Exit(1)
	}

	fmt.Println("Refreshed")
}

func runDaemon(includeReview bool, interval time.Duration) {
	server := &PRServer{includeReview: includeReview, syncInterval: interval}
	fetchAndUpdate(server)

	mux := http.NewServeMux()
	mux.HandleFunc("/prs", server.handlePRs)
	mux.HandleFunc("/refresh", server.handleRefresh)

	go func() {
		ticker := time.NewTicker(interval)
		for range ticker.C {
			fetchAndUpdate(server)
		}
	}()

	fmt.Printf("Daemon running on http://localhost:%d (interval: %v)\n", httpPort, interval)

	if err := http.ListenAndServe(fmt.Sprintf(":%d", httpPort), mux); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func (s *PRServer) handleRefresh(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IncludeReview bool `json:"includeReview"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	s.mu.Lock()
	s.includeReview = req.IncludeReview
	s.mu.Unlock()

	fetchAndUpdate(s)
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *PRServer) handlePRs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req OpenUrlsRequest
	json.NewDecoder(r.Body).Decode(&req)

	openUrls := make(map[string]bool)
	for _, u := range req.OpenUrls {
		openUrls[normalizeURL(u)] = true
	}

	s.mu.RLock()
	allPRs := make(map[string]bool)
	for _, u := range s.myPRs {
		allPRs[normalizeURL(u)] = true
	}
	for _, u := range s.reviewPRs {
		allPRs[normalizeURL(u)] = true
	}

	myPRsToOpen := filterNotOpen(s.myPRs, openUrls)
	reviewPRsToOpen := filterNotOpen(s.reviewPRs, openUrls)
	s.mu.RUnlock()

	var toClose []string
	for _, u := range req.OpenUrls {
		if strings.Contains(u, "github.com") && strings.Contains(u, "/pull/") {
			if !allPRs[normalizeURL(u)] {
				toClose = append(toClose, u)
			}
		}
	}

	resp := PRResponse{
		Groups: []PRGroup{
			{URLs: myPRsToOpen, GroupName: groupMyPRs},
			{URLs: reviewPRsToOpen, GroupName: groupReviewPRs},
		},
		ToClose: toClose,
	}
	json.NewEncoder(w).Encode(resp)
}

func fetchAndUpdate(server *PRServer) {
	myPRs := fetchAuthoredPRs()

	server.mu.Lock()
	includeReview := server.includeReview
	server.mu.Unlock()

	var reviewPRs []string
	if includeReview {
		reviewPRs = fetchReviewRequests()
	}

	server.mu.Lock()
	server.myPRs = myPRs
	server.reviewPRs = reviewPRs
	server.mu.Unlock()

	fmt.Printf("[%s] %d my, %d review\n", time.Now().Format("15:04:05"), len(myPRs), len(reviewPRs))
}

func fetchAuthoredPRs() []string {
	query := fmt.Sprintf(`{
		viewer {
			pullRequests(first: %d, states: OPEN) {
				nodes { url repository { isArchived } }
			}
		}
	}`, maxPRs)

	output, err := runGraphQL(query)
	if err != nil {
		return nil
	}

	var resp AuthoredResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		return nil
	}

	return extractURLs(resp.Data.Viewer.PullRequests.Nodes)
}

func fetchReviewRequests() []string {
	query := fmt.Sprintf(`{
		search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: %d) {
			nodes { ... on PullRequest { url repository { isArchived } } }
		}
	}`, maxPRs)

	output, err := runGraphQL(query)
	if err != nil {
		return nil
	}

	var resp ReviewResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		return nil
	}

	return extractURLs(resp.Data.Search.Nodes)
}

func runGraphQL(query string) ([]byte, error) {
	cmd := exec.Command("gh", "api", "graphql", "-f", "query="+query)
	return cmd.Output()
}

func extractURLs(prs []PR) []string {
	var urls []string
	for _, pr := range prs {
		if pr.URL != "" && !pr.Repository.IsArchived {
			urls = append(urls, pr.URL)
		}
	}
	return urls
}

func filterNotOpen(urls []string, openUrls map[string]bool) []string {
	var result []string
	for _, u := range urls {
		if !openUrls[normalizeURL(u)] {
			result = append(result, u)
		}
	}
	return result
}

func normalizeURL(url string) string {
	url = strings.TrimSuffix(url, "/")
	url = strings.TrimSuffix(url, "/files")
	url = strings.TrimSuffix(url, "/commits")
	return url
}
