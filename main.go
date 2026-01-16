package main

import (
	"bytes"
	"encoding/binary"
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

	"github.com/pierrec/lz4/v4"
)

const (
	maxPRs           = 100
	labelAuthoredPRs = "your open PRs"
	labelReviewPRs   = "PRs pending your review"
	tabOpenDelay     = 100 * time.Millisecond
	mozLz4Magic      = "mozLz40\x00"
	extensionID      = "pr-tab-grouper@localhost"
	nativeAppName    = "pr_tab_grouper"
	httpPort         = 19222
	serverTimeout    = 30 * time.Second
)

type PR struct {
	Title      string     `json:"title"`
	URL        string     `json:"url"`
	Repository Repository `json:"repository"`
}

type Repository struct {
	NameWithOwner string `json:"nameWithOwner"`
	IsArchived    bool   `json:"isArchived"`
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

type SessionData struct {
	Windows []struct {
		Tabs []struct {
			Entries []struct {
				URL string `json:"url"`
			} `json:"entries"`
		} `json:"tabs"`
	} `json:"windows"`
}

type NativeRequest struct {
	URLs      []string `json:"urls"`
	GroupName string   `json:"groupName"`
}

type PRServer struct {
	mu        sync.Mutex
	urls      []string
	groupName string
	consumed  bool
}

func main() {
	openBrowser := flag.Bool("open", false, "Open PRs in browser")
	reviewMode := flag.Bool("review", false, "Show PRs pending your review")
	nativeMode := flag.Bool("native", false, "Run as native messaging host")
	flag.Parse()

	if *nativeMode {
		runNativeHost()
		return
	}

	prs, label, err := fetchPRs(*reviewMode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching PRs: %v\n", err)
		os.Exit(1)
	}

	if len(prs) == 0 {
		fmt.Printf("No %s found.\n", label)
		return
	}

	printPRs(prs, label)

	if *openBrowser {
		groupName := "My PRs"
		if *reviewMode {
			groupName = "Review PRs"
		}
		openPRs(prs, groupName)
		return
	}

	fmt.Println("\nRun with -open to open PRs in browser")
}

func runNativeHost() {
	for {
		length := make([]byte, 4)
		if _, err := os.Stdin.Read(length); err != nil {
			return
		}

		msgLen := binary.LittleEndian.Uint32(length)
		msg := make([]byte, msgLen)
		if _, err := os.Stdin.Read(msg); err != nil {
			return
		}

		var req NativeRequest
		json.Unmarshal(msg, &req)

		openTabs := getOpenTabs()
		var urlsToOpen []string
		for _, url := range req.URLs {
			if !openTabs[normalizeURL(url)] {
				urlsToOpen = append(urlsToOpen, url)
			}
		}

		response := map[string]interface{}{
			"urls":      urlsToOpen,
			"groupName": req.GroupName,
			"action":    "open",
		}
		sendNativeMessage(response)
	}
}

func sendNativeMessage(msg interface{}) {
	data, _ := json.Marshal(msg)
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(len(data)))
	buf.Write(data)
	os.Stdout.Write(buf.Bytes())
}

func fetchPRs(reviewMode bool) ([]PR, string, error) {
	if reviewMode {
		prs, err := fetchReviewRequests()
		return prs, labelReviewPRs, err
	}
	prs, err := fetchAuthoredPRs()
	return prs, labelAuthoredPRs, err
}

func fetchAuthoredPRs() ([]PR, error) {
	query := fmt.Sprintf(`{
		viewer {
			pullRequests(first: %d, states: OPEN) {
				nodes {
					title
					url
					repository { nameWithOwner isArchived }
				}
			}
		}
	}`, maxPRs)

	output, err := runGraphQL(query)
	if err != nil {
		return nil, err
	}

	var resp AuthoredResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	return filterPRs(resp.Data.Viewer.PullRequests.Nodes), nil
}

func fetchReviewRequests() ([]PR, error) {
	query := fmt.Sprintf(`{
		search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: %d) {
			nodes {
				... on PullRequest {
					title
					url
					repository { nameWithOwner isArchived }
				}
			}
		}
	}`, maxPRs)

	output, err := runGraphQL(query)
	if err != nil {
		return nil, err
	}

	var resp ReviewResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	return filterPRs(resp.Data.Search.Nodes), nil
}

func runGraphQL(query string) ([]byte, error) {
	cmd := exec.Command("gh", "api", "graphql", "-f", "query="+query)
	output, _ := cmd.Output()

	if len(output) == 0 {
		return nil, fmt.Errorf("gh api returned no data")
	}

	return output, nil
}

func filterPRs(prs []PR) []PR {
	var filtered []PR
	for _, pr := range prs {
		if pr.URL == "" || pr.Repository.IsArchived {
			continue
		}
		filtered = append(filtered, pr)
	}
	return filtered
}

func openPRs(prs []PR, groupName string) {
	openTabs := getOpenTabs()

	var urlsToOpen []string
	for _, pr := range prs {
		if !openTabs[normalizeURL(pr.URL)] {
			urlsToOpen = append(urlsToOpen, pr.URL)
		} else {
			fmt.Printf("Skipping (already open): %s\n", pr.URL)
		}
	}

	if len(urlsToOpen) == 0 {
		fmt.Println("All PRs already open in browser.")
		return
	}

	if isExtensionInstalled() {
		fmt.Printf("Opening %d PRs in '%s' group...\n", len(urlsToOpen), groupName)
		openViaExtension(urlsToOpen, groupName)
	} else {
		fmt.Printf("Opening %d PRs in new window...\n", len(urlsToOpen))
		openInNewWindow(urlsToOpen)
		fmt.Println("\nRun ./install.sh to enable tab grouping")
	}
}

