"""Create Elasticsearch retention/mappings and useful Kibana log views via local APIs."""
import json, time, urllib.request, urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def request(base,path,body=None,method=None):
    payload=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base+path,payload,{'Content-Type':'application/json','kbn-xsrf':'ledgerline'},method=method or ('POST' if body is not None else 'GET'))
    with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
es='http://localhost:9200';kibana='http://localhost:5601'
for name,base,path in [('Elasticsearch',es,'/_cluster/health'),('Kibana',kibana,'/api/status')]:
    for attempt in range(150):
        try:request(base,path);break
        except (urllib.error.URLError,TimeoutError,ConnectionError):time.sleep(2)
    else:raise RuntimeError(f'{name} did not become ready')
request(es,'/_ilm/policy/ledgerline-local-retention',dict(policy=dict(phases=dict(delete=dict(min_age='3d',actions=dict(delete={}))))),'PUT')
request(es,'/_index_template/ledgerline-logs',dict(index_patterns=['ledgerline-logs-*'],priority=250,template=dict(settings={'number_of_shards':1,'number_of_replicas':0,'index.lifecycle.name':'ledgerline-local-retention'},mappings=dict(properties={'@timestamp':dict(type='date'),'service_name':dict(type='keyword'),'severity':dict(type='keyword'),'trace_id':dict(type='keyword'),'status':dict(type='integer'),'message':dict(type='text'),'app':dict(type='object',enabled=False)}))),'PUT')
# Existing daily index can predate provisioning; add retention without deleting logs.
try:request(es,'/ledgerline-logs-*/_settings',{'index.lifecycle.name':'ledgerline-local-retention','index.number_of_replicas':0},'PUT')
except urllib.error.HTTPError as error:
    if error.code!=404:raise

objects=[]
objects.append(dict(type='index-pattern',id='ledgerline-log-view',attributes=dict(title='ledgerline-logs-*',timeFieldName='@timestamp'),references=[]))
objects.append(dict(type='search',id='ledgerline-log-stream',attributes=dict(title='Ledgerline / Searchable log stream',description='Filter service_name, severity, status and trace_id. Never log credentials or finance request bodies.',columns=['service_name','severity','status','trace_id','message'],sort=[['@timestamp','desc']],kibanaSavedObjectMeta=dict(searchSourceJSON=json.dumps(dict(indexRefName='kibanaSavedObjectMeta.searchSourceJSON.index',query=dict(query='',language='kuery'),filter=[])))),references=[dict(name='kibanaSavedObjectMeta.searchSourceJSON.index',type='index-pattern',id='ledgerline-log-view')]))
for identifier,title,field in [('ledgerline-log-services','Log events by service','service_name'),('ledgerline-log-severity','Log events by severity','severity')]:
    spec={'$schema':'https://vega.github.io/schema/vega-lite/v5.json','description':title,'data':{'url':{'%context%':True,'%timefield%':'@timestamp','index':'ledgerline-logs-*','body':{'size':0,'aggs':{'groups':{'terms':{'field':field,'size':20}}}}},'format':{'property':'aggregations.groups.buckets'}},'mark':{'type':'bar','color':'#47752a'},'encoding':{'y':{'field':'key','type':'nominal','title':None,'sort':'-x'},'x':{'field':'doc_count','type':'quantitative','title':'Log events'}},'width':'container','height':'container'}
    state=dict(title=title,type='vega',params=dict(spec=json.dumps(spec)),aggs=[])
    objects.append(dict(type='visualization',id=identifier,attributes=dict(title=title,visState=json.dumps(state),uiStateJSON='{}',kibanaSavedObjectMeta=dict(searchSourceJSON='{}')),references=[]))
panels=[];references=[]
for index,(identifier,kind,x,y,w,h) in enumerate([('ledgerline-log-services','visualization',0,0,24,15),('ledgerline-log-severity','visualization',24,0,24,15),('ledgerline-log-stream','search',0,15,48,22)]):
    name=f'panel_{index}'
    panels.append(dict(panelIndex=str(index),type=kind,panelRefName=name,embeddableConfig={},gridData=dict(x=x,y=y,w=w,h=h,i=str(index))))
    references.append(dict(name=name,type=kind,id=identifier))
objects.append(dict(type='dashboard',id='ledgerline-logs',attributes=dict(title='Ledgerline / Application logs',description='Real Compose and Kubernetes logs. Filter service_name, severity, status or trace_id; time range defaults to the last hour.',panelsJSON=json.dumps(panels),optionsJSON=json.dumps(dict(useMargins=True,syncColors=True,hidePanelTitles=False)),timeRestore=True,timeFrom='now-1h',timeTo='now',refreshInterval=dict(pause=False,value=15000),kibanaSavedObjectMeta=dict(searchSourceJSON=json.dumps(dict(query=dict(query='',language='kuery'),filter=[])))),references=references))
response=request(kibana,'/api/saved_objects/_bulk_create?overwrite=true',objects)
errors=[item for item in response.get('saved_objects',[]) if 'error' in item]
if errors:raise RuntimeError(f'Kibana provisioning failed: {errors}')
request(kibana,'/api/kibana/settings',dict(changes={'defaultIndex':'ledgerline-log-view'}))
directory=root/'observability/kibana';directory.mkdir(exist_ok=True)
(directory/'saved-objects.json').write_text(json.dumps(objects,indent=2))
print('Elasticsearch three-day retention and Kibana log dashboard/search view provisioned.')
