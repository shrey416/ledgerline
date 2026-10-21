import Fastify from 'fastify';
import cassandra from 'cassandra-driver';
import client from 'prom-client';
import { trace } from '@opentelemetry/api';
import { installNotifications } from './delivery.js';
const server = Fastify({ disableRequestLogging: true, logger: {redact:['req.headers.authorization','req.body.code']} });
client.collectDefaultMetrics();
const requests=new client.Counter({name:'ledgerline_http_requests_total',help:'HTTP requests',labelNames:['service','method','route','status']});
const duration=new client.Histogram({name:'ledgerline_http_request_duration_seconds',help:'HTTP duration',labelNames:['service','method','route','status']});
const dependency=new client.Gauge({name:'ledgerline_dependency_up',help:'Dependency readiness',labelNames:['service','dependency']});
const started=new WeakMap();
server.addHook('onRequest',async request=>{started.set(request,performance.now());});
server.addHook('onResponse',async(request,reply)=>{
  const route=request.routeOptions.url||'other';if(route==='/metrics')return;
  const labels={service:'notifications',method:request.method,route,status:String(reply.statusCode)};
  requests.inc(labels);duration.observe(labels,(performance.now()-started.get(request))/1000);
  // Health success stays in metrics; avoid writing three lines per probe/scrape.
  if (!route.startsWith('/health/') || reply.statusCode >= 400)
    server.log.info({service:'notifications',route,status:reply.statusCode,trace_id:trace.getActiveSpan()?.spanContext().traceId},'HTTP request');
});
const database = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_HOSTS || 'cassandra.data.svc.cluster.local').split(','),
  localDataCenter: process.env.CASSANDRA_DC || 'datacenter1',
  ...(process.env.CASSANDRA_USER?{credentials:{username:process.env.CASSANDRA_USER,password:process.env.CASSANDRA_PASSWORD}}:{}),
  socketOptions:{connectTimeout:5000,readTimeout:5000},
  queryOptions:{consistency:cassandra.types.consistencies.localQuorum}
});
server.get('/health/live',async()=>({status:'up',service:'notifications'}));
const delivery = await installNotifications(server,database);
server.get('/health/ready',async(request,reply)=>{
  try {await database.execute('SELECT release_version FROM system.local');if(!delivery.ready())throw new Error('Schema initializing');dependency.set({service:'notifications',dependency:'cassandra'},1);return {status:'up',database:'cassandra',service:'notifications',emailMode:process.env.SMTP_LOCAL_ONLY==='false'?'smtp':'local-inbox'};}
  catch {dependency.set({service:'notifications',dependency:'cassandra'},0);return reply.code(503).send({status:'down',database:'cassandra'});}
});
server.get('/metrics',async(request,reply)=>reply.header('Content-Type',client.register.contentType).send(await client.register.metrics()));
server.addHook('onClose',async()=>database.shutdown());
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));
await server.listen({host:'0.0.0.0',port:8080});
