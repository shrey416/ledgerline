import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
const sdk = new NodeSDK({resource:resourceFromAttributes({'service.name':'notifications'}),traceExporter:new OTLPTraceExporter(),instrumentations:[new HttpInstrumentation()]});
sdk.start();
process.on('SIGTERM',()=>sdk.shutdown().catch(()=>{}));