func isExtensionInstalled() bool {
	manifestPath := getNativeManifestPath()
	_, err := os.Stat(manifestPath)
	return err == nil
}

func getNativeManifestPath() string {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library/Application Support/Mozilla/NativeMessagingHosts", nativeAppName+".json")
	case "linux":
		return filepath.Join(os.Getenv("HOME"), ".mozilla/native-messaging-hosts", nativeAppName+".json")
	default:
		return ""
	}
}

func openViaExtension(urls []string, groupName string) {
	server := &PRServer{
		urls:      urls,
		groupName: groupName,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/prs", server.handlePRs)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", httpPort),
		Handler: mux,
	}

	fmt.Printf("Waiting for extension to pick up %d URLs...\n", len(urls))
	fmt.Println("(Server running on http://localhost:19222/prs)")

	go func() {
		if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		}
	}()

	deadline := time.Now().Add(serverTimeout)
	for time.Now().Before(deadline) {
		server.mu.Lock()
		done := server.consumed
		server.mu.Unlock()

		if done {
			fmt.Println("Extension picked up URLs. Tabs should be grouped now.")
			httpServer.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	fmt.Println("Timeout waiting for extension. Opening tabs directly...")
	httpServer.Close()
	openInNewWindow(urls)
}

func (s *PRServer) handlePRs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		return
	}

	if r.Method == http.MethodDelete {
		s.mu.Lock()
		s.consumed = true
		s.mu.Unlock()
		w.Write([]byte(`{"status":"ok"}`))
		return
	}

	if r.Method == http.MethodGet {
		s.mu.Lock()
		defer s.mu.Unlock()

		if s.consumed || len(s.urls) == 0 {
			w.Write([]byte(`{"urls":[]}`))
			return
		}

		resp := map[string]interface{}{
			"urls":      s.urls,
			"groupName": s.groupName,
		}
		json.NewEncoder(w).Encode(resp)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func openInNewWindow(urls []string) {
	if len(urls) == 0 {
		return
	}

	openFirstInNewWindow(urls[0])
	time.Sleep(tabOpenDelay)

	for _, url := range urls[1:] {
		openInTab(url)
		time.Sleep(tabOpenDelay)
	}
}

func normalizeURL(url string) string {
	url = strings.TrimSuffix(url, "/")
	url = strings.TrimSuffix(url, "/files")
	url = strings.TrimSuffix(url, "/commits")
	return url
}

func getOpenTabs() map[string]bool {
	tabs := make(map[string]bool)

	sessionFile := findSessionFile()
	if sessionFile == "" {
		return tabs
	}

	data, err := readMozLz4(sessionFile)
	if err != nil {
		return tabs
	}

	var session SessionData
	if err := json.Unmarshal(data, &session); err != nil {
		return tabs
	}

	for _, window := range session.Windows {
		for _, tab := range window.Tabs {
			for _, entry := range tab.Entries {
				if strings.Contains(entry.URL, "github.com") && strings.Contains(entry.URL, "/pull/") {
					tabs[normalizeURL(entry.URL)] = true
				}
			}
		}
	}

	return tabs
}

func readMozLz4(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	if len(data) < 12 || string(data[:8]) != mozLz4Magic {
		return nil, fmt.Errorf("invalid mozlz4 file")
	}

	decompressedSize := binary.LittleEndian.Uint32(data[8:12])
	decompressed := make([]byte, decompressedSize)

	n, err := lz4.UncompressBlock(data[12:], decompressed)
	if err != nil {
		return nil, err
	}

	return decompressed[:n], nil
}

func findSessionFile() string {
	var profileDir string

	switch runtime.GOOS {
	case "darwin":
		profileDir = filepath.Join(os.Getenv("HOME"), "Library/Application Support/Firefox/Profiles")
	case "linux":
		profileDir = filepath.Join(os.Getenv("HOME"), ".mozilla/firefox")
	default:
		return ""
	}

	entries, err := os.ReadDir(profileDir)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if entry.IsDir() && strings.HasSuffix(entry.Name(), ".default-release") {
			recovery := filepath.Join(profileDir, entry.Name(), "sessionstore-backups", "recovery.jsonlz4")
			if _, err := os.Stat(recovery); err == nil {
				return recovery
			}
		}
	}

	return ""
}

func printPRs(prs []PR, label string) {
	fmt.Printf("Found %d %s:\n\n", len(prs), label)
	for i, pr := range prs {
		fmt.Printf("%d. [%s] %s\n   %s\n\n", i+1, pr.Repository.NameWithOwner, pr.Title, pr.URL)
	}
}

func openFirstInNewWindow(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("/Applications/Firefox.app/Contents/MacOS/firefox", "--new-window", url)
	case "linux":
		cmd = exec.Command("firefox", "--new-window", url)
	case "windows":
		cmd = exec.Command("firefox", "--new-window", url)
	}

	cmd.Start()
}

func openInTab(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("/Applications/Firefox.app/Contents/MacOS/firefox", "--new-tab", url)
	case "linux":
		cmd = exec.Command("firefox", "--new-tab", url)
	case "windows":
		cmd = exec.Command("firefox", "--new-tab", url)
	}

	cmd.Start()
}
