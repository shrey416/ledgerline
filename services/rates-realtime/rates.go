package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
)

const rateKey = "ledgerline:fx:public-v1"
const providerURL = "https://open.er-api.com/v6/latest/USD"
const maxRateAge = 7 * 24 * time.Hour

var refreshes = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ledgerline_fx_refresh_total", Help: "Public exchange rate refresh attempts"}, []string{"result"})
var rateUpdated = prometheus.NewGauge(prometheus.GaugeOpts{Name: "ledgerline_fx_updated_timestamp_seconds", Help: "Provider timestamp of the cached rate snapshot"})

func init() { prometheus.MustRegister(refreshes, rateUpdated) }

type rateSnapshot struct {
	Result  string             `json:"result"`
	Base    string             `json:"base_code"`
	Updated int64              `json:"time_last_update_unix"`
	Next    int64              `json:"time_next_update_unix"`
	Rates   map[string]float64 `json:"rates"`
}

func supportedCurrency(code string) bool {
	switch code {
	case "INR", "USD", "EUR", "GBP", "JPY", "AED":
		return true
	}
	return false
}
func (s rateSnapshot) validate(now time.Time) error {
	if s.Result != "success" || s.Base != "USD" || s.Updated <= 0 || s.Updated > now.Add(5*time.Minute).Unix() || now.Sub(time.Unix(s.Updated, 0)) > maxRateAge || s.Next <= s.Updated || s.Next > now.Add(48*time.Hour).Unix() {
		return fmt.Errorf("invalid provider metadata")
	}
	for _, code := range []string{"INR", "USD", "EUR", "GBP", "JPY", "AED"} {
		v := s.Rates[code]
		if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("invalid provider rate for %s", code)
		}
	}
	if s.Rates["USD"] != 1 {
		return fmt.Errorf("invalid base rate")
	}
	return nil
}
func loadRates(ctx context.Context, cache *redis.Client) (rateSnapshot, error) {
	var snapshot rateSnapshot
	data, err := cache.Get(ctx, rateKey).Bytes()
	if err != nil {
		return snapshot, err
	}
	if err = json.Unmarshal(data, &snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, snapshot.validate(time.Now())
}
func fetchRates(ctx context.Context, client *http.Client, url string) (rateSnapshot, error) {
	var snapshot rateSnapshot
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return snapshot, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Ledgerline/1.0")
	response, err := client.Do(req)
	if err != nil {
		return snapshot, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return snapshot, fmt.Errorf("provider HTTP %d", response.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(&snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, snapshot.validate(time.Now())
}

// Background refresh keeps third-party HTTP latency out of the conversion path.
// Redis coordinates refreshes across replicas and retains the last good snapshot.
func runRateRefresh(ctx context.Context, cache *redis.Client, logger *slog.Logger) {
	client := &http.Client{Timeout: 4 * time.Second}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		refreshRates(ctx, cache, client, logger)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func refreshRates(parent context.Context, cache *redis.Client, client *http.Client, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(parent, 6*time.Second)
	defer cancel()
	current, err := loadRates(ctx, cache)
	if err == nil {
		rateUpdated.Set(float64(current.Updated))
		if time.Now().Unix() < current.Next {
			return
		}
	}
	// Keep the cooldown on failures too: outages cannot cause a request storm.
	acquired, err := cache.SetNX(ctx, rateKey+":refresh-cooldown", "1", 5*time.Minute).Result()
	if err != nil || !acquired {
		return
	}
	next, err := fetchRates(ctx, client, providerURL)
	if err != nil {
		refreshes.WithLabelValues("provider_error").Inc()
		logger.Warn("Currency rate refresh failed; retaining cached rates", "error", err.Error())
		return
	}
	data, err := json.Marshal(next)
	if err != nil {
		return
	}
	ttl := time.Until(time.Unix(next.Updated, 0).Add(maxRateAge))
	if ttl <= 0 {
		return
	}
	if err = cache.Set(ctx, rateKey, data, ttl).Err(); err != nil {
		refreshes.WithLabelValues("cache_error").Inc()
		logger.Warn("Currency rate cache write failed")
		return
	}
	rateUpdated.Set(float64(next.Updated))
	refreshes.WithLabelValues("success").Inc()
	logger.Info("Currency rates refreshed", "provider", "ExchangeRate-API", "updated_at", next.Updated)
}
