package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	exporter, err := otlptracehttp.New(context.Background())
	if err != nil {
		logger.Error("Trace exporter configuration invalid")
		os.Exit(1)
	}
	traces := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(resource.NewWithAttributes("", attribute.String("service.name", "rates-realtime"))))
	otel.SetTracerProvider(traces)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer traces.Shutdown(context.Background())
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ledgerline_http_requests_total", Help: "HTTP requests"}, []string{"service", "method", "route", "status"})
	duration := prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "ledgerline_http_request_duration_seconds", Help: "HTTP duration"}, []string{"service", "method", "route", "status"})
	dependency := prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "ledgerline_dependency_up", Help: "Dependency readiness"}, []string{"service", "dependency"})
	prometheus.MustRegister(requests, duration, dependency)
	options, err := redis.ParseURL(os.Getenv("REDIS_URL"))
	if err != nil {
		logger.Error("Invalid REDIS_URL")
		os.Exit(1)
	}
	options.ContextTimeoutEnabled = true
	options.DialTimeout = 2 * time.Second
	options.ReadTimeout = time.Second
	options.WriteTimeout = time.Second
	options.MaxRetries = 0
	cache := redis.NewClient(options)
	defer cache.Close()
	ratesContext, stopRates := context.WithCancel(context.Background())
	defer stopRates()
	go runRateRefresh(ratesContext, cache, logger)
	router := http.NewServeMux()
	router.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "up", "service": "rates-realtime"})
	})
	router.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "application/json")
		if cache.Ping(ctx).Err() != nil {
			dependency.WithLabelValues("rates-realtime", "redis").Set(0)
			w.WriteHeader(503)
			json.NewEncoder(w).Encode(map[string]string{"status": "down", "database": "redis"})
			return
		}
		dependency.WithLabelValues("rates-realtime", "redis").Set(1)
		json.NewEncoder(w).Encode(map[string]string{"status": "up", "database": "redis", "service": "rates-realtime"})
	})
	router.HandleFunc("GET /api/v1/rates/convert", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
		amount, e := strconv.ParseFloat(r.URL.Query().Get("amount"), 64)
		if e != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > 1e12 || !supportedCurrency(from) || !supportedCurrency(to) {
			http.Error(w, `{"error":"Invalid amount or unsupported currency"}`, 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		snapshot, err := loadRates(ctx, cache)
		if err != nil {
			http.Error(w, `{"error":"Exchange rates are not available yet. Please retry shortly."}`, 503)
			return
		}
		rate := snapshot.Rates[to] / snapshot.Rates[from]
		json.NewEncoder(w).Encode(map[string]interface{}{"from": from, "to": to, "amount": amount, "converted": math.Round(amount*rate*100) / 100, "rate": rate, "source": "ExchangeRate-API", "updatedAt": time.Unix(snapshot.Updated, 0).UTC().Format(time.RFC3339), "stale": time.Now().Unix() >= snapshot.Next})
	})
	router.Handle("GET /metrics", promhttp.Handler())
	observed := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			router.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		response := &statusWriter{ResponseWriter: w, status: 200}
		router.ServeHTTP(response, r)
		route := r.URL.Path
		if route != "/health/live" && route != "/health/ready" && route != "/api/v1/rates/convert" {
			route = "other"
		}
		status := fmt.Sprint(response.status)
		requests.WithLabelValues("rates-realtime", r.Method, route, status).Inc()
		duration.WithLabelValues("rates-realtime", r.Method, route, status).Observe(time.Since(start).Seconds())
		logger.Info("HTTP request", "service", "rates-realtime", "route", route, "status", response.status, "trace_id", trace.SpanContextFromContext(r.Context()).TraceID().String())
	})
	server := &http.Server{Addr: ":8080", Handler: otelhttp.NewHandler(observed, "http.server", otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/metrics" })), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		logger.Info("Service started", "service", "rates-realtime")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server failed", "error", err.Error())
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		logger.Error("Shutdown failed", "error", err.Error())
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }
