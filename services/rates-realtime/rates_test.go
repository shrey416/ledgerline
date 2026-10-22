package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/redis/go-redis/v9"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestPublicRates(t *testing.T) {
	now := time.Now().Unix()
	for _, tc := range []struct {
		name, body string
		status     int
		valid      bool
	}{
		{"valid", fmt.Sprintf(`{"result":"success","base_code":"USD","time_last_update_unix":%d,"time_next_update_unix":%d,"rates":{"USD":1,"INR":84,"EUR":0.92,"GBP":0.77,"JPY":150,"AED":3.67}}`, now, now+86400), 200, true},
		{"missing currencies", fmt.Sprintf(`{"result":"success","base_code":"USD","time_last_update_unix":%d,"time_next_update_unix":%d,"rates":{"USD":1}}`, now, now+86400), 200, false},
		{"malformed", "not json", 200, false}, {"rate limited", "{}", 429, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer server.Close()
			s, err := fetchRates(context.Background(), server.Client(), server.URL)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if tc.valid && math.Abs(840*s.Rates["USD"]/s.Rates["INR"]-10) > 1e-9 {
				t.Fatal("cross currency calculation failed")
			}
		})
	}
}
func TestRejectExpiredRates(t *testing.T) {
	s := rateSnapshot{Result: "success", Base: "USD", Updated: time.Now().Add(-8 * 24 * time.Hour).Unix(), Next: time.Now().Unix()}
	if s.validate(time.Now()) == nil {
		t.Fatal("expired snapshot accepted")
	}
}

// This test uses a disposable Redis instance, never the application's database.
func TestLiveProviderAndRedis(t *testing.T) {
	url := os.Getenv("FX_INTEGRATION_REDIS_URL")
	if url == "" {
		t.Skip("set FX_INTEGRATION_REDIS_URL to a disposable Redis instance")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(options)
	defer cache.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	snapshot, err := fetchRates(ctx, &http.Client{Timeout: 8 * time.Second}, providerURL)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err = cache.Set(ctx, rateKey, data, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	defer cache.Del(context.Background(), rateKey)
	saved, err := loadRates(ctx, cache)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Updated != snapshot.Updated || saved.Rates["INR"] != snapshot.Rates["INR"] {
		t.Fatal("Redis snapshot mismatch")
	}
	rate := saved.Rates["USD"] / saved.Rates["INR"]
	if rate <= 0 {
		t.Fatal("invalid conversion")
	}
	t.Logf("Public API + Redis verified; provider timestamp=%d, INR to USD rate=%.6f", saved.Updated, rate)
}
