using System.Net.Http.Headers;
using System.Text;
using System.Diagnostics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Prometheus;
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Services.AddOpenTelemetry().ConfigureResource(resource=>resource.AddService("analytics"))
    .WithTracing(tracing=>tracing.AddAspNetCoreInstrumentation(options=>options.Filter=context=>context.Request.Path!="/metrics").AddHttpClientInstrumentation().AddOtlpExporter());
var requests=Metrics.CreateCounter("ledgerline_http_requests_total","HTTP requests",new CounterConfiguration{LabelNames=new[]{"service","method","route","status"}});
var duration=Metrics.CreateHistogram("ledgerline_http_request_duration_seconds","HTTP duration",new HistogramConfiguration{LabelNames=new[]{"service","method","route","status"}});
var dependency=Metrics.CreateGauge("ledgerline_dependency_up","Dependency readiness",new GaugeConfiguration{LabelNames=new[]{"service","dependency"}});
builder.Services.AddHttpClient("clickhouse", client => {
    client.BaseAddress = new Uri(Environment.GetEnvironmentVariable("CLICKHOUSE_URL") ?? throw new InvalidOperationException("CLICKHOUSE_URL required"));
    client.Timeout = TimeSpan.FromSeconds(2);
    var user = Environment.GetEnvironmentVariable("CLICKHOUSE_USER") ?? "ledgerline";
    var password = Environment.GetEnvironmentVariable("CLICKHOUSE_PASSWORD") ?? throw new InvalidOperationException("CLICKHOUSE_PASSWORD required");
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{password}")));
});
var app = builder.Build();
app.Use(async(context,next)=>{
    var start=Stopwatch.GetTimestamp();
    try {await next(context);} finally {
        if(context.Request.Path!="/metrics") {
            var route=context.Request.Path.StartsWithSegments("/health")?context.Request.Path.ToString():"other";
            var labels=new[]{"analytics",context.Request.Method,route,context.Response.StatusCode.ToString()};
            requests.WithLabels(labels).Inc();duration.WithLabels(labels).Observe(Stopwatch.GetElapsedTime(start).TotalSeconds);
            app.Logger.LogInformation("HTTP request {service} {route} {status} {trace_id}","analytics",route,context.Response.StatusCode,Activity.Current?.TraceId.ToString());
        }
    }
});
app.MapMetrics();
app.MapGet("/health/live", () => Results.Ok(new {status="up",service="analytics"}));
app.MapGet("/health/ready", async (IHttpClientFactory factory, CancellationToken cancel) => {
    try {
        using var response = await factory.CreateClient("clickhouse").PostAsync("/",new StringContent("SELECT 1",Encoding.UTF8,"text/plain"),cancel);
        dependency.WithLabels("analytics","clickhouse").Set(response.IsSuccessStatusCode?1:0);
        return response.IsSuccessStatusCode ? Results.Ok(new {status="up",database="clickhouse",service="analytics"}) : Results.Json(new {status="down",database="clickhouse"},statusCode:503);
    } catch (HttpRequestException) { dependency.WithLabels("analytics","clickhouse").Set(0);return Results.Json(new {status="down",database="clickhouse"},statusCode:503); }
      catch (OperationCanceledException) { dependency.WithLabels("analytics","clickhouse").Set(0);return Results.Json(new {status="down",database="clickhouse"},statusCode:503); }
});
app.Run();
