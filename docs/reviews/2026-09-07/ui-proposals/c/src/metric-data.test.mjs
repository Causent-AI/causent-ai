import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,mapObservations,makeMetric,summarize,estimateTarget,chartSVG} from './metric-data.mjs';
const rows=n=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10),value:i+1}));
test('CSV handles quoted headers, escaped quotes, CRLF, and BOM',()=>{
  const parsed=parseCSV('\uFEFF"day","metric, value",note\r\n2026-09-01,0.5,"a ""quote"""\r\n');
  assert.deepEqual(parsed.headers,['day','metric, value','note']);
  assert.equal(parsed.rows[0][2],'a "quote"');
  assert.deepEqual(mapObservations(parsed,'day','metric, value','percent','ratio'),[{date:'2026-09-01',value:50}]);
});
test('Malformed or ambiguous CSV fails before import',()=>{
  for(const csv of ['date,date\n2026-09-01,2','date,value\n2026-09-01','date,value\n"2026-09-01,2'])assert.throws(()=>parseCSV(csv));
  for(const csv of ['date,value\n2026-02-30,2','date,value\n2026-09-01,2\n2026-09-01,3','date,value\n2026-09-01,','date,value\n2026-09-01,1e999'])assert.throws(()=>mapObservations(parseCSV(csv),'date','value'));
  assert.throws(()=>mapObservations(parseCSV('date,value\n2026-09-01,101'),'date','value','percent','points'));
});
test('Summary requires complete calendar windows and handles zero denominators',()=>{
  const full=rows(28),result=summarize(full);assert.equal(result.l7,25);assert.equal(result.l28,14.5);assert.ok(Math.abs(result.wow-(25/18-1)*100)<1e-10);
  const gap=full.filter((_,i)=>i!==25);assert.equal(summarize(gap).l7,null);assert.equal(summarize(gap).l28,null);assert.equal(summarize(gap).wow,null);
  const zeros=rows(14).map(o=>({...o,value:0}));assert.equal(summarize(zeros).wow,null);
});
test('Estimates distinguish relative percentages and points without inventing targets',()=>{
  const metric=makeMetric({name:'Activation',unit:'percent',observations:[{date:'2026-09-01',value:40}]});
  assert.equal(estimateTarget(metric,10,'relative'),44);assert.equal(estimateTarget(metric,10,'points'),50);
  assert.throws(()=>estimateTarget(metric,'','relative'));assert.throws(()=>estimateTarget(metric,70,'points'));
  assert.throws(()=>estimateTarget({...metric,latest:0},10,'relative'));
});
test('Charts remain finite for a constant or single-point series and escape names',()=>{
  const metric=makeMetric({name:'<script>alert(1)</script>',observations:[{date:'2026-09-01',value:0}]});
  for(const type of ['line','bar']){const chart=chartSVG(metric,type);assert.doesNotMatch(chart,/NaN|Infinity|<script>/);assert.match(chart,/&lt;script&gt;/);}
});
test('AI planning cost uses explicit token rates and rejects incomplete assumptions',async()=>{
  const {estimateAICost}=await import('./metric-data.mjs');
  const budget={inputTokens:40000,outputTokens:12000,inputRate:5,outputRate:25,passes:2};
  assert.deepEqual(estimateAICost(budget),{minimum:.5,maximum:1});
  assert.equal(estimateAICost({...budget,inputTokens:''}),null);
  assert.equal(estimateAICost({...budget,passes:0}),null);
  assert.equal(estimateAICost({...budget,inputRate:-1}),null);
});
