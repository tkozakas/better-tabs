package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	maxPRs         = 100
	httpPort       = 19222
	syncInterval   = 5 * time.Minute
	groupMyPRs     = "My PRs"
	groupReviewPRs = "Review PRs"
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
}

type OpenUrlsRequest struct {
	OpenUrls []string `json:"openUrls"`
}

type PRResponse struct {
	Groups []PRGroup `json:"groups"`
}

type PRGroup struct {
	URLs      []string `json:"urls"`
	GroupName string   `json:"groupName"`
}

func main() {
	reviewMode := flag.Bool("review", false, "Include review requests")
	daemonMode := flag.Bool("daemon", false, "Run sync daemon")
	refreshCmd := flag.Bool("refresh", false, "Trigger refresh")
	flag.Parse()

	if *refreshCmd {
		triggerRefresh(*reviewMode)
		return
	}

	if *daemonMode {
		runDaemon(*reviewMode)
		return
	}

	flag.Usage()
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

func runDaemon(includeReview bool) {
	server := &PRServer{includeReview: includeReview}
	fetchAndUpdate(server)

	mux := http.NewServeMux()
	mux.HandleFunc("/prs", server.handlePRs)
	mux.HandleFunc("/refresh", server.handleRefresh)

	go func() {
		ticker := time.NewTicker(syncInterval)
		for range ticker.C {
			fetchAndUpdate(server)
		}
	}()

	fmt.Printf("Daemon running on http://localhost:%d\n", httpPort)

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
	myPRsToOpen := filterNotOpen(s.myPRs, openUrls)
	reviewPRsToOpen := filterNotOpen(s.reviewPRs, openUrls)
	s.mu.RUnlock()

	resp := PRResponse{
		Groups: []PRGroup{
			{URLs: myPRsToOpen, GroupName: groupMyPRs},
			{URLs: reviewPRsToOpen, GroupName: groupReviewPRs},
		},
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
