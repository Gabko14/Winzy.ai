package jwtmint

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestMint_HappyPath_ClaimsShape(t *testing.T) {
	secret := "winzy-dev-jwt-secret-minimum-32-characters-long!!"
	tok, err := Mint(secret, "11111111-1111-1111-1111-111111111111", "a@example.com", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("want 3 JWT segments, got %d", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	if claims["sub"] != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("sub = %v", claims["sub"])
	}
	if claims["email"] != "a@example.com" {
		t.Errorf("email = %v", claims["email"])
	}
	if claims["jti"] == nil || claims["jti"] == "" {
		t.Error("jti missing")
	}
	if claims["exp"] == nil {
		t.Error("exp missing")
	}
	if _, ok := claims["iss"]; ok {
		t.Error("iss must be absent")
	}
	if _, ok := claims["aud"]; ok {
		t.Error("aud must be absent")
	}
}

func TestMint_ErrorCase_ShortSecret(t *testing.T) {
	_, err := Mint("too-short", "u", "e@x.com", time.Minute)
	if err == nil {
		t.Fatal("expected error")
	}
}
