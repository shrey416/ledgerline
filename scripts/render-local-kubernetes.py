"""Render local hybrid Kubernetes resources; generated credentials are never committed."""
import hashlib, json, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
generated = root / 'infra/k8s/local/generated'
generated.mkdir(parents=True, exist_ok=True)
runtime = json.loads((generated / 'network.json').read_text(encoding='utf-8-sig'))
secrets = dict(line.split('=', 1) for line in (root/'infra/local/.env').read_text(encoding='utf-8-sig').splitlines() if '=' in line)
namespace = 'ledgerline-local'
profile = sys.argv[1] if len(sys.argv)>1 else 'daily'
if profile not in ('daily','full'): raise SystemExit('Use daily or full profile')
items = []
def add(kind, name, spec=None, api='v1', **extra):
    value = dict(apiVersion=api, kind=kind, metadata=dict(name=name, namespace=namespace), **extra)
    if spec is not None: value['spec'] = spec
    items.append(value)
    return value

items.append(dict(apiVersion='v1', kind='Namespace', metadata=dict(name=namespace, labels={'app.kubernetes.io/part-of': 'ledgerline'})))
for name, ports in {'postgres':[5432], 'mongodb':[27017], 'redis':[6379], 'clickhouse':[8123], 'cassandra':[9042], 'kafka':[9092], 'keycloak':[8080], 'otel-collector':[4317,4318], 'logstash':[8080], 'mailpit':[1025]}.items():
    if name=='logstash' and profile=='daily': continue
    add('Service', name, dict(ports=[dict(name=f'p{p}', port=p, targetPort=p) for p in ports]))
    endpoint = add('EndpointSlice', name, api='discovery.k8s.io/v1', addressType='IPv4', ports=[dict(name=f'p{p}', port=p, protocol='TCP') for p in ports], endpoints=[dict(addresses=[runtime['infrastructure'][name]], conditions=dict(ready=True))])
    endpoint['metadata']['labels']={'kubernetes.io/service-name':name, 'endpointslice.kubernetes.io/managed-by':'ledgerline-local-renderer'}

