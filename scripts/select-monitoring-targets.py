"""Atomic Prometheus file discovery updates for the two local deployment modes."""
import json, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
mode=sys.argv[1]
services=['core-finance','capture-automation','rates-realtime','analytics','notifications']
node=json.loads((root/'infra/k8s/local/generated/network.json').read_text(encoding='utf-8-sig'))['nodeIP'] if mode=='kubernetes' else None
apps=[]; health=[]
for index,name in enumerate(services):
    address=f'{node}:{30081+index}' if node else f'{name}:8080'
    labels=dict(service=name,environment=mode)
    if index==0:labels['__metrics_path__']='/actuator/prometheus'
    apps.append(dict(targets=[address],labels=labels))
    health.append(dict(targets=[f'http://{address}'+('/actuator/health/readiness' if index==0 else '/health/ready')],labels=dict(service=name,environment=mode)))
directory=root/'observability/prometheus'
profile_file=root/'infra/local/runtime-profile.json'
profile=sys.argv[2] if len(sys.argv)>2 else json.loads(profile_file.read_text(encoding='utf-8-sig')).get('profile','daily') if profile_file.exists() else 'daily'
for filename,value in [('application-targets.json',apps),('health-targets.json',health),('kubernetes-targets.json',[dict(targets=[f'{node}:30090'],labels=dict(environment=mode))] if node else []),('gateway-targets.json',[dict(targets=[f'{node}:30089' if node else 'gateway:9901'])]),('telemetry-targets.json',[dict(targets=['tempo:3200'])] if profile=='full' else [])]:
    temp=directory/(filename+'.tmp');temp.write_text(json.dumps(value,indent=2));temp.replace(directory/filename)
print(f'Monitoring targets switched to {mode}.')
