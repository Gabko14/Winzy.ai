// Package httpclient is a thin wrapper around net/http tailored for the
// parity harness: it knows how to talk to the Winzy gateway as either a
// "native" client (bearer token, no cookie jar, no Sec-Fetch-Site header —
// refresh token travels in the JSON body) or a "web" client (cookie jar
// carries the httpOnly refresh_token cookie, Sec-Fetch-Site is sent so the
// gateway's IsWebClient detection fires and the refreshToken field in the
// JSON body comes back null).
package httpclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"time"
)

// Request describes one HTTP call. Path is relative to the client's base
// URL (e.g. "/auth/login").
type Request struct {
	Method  string
	Path    string
	Query   url.Values
	Headers map[string]string
	Bearer  string
	Body    any // marshalled as JSON if non-nil
}

// Result captures everything about one call: the request as sent (for
// artifact/log purposes) and the response as received.
type Result struct {
	Request     Request
	StatusCode  int
	Header      http.Header
	RawBody     []byte
	JSON        any // decoded body, nil if empty or not JSON
	Duration    time.Duration
	RequestBody []byte // the exact bytes sent on the wire, nil if no body
}

// Client is one HTTP identity: either it carries a cookie jar (web client)
// or it doesn't (native client). BaseURL has no trailing slash.
type Client struct {
	BaseURL   string
	http      *http.Client
	webClient bool // sends Sec-Fetch-Site, so the gateway treats it as a browser
}

func New(baseURL string, webClient bool) (*Client, error) {
	c := &http.Client{Timeout: 20 * time.Second}
	if webClient {
		jar, err := cookiejar.New(nil)
		if err != nil {
			return nil, fmt.Errorf("httpclient: creating cookie jar: %w", err)
		}
		c.Jar = jar
	}
	return &Client{BaseURL: baseURL, http: c, webClient: webClient}, nil
}

func (c *Client) Do(req Request) (*Result, error) {
	var bodyReader io.Reader
	var rawBody []byte
	if req.Body != nil {
		b, err := json.Marshal(req.Body)
		if err != nil {
			return nil, fmt.Errorf("httpclient: marshalling request body: %w", err)
		}
		rawBody = b
		bodyReader = bytes.NewReader(b)
	}

	full := c.BaseURL + req.Path
	if len(req.Query) > 0 {
		full += "?" + req.Query.Encode()
	}

	httpReq, err := http.NewRequest(req.Method, full, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("httpclient: building request: %w", err)
	}
	if req.Body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if req.Bearer != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.Bearer)
	}
	if c.webClient {
		// Any value triggers ASP.NET's IsWebClient detection; "same-origin"
		// is what a real same-origin fetch() sends.
		httpReq.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("httpclient: request failed: %w", err)
	}
	defer resp.Body.Close()
	dur := time.Since(start)

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("httpclient: reading response body: %w", err)
	}

	var decoded any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &decoded) // non-JSON bodies (e.g. svg) simply leave decoded nil
	}

	return &Result{
		Request:     req,
		StatusCode:  resp.StatusCode,
		Header:      resp.Header,
		RawBody:     raw,
		JSON:        decoded,
		Duration:    dur,
		RequestBody: rawBody,
	}, nil
}