agent = '''receivers:
  otlp:
    protocols:
      http: {endpoint: 0.0.0.0:4318}
      grpc: {endpoint: 0.0.0.0:4317}
processors:
  memory_limiter: {check_interval: 1s, limit_mib: 32, spike_limit_mib: 8}
  batch: {timeout: 2s, send_batch_size: 128}
exporters:
  otlp: {endpoint: otel-collector:4317, tls: {insecure: true}}
extensions:
  health_check: {endpoint: 0.0.0.0:13133}
service:
  extensions: [health_check]
  pipelines:
    traces: {receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlp]}
'''
add('ConfigMap', 'otel-agent', data={'agent.yaml':agent})
add('ConfigMap','web-runtime',data={'runtime.json':json.dumps({'profile':profile})})
add('ConfigMap', 'gateway', data={'envoy.yaml':(root/'infra/local/envoy.yaml').read_text()})
services = [
 ('core-finance',512,256,'/actuator/health/liveness','/actuator/health/readiness',dict(POSTGRES_URL='jdbc:postgresql://postgres:5432/ledgerline',POSTGRES_USER='ledgerline',POSTGRES_PASSWORD=secrets['POSTGRES_PASSWORD'],OIDC_ISSUER_URI='http://localhost:8180/realms/ledgerline',OIDC_JWKS_URI='http://keycloak:8080/realms/ledgerline/protocol/openid-connect/certs',OIDC_AUDIENCE='ledgerline',JAVA_TOOL_OPTIONS='-XX:MaxRAMPercentage=65 -XX:InitialRAMPercentage=20',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://localhost:4318/v1/traces')),
 ('capture-automation',256,64,'/health/live','/health/ready',dict(MONGO_URL='mongodb://mongodb:27017/ledgerline?replicaSet=rs0')),
 ('rates-realtime',128,32,'/health/live','/health/ready',dict(REDIS_URL=f"redis://:{secrets['REDIS_PASSWORD']}@redis:6379")),
 ('analytics',256,64,'/health/live','/health/ready',dict(CLICKHOUSE_URL='http://clickhouse:8123',CLICKHOUSE_USER='ledgerline',CLICKHOUSE_PASSWORD=secrets['CLICKHOUSE_PASSWORD'])),
 ('notifications',256,64,'/health/live','/health/ready',dict(CASSANDRA_HOSTS='cassandra',CASSANDRA_DC='datacenter1',NODE_OPTIONS='--max-old-space-size=128')),
]
def resources(memory, request): return dict(requests=dict(cpu='50m',memory=f'{request}Mi'),limits=dict(cpu='500m' if profile=='daily' else '1000m',memory=f'{memory}Mi'))
def probe(path): return dict(httpGet=dict(path=path,port=8080),timeoutSeconds=4,periodSeconds=10,failureThreshold=3)
safe = dict(allowPrivilegeEscalation=False,capabilities=dict(drop=['ALL']))
for index, (name,memory,request,live,ready,env) in enumerate(services):
    if name=='notifications':
        env.update(dict(line.split('=',1) for line in (root/'infra/local/email.env').read_text(encoding='utf-8-sig').splitlines() if '=' in line and not line.startswith('#')))
        env.update(OIDC_ISSUER='http://localhost:8180/realms/ledgerline',OIDC_JWKS='http://keycloak:8080/realms/ledgerline/protocol/openid-connect/certs')
    env.update(OTEL_SDK_DISABLED='false',OTEL_TRACES_SAMPLER='parentbased_always_on')
    env.update(OTEL_SERVICE_NAME=name,OTEL_EXPORTER_OTLP_ENDPOINT='http://otel-collector:4318' if profile=='daily' else 'http://localhost:4318',OTEL_EXPORTER_OTLP_PROTOCOL='http/protobuf')
    if name=='core-finance': env.update(MANAGEMENT_TRACING_ENABLED='true',TRACE_SAMPLE_RATE='1.0')
    if profile=='daily':
        env.update(OTEL_SDK_DISABLED='true',OTEL_TRACES_SAMPLER='always_off')
        if name=='core-finance': env.update(SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE='4',SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE='1',SERVER_TOMCAT_THREADS_MAX='16',SERVER_TOMCAT_THREADS_MIN_SPARE='2')
        if name=='core-finance': env.update(MANAGEMENT_TRACING_ENABLED='false',TRACE_SAMPLE_RATE='0.0',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://otel-collector:4318/v1/traces',JAVA_TOOL_OPTIONS='-XX:MaxRAMPercentage=60 -XX:InitialRAMPercentage=15 -XX:ActiveProcessorCount=2')
    add('Secret', name, type='Opaque', stringData=env)
    add('Service',name,dict(type='NodePort',selector=dict(app=name),ports=[dict(name='http',port=8080,targetPort=8080,nodePort=30081+index)]))
    startup=probe(live);startup['failureThreshold']=30
    containers=[dict(name=name,image=f'ledgerline/{name}:dev',imagePullPolicy='Never',ports=[dict(containerPort=8080)],envFrom=[dict(secretRef=dict(name=name))],resources=resources(memory,request),securityContext=dict(**safe,runAsNonRoot=True,runAsUser=10001),readinessProbe=probe(ready),livenessProbe=probe(live),startupProbe=startup),
      dict(name='otel-agent',image='otel/opentelemetry-collector-contrib:0.127.0',imagePullPolicy='IfNotPresent',args=['--config=/etc/otel/agent.yaml'],env=[dict(name='GOMEMLIMIT',value='64MiB'),dict(name='GOGC',value='40')],resources=resources(128,32),securityContext=dict(**safe,runAsUser=10001,runAsNonRoot=True,readOnlyRootFilesystem=True),volumeMounts=[dict(name='otel-config',mountPath='/etc/otel',readOnly=True)],readinessProbe=dict(httpGet=dict(path='/',port=13133),periodSeconds=10))]
    if profile=='daily': containers=containers[:1]
    # Permit short login/data bursts without increasing the steady-state CPU request.
    if profile=='daily' and name=='core-finance': containers[0]['resources']['limits']['cpu']='1000m'
    add('Deployment',name,dict(replicas=1,selector=dict(matchLabels=dict(app=name)),strategy=dict(type='Recreate'),template=dict(metadata=dict(labels=dict(app=name,**{'app.kubernetes.io/part-of':'ledgerline'})),spec=dict(automountServiceAccountToken=False,terminationGracePeriodSeconds=30,securityContext=dict(seccompProfile=dict(type='RuntimeDefault')),containers=containers,volumes=[dict(name='otel-config',configMap=dict(name='otel-agent'))]))),api='apps/v1')

for name,image,memory,port in [('gateway','envoyproxy/envoy:v1.33-latest',96,30088),('web','ledgerline/web:dev',64,30080)]:
    ports=[dict(name='http',port=8080,targetPort=8080,nodePort=port)]
    if name=='gateway': ports.append(dict(name='metrics',port=9901,targetPort=9901,nodePort=30089))
    add('Service',name,dict(type='NodePort',selector=dict(app=name),ports=ports))
    container=dict(name=name,image=image,imagePullPolicy='IfNotPresent' if name=='gateway' else 'Never',ports=[dict(containerPort=8080)],resources=resources(memory,32),securityContext=safe)
    volumes=[]
    if name=='gateway':
        container['args']=['envoy','-c','/etc/envoy/envoy.yaml','--concurrency','2']
        container['securityContext']=dict(**safe,runAsUser=10001,runAsNonRoot=True)
        container['volumeMounts']=[dict(name='config',mountPath='/etc/envoy',readOnly=True)]
        volumes=[dict(name='config',configMap=dict(name='gateway'))]
        container['readinessProbe']=dict(httpGet=dict(path='/ready',port=9901),periodSeconds=10)
    else:
        container['readinessProbe']=probe('/health');container['livenessProbe']=probe('/health')
        container['volumeMounts']=[dict(name='runtime',mountPath='/usr/share/nginx/html/runtime.json',subPath='runtime.json',readOnly=True)]
        volumes=[dict(name='runtime',configMap=dict(name='web-runtime'))]
    add('Deployment',name,dict(replicas=1,selector=dict(matchLabels=dict(app=name)),strategy=dict(type='Recreate'),template=dict(metadata=dict(labels=dict(app=name)),spec=dict(automountServiceAccountToken=False,containers=[container],volumes=volumes))),api='apps/v1')

add('ServiceAccount','fluent-bit')
add('Role','log-metadata',dict(),api='rbac.authorization.k8s.io/v1',rules=[dict(apiGroups=[''],resources=['pods'],verbs=['get','list','watch'])]).pop('spec',None)
add('RoleBinding','log-metadata',api='rbac.authorization.k8s.io/v1',roleRef=dict(apiGroup='rbac.authorization.k8s.io',kind='Role',name='log-metadata'),subjects=[dict(kind='ServiceAccount',name='fluent-bit',namespace=namespace)])
fluent='''[SERVICE]
    Flush 2
    Log_Level warn
    Parsers_File /fluent-bit/etc/parsers.conf
    HTTP_Server On
    HTTP_Listen 0.0.0.0
    HTTP_Port 2020
    Health_Check On
[INPUT]
    Name tail
    Path /var/log/containers/*_ledgerline-local_*.log
    Exclude_Path /var/log/containers/fluent-bit*_ledgerline-local_*.log
    Tag kube.*
    multiline.parser cri
    DB /buffers/tail.db
    Read_from_Head On
    Mem_Buf_Limit 5MB
    Skip_Long_Lines On
[FILTER]
    Name kubernetes
    Match kube.*
    Kube_Tag_Prefix kube.var.log.containers.
    Merge_Log Off
    Kube_Meta_Cache_TTL 60s
[OUTPUT]
    Name http
    Match *
    Host logstash
    Port 8080
    URI /
    Format json_lines
    Retry_Limit 5
'''
add('ConfigMap','fluent-bit',data={'fluent-bit.conf':fluent})
add('DaemonSet','fluent-bit',dict(selector=dict(matchLabels=dict(app='fluent-bit')),template=dict(metadata=dict(labels=dict(app='fluent-bit')),spec=dict(nodeSelector={'ledgerline-runtime':'paused'} if profile=='daily' else {},serviceAccountName='fluent-bit',tolerations=[dict(operator='Exists')],containers=[dict(name='fluent-bit',image='fluent/fluent-bit:4.0.3',args=['-c','/config/fluent-bit.conf'],resources=resources(96,32),securityContext=safe,ports=[dict(containerPort=2020)],readinessProbe=dict(httpGet=dict(path='/api/v1/health',port=2020),periodSeconds=10),volumeMounts=[dict(name='config',mountPath='/config',readOnly=True),dict(name='logs',mountPath='/var/log',readOnly=True),dict(name='buffers',mountPath='/buffers')])],volumes=[dict(name='config',configMap=dict(name='fluent-bit')),dict(name='logs',hostPath=dict(path='/var/log',type='Directory')),dict(name='buffers',emptyDir={})]))),api='apps/v1')
# kube-state-metrics reports actual Kubernetes object status, not synthetic health.
add('ServiceAccount','kube-state-metrics')
add('Role','kube-state-metrics',api='rbac.authorization.k8s.io/v1',rules=[dict(apiGroups=[''],resources=['pods'],verbs=['list','watch']),dict(apiGroups=['apps'],resources=['deployments','replicasets','daemonsets'],verbs=['list','watch'])])
add('RoleBinding','kube-state-metrics',api='rbac.authorization.k8s.io/v1',roleRef=dict(apiGroup='rbac.authorization.k8s.io',kind='Role',name='kube-state-metrics'),subjects=[dict(kind='ServiceAccount',name='kube-state-metrics',namespace=namespace)])
add('Service','kube-state-metrics',dict(type='NodePort',selector=dict(app='kube-state-metrics'),ports=[dict(name='metrics',port=8080,targetPort=8080,nodePort=30090)]))
add('Deployment','kube-state-metrics',dict(replicas=1,selector=dict(matchLabels=dict(app='kube-state-metrics')),template=dict(metadata=dict(labels=dict(app='kube-state-metrics')),spec=dict(serviceAccountName='kube-state-metrics',containers=[dict(name='kube-state-metrics',image='registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.15.0',args=[f'--namespaces={namespace}','--resources=pods,deployments,replicasets,daemonsets'],resources=resources(64,24),securityContext=safe,ports=[dict(containerPort=8080)],readinessProbe=dict(httpGet=dict(path='/healthz',port=8080),periodSeconds=10))]))),api='apps/v1')
# Restart only workloads whose mounted configuration or environment changed.
# EndpointSlice address updates do not require restarting every application.
config_by_name = {item['metadata']['name']: item for item in items if item['kind']=='ConfigMap'}
secret_by_name = {item['metadata']['name']: item for item in items if item['kind']=='Secret'}
for item in items:
    if item['kind'] != 'Deployment': continue
    template = item['spec']['template']
    dependencies = []
    for container in template['spec']['containers']:
        for source in container.get('envFrom', []):
            if 'secretRef' in source:
                dependencies.append(secret_by_name[source['secretRef']['name']]['stringData'])
    for volume in template['spec'].get('volumes', []):
        if 'configMap' in volume:
            dependencies.append(config_by_name[volume['configMap']['name']]['data'])
    digest = hashlib.sha256(json.dumps(dependencies, sort_keys=True).encode()).hexdigest()
    template['metadata'].setdefault('annotations', {})['ledgerline.local/config-checksum'] = digest
(generated/'resources.json').write_text(json.dumps(dict(apiVersion='v1',kind='List',items=items),indent=2),encoding='utf-8')
print(f'Rendered {len(items)} {profile} local resources. Credentials remain in ignored generated files.')
