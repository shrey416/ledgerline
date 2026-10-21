module ledgerline/rates-realtime

go 1.24

require (
 github.com/redis/go-redis/v9 v9.7.3
 github.com/prometheus/client_golang v1.21.1
 go.opentelemetry.io/otel v1.35.0
 go.opentelemetry.io/otel/sdk v1.35.0
 go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.35.0
 go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.60.0
)
