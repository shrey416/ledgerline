"""Run against the local forwarded gateway after startup."""
import json
import urllib.request
import urllib.error
BASE = 'http://localhost:30088'
def call(path, body=None):
    request=urllib.request.Request(BASE+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=20) as response:
        return json.load(response)
assert call('/api/v1/capture/suggest',{'description':'Zomato lunch'})['category']=='Dining'
assert call('/api/v1/capture/suggest',{'description':'unmatched xyz'})['category']=='Other'
conversion=call('/api/v1/rates/convert?from=INR&to=USD&amount=850')
assert conversion['rate']>0 and abs(conversion['converted']-850*conversion['rate'])<=0.0051
assert conversion['source']=='ExchangeRate-API' and conversion['updatedAt']
assert call('/api/v1/rates/convert?from=USD&to=USD&amount=12.34')['converted']==12.34
try:
    call('/api/v1/rates/convert?from=INR&to=XXX&amount=850')
    raise AssertionError('Unsupported currency accepted')
except urllib.error.HTTPError as error:
    assert error.code==400
report=call('/api/v1/analytics/report',{'entries':[{'category':'Dining','kind':'expense','amount':'125.50'},{'category':'Dining','kind':'expense','amount':'24.50'}]})
assert len(report['data'])==1 and report['data'][0]['total']=='150'
assert call('/api/v1/analytics/report',{'entries':[]})['data']==[]
print('PASS: MongoDB categorization, Redis conversion, ClickHouse aggregation and empty report; invalid currency rejected.')
