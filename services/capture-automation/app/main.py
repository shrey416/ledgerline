"""Capture service: observable process and MongoDB readiness foundation."""
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pymongo import AsyncMongoClient
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

SERVICE = "capture-automation"
logging.basicConfig(level=logging.INFO, format="%(message)s")
provider = TracerProvider(resource=Resource.create({"service.name": SERVICE}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
requests = Counter("ledgerline_http_requests_total", "HTTP requests", ["service", "method", "route", "status"])
duration = Histogram("ledgerline_http_request_duration_seconds", "HTTP duration", ["service", "method", "route", "status"])
dependency = Gauge("ledgerline_dependency_up", "Dependency readiness", ["service", "dependency"])

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.mongo = AsyncMongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=2000)
    logging.info(json.dumps({"service": SERVICE, "level": "INFO", "message": "Service started"}))
    yield
    await app.state.mongo.close()
    provider.shutdown()

app = FastAPI(title="Ledgerline Capture & Automation", version="0.1.0", lifespan=lifespan)
FastAPIInstrumentor.instrument_app(app, excluded_urls="metrics")

@app.middleware("http")
async def telemetry(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = getattr(request.scope.get("route"), "path", "other")
    if route != "/metrics":
        labels = (SERVICE, request.method, route, str(response.status_code))
        requests.labels(*labels).inc()
        duration.labels(*labels).observe(time.perf_counter() - start)
        span = trace.get_current_span().get_span_context()
        logging.info(json.dumps({"service": SERVICE,"level":"INFO","message":"HTTP request","route":route,"status":response.status_code,"trace_id":f"{span.trace_id:032x}"}))
    return response

@app.get("/health/live")
async def live():
    return {"status": "up", "service": SERVICE}

@app.get("/health/ready")
async def ready():
    try:
        await app.state.mongo.admin.command("ping")
        dependency.labels(SERVICE, "mongodb").set(1)
        return {"status": "up", "database": "mongodb", "service": SERVICE}
    except Exception:
        dependency.labels(SERVICE, "mongodb").set(0)
        return JSONResponse({"status": "down", "database": "mongodb"}, status_code=503)

@app.get("/metrics", include_in_schema=False)
async def metrics():
    return Response(generate_latest(), headers={"Content-Type": CONTENT_TYPE_LATEST})
