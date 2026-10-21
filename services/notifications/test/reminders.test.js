import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferences, commitments, deliveryAt, jobId, message} from '../src/reminders.js';
test('delivery uses local 9am across DST and date boundaries',()=>{
  assert.equal(deliveryAt('2026-10-09',3,'Asia/Kolkata').toISOString(),'2026-10-06T03:30:00.000Z');
  assert.equal(deliveryAt('2026-03-09',0,'America/New_York').toISOString(),'2026-03-09T13:00:00.000Z');
  assert.equal(deliveryAt('2026-01-01',1,'Pacific/Auckland').toISOString(),'2025-12-30T20:00:00.000Z');
});
test('invalid recipients, impossible dates and duplicate source IDs rejected',()=>{
  assert.throws(()=>preferences({email:'a@b.com\r\nBcc:x@y.com',enabled:true,leadDays:3,timezone:'UTC'}));
  const item={id:'a',name:'Rent',amount:'5.50',due:'2026-02-30',kind:'bill',state:'open'};
  assert.throws(()=>commitments([item]));item.due='2026-03-01';assert.throws(()=>commitments([item,item]));
});
test('stable IDs deduplicate cycles while users and cycles remain isolated',()=>{
  const item={id:'rent',due:'2026-10-01'}, prefs={leadDays:3,timezone:'UTC'};
  assert.equal(jobId('a','personal',item,prefs),jobId('a','personal',item,prefs));
  assert.notEqual(jobId('a','personal',item,prefs),jobId('b','personal',item,prefs));
  assert.notEqual(jobId('a','personal',item,prefs),jobId('a','business',item,prefs));
  assert.match(message({name:'Rent',amount:'123.45',due:item.due,kind:'bill'},'personal').text,/will not charge/);
});
