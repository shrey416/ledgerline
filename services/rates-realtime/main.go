package main

import (
 "context"
 "encoding/json"
 "fmt"
 "strconv"
 "math"
 "log/slog"
 "net/http"
 "os"
 "os/signal"
 "syscall"
 "time"
 "github.com/redis/go-redis/v9"
 "github.com/prometheus/client_golang/prometheus"
 "github.com/prometheus/client_golang/prometheus/promhttp"
 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/sdk/resource"
 sdktrace "go.opentelemetry.io/otel/sdk/trace"
 "go.opentelemetry.io/otel/attribute"
 "go.opentelemetry.io/otel/trace"
 "go.opentelemetry.io/otel/propagation"
 "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
 "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
 logger := slog.New(slog.NewJSONHandler(os.Stdout,nil))
 exporter,err:=otlptracehttp.New(context.Background());if err!=nil {logger.Error("Trace exporter configuration invalid");os.Exit(1)}
 traces:=sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter),sdktrace.WithResource(resource.NewWithAttributes("",attribute.String("service.name","rates-realtime"))))
 otel.SetTracerProvider(traces);otel.SetTextMapPropagator(propagation.TraceContext{});defer traces.Shutdown(context.Background())
 requests:=prometheus.NewCounterVec(prometheus.CounterOpts{Name:"ledgerline_http_requests_total",Help:"HTTP requests"},[]string{"service","method","route","status"})
 duration:=prometheus.NewHistogramVec(prometheus.HistogramOpts{Name:"ledgerline_http_request_duration_seconds",Help:"HTTP duration"},[]string{"service","method","route","status"})
 dependency:=prometheus.NewGaugeVec(prometheus.GaugeOpts{Name:"ledgerline_dependency_up",Help:"Dependency readiness"},[]string{"service","dependency"})
 prometheus.MustRegister(requests,duration,dependency)
 options, err := redis.ParseURL(os.Getenv("REDIS_URL")); if err != nil { logger.Error("Invalid REDIS_URL");os.Exit(1) }
 cache := redis.NewClient(options); defer cache.Close()
 router := http.NewServeMux()
 router.HandleFunc("GET /health/live",func(w http.ResponseWriter,r *http.Request){ w.Header().Set("Content-Type","application/json");json.NewEncoder(w).Encode(map[string]string{"status":"up","service":"rates-realtime"}) })
 router.HandleFunc("GET /health/ready",func(w http.ResponseWriter,r *http.Request){ctx,cancel:=context.WithTimeout(r.Context(),2*time.Second);defer cancel(); w.Header().Set("Content-Type","application/json"); if cache.Ping(ctx).Err()!=nil {dependency.WithLabelValues("rates-realtime","redis").Set(0);w.WriteHeader(503);json.NewEncoder(w).Encode(map[string]string{"status":"down","database":"redis"});return};dependency.WithLabelValues("rates-realtime","redis").Set(1);json.NewEncoder(w).Encode(map[string]string{"status":"up","database":"redis","service":"rates-realtime"}) })
 router.HandleFunc("GET /api/v1/rates/convert",func(w http.ResponseWriter,r *http.Request){
 w.Header().Set("Content-Type","application/json")
 rates:=map[string]float64{"INR":1,"USD":85,"EUR":92,"GBP":110,"JPY":0.57,"AED":23.15}
 from,to:=r.URL.Query().Get("from"),r.URL.Query().Get("to")
 amount,e:=strconv.ParseFloat(r.URL.Query().Get("amount"),64)
 if e!=nil||math.IsNaN(amount)||math.IsInf(amount,0)||amount<0||amount>1e12||rates[from]==0||rates[to]==0 {http.Error(w,`{"error":"Invalid amount or unsupported currency"}`,400);return}
 ctx,cancel:=context.WithTimeout(r.Context(),2*time.Second);defer cancel()
 key:="ledgerline:fx:static-v1"
 values:=map[string]interface{}{};for k,v:=range rates{values[k]=strconv.FormatFloat(v,'f',-1,64)}
 if err:=cache.HSet(ctx,key,values).Err();err!=nil{http.Error(w,`{"error":"Rate store unavailable"}`,503);return}
 saved,err:=cache.HGetAll(ctx,key).Result();if err!=nil{http.Error(w,`{"error":"Rate store unavailable"}`,503);return}
 a,_:=strconv.ParseFloat(saved[from],64);b,_:=strconv.ParseFloat(saved[to],64)
 if a<=0||b<=0{http.Error(w,`{"error":"Invalid stored rate"}`,503);return}
 json.NewEncoder(w).Encode(map[string]interface{}{"from":from,"to":to,"amount":amount,"converted":math.Round(amount*a/b*100)/100,"rate":a/b,"source":"Static demonstration rates stored in Redis; not live market rates"})
 })
 router.Handle("GET /metrics",promhttp.Handler())
 observed:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){if r.URL.Path=="/metrics"{router.ServeHTTP(w,r);return};start:=time.Now();response:=&statusWriter{ResponseWriter:w,status:200};router.ServeHTTP(response,r);route:=r.URL.Path;if route!="/health/live"&&route!="/health/ready"{route="other"};status:=fmt.Sprint(response.status);requests.WithLabelValues("rates-realtime",r.Method,route,status).Inc();duration.WithLabelValues("rates-realtime",r.Method,route,status).Observe(time.Since(start).Seconds());logger.Info("HTTP request","service","rates-realtime","route",route,"status",response.status,"trace_id",trace.SpanContextFromContext(r.Context()).TraceID().String())})
 server:=&http.Server{Addr:":8080",Handler:otelhttp.NewHandler(observed,"http.server",otelhttp.WithFilter(func(r *http.Request)bool{return r.URL.Path!="/metrics"})),ReadHeaderTimeout:5*time.Second,ReadTimeout:10*time.Second,WriteTimeout:10*time.Second,IdleTimeout:60*time.Second}
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 go func(){logger.Info("Service started","service","rates-realtime");if err:=server.ListenAndServe();err!=nil&&err!=http.ErrServerClosed {logger.Error("Server failed","error",err.Error());stop()}}()
 <-ctx.Done();shutdown,cancel:=context.WithTimeout(context.Background(),10*time.Second);defer cancel();if err:=server.Shutdown(shutdown);err!=nil {logger.Error("Shutdown failed","error",err.Error())}
}

type statusWriter struct {http.ResponseWriter;status int}
func (w *statusWriter) WriteHeader(code int){w.status=code;w.ResponseWriter.WriteHeader(code)}
