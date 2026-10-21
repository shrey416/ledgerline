using System.Net.Http.Headers;
using System.Text;
using System.Diagnostics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Prometheus;
var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString);
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
app.MapPost("/api/v1/analytics/report", async (ReportInput input, IHttpClientFactory factory, CancellationToken cancel) => {
    if(input.Entries is null || input.Entries.Length>10000 || input.Entries.Any(e=>e is null || e.Amount<0 || e.Amount>1000000000000m || string.IsNullOrWhiteSpace(e.Category) || e.Category.Length>80 || !(new[]{"expense","income","transfer"}).Contains(e.Kind)))
        return Results.BadRequest(new {error="Invalid report entries"});
    var client=factory.CreateClient("clickhouse");
    // Request-local external table: real ClickHouse aggregation without retaining private records.
    var rows=string.Join("\n", input.Entries.Select(e=>System.Text.Json.JsonSerializer.Serialize(new {category=e.Category,kind=e.Kind,amount=e.Amount})));
    using var form=new MultipartFormDataContent();
    form.Add(new StringContent("category String, kind String, amount Decimal(20,2)"),"entries_structure");
    form.Add(new StringContent("JSONEachRow"),"entries_format");
    form.Add(new StringContent(rows),"entries","entries.json");
    var query="SELECT category, kind, count() AS count, toString(sum(amount)) AS total FROM entries GROUP BY category, kind ORDER BY category, kind FORMAT JSON";
    using var response=await client.PostAsync("/?query="+Uri.EscapeDataString(query),form,cancel);
    if(!response.IsSuccessStatusCode)return Results.Json(new {error="Report database unavailable"},statusCode:503);
    return Results.Content(await response.Content.ReadAsStringAsync(cancel),"application/json");
});
app.Run();
record ReportEntry(string Category, string Kind, decimal Amount);
record ReportInput(ReportEntry[] Entries);

