import assert from 'node:assert/strict';
import { executeWorkflow, getPath } from '../static/workflow-runtime.js';
import { listCountSummary } from '../static/workflow-diagnostics.js';
import { parseCSV } from '../static/workflow-csv.js';
import { TraceSelection } from '../static/workflow-canvas-model.js';

const n=(id,type,config={})=>({id,type,label:id,config});
const e=(a,p,b)=>({id:`${a}-${p}-${b}`,from:a,fromPort:p,to:b});
const flow=(config={})=>({nodes:[n('group','groupby',{source:'{{input.items}}',key:'{{item.type}}',resultAs:'groups',...config}),n('out','output',{value:'{{groups}}'})],edges:[e('group','done','out')]});
const rows=[{id:'001',type:'support'},{id:'002',type:'billing'},{id:'003',type:'support'},{id:'004',type:'sales'}];
const original=structuredClone(rows);
const predict=()=>{throw new Error('Grouping must not call Laya');};
const result=await executeWorkflow(flow(),{items:rows},{predict});
assert.deepEqual(result.output,[{key:'support',items:[rows[0],rows[2]],count:2},{key:'billing',items:[rows[1]],count:1},{key:'sales',items:[rows[3]],count:1}]);
assert.deepEqual(result.trace[0].listCounts,{input:4,output:3,processed:4,inputUnit:'items',outputUnit:'groups'});
assert.equal(listCountSummary(result.trace[0]),'4 items in → 3 groups out');
assert.deepEqual(rows,original);
result.output[0].items[0].id='changed';assert.deepEqual(rows,original,'Grouped items are detached from their source');
const typed=await executeWorkflow(flow({key:'{{item}}'}),{items:[42,'42',false,'false',null,'','__proto__','constructor',42]},{predict});
assert.deepEqual(typed.output.map(g=>[g.key,g.count]),[[42,2],['42',1],[false,1],['false',1],[null,1],['',1],['__proto__',1],['constructor',1]]);
assert.equal(Object.prototype.polluted,undefined);
assert.deepEqual((await executeWorkflow(flow({key:null}),{items:[1,2]},{predict})).output,[{key:null,items:[1,2],count:2}]);
assert.deepEqual((await executeWorkflow(flow(),{items:[]},{predict})).output,[]);
assert.equal(listCountSummary((await executeWorkflow(flow(),{items:[]},{predict})).trace[0]),'0 items in → 0 groups out');
const compound=await executeWorkflow(flow({key:'{{parentInput.prefix}}/{{input.type}}'}),{prefix:'team',items:rows},{predict});
assert.equal(compound.output[0].key,'team/support');
for (const [items,key,pattern] of [
  [[rows[0],{}],'{{item.type}}',/item 2.*missing/],
  [[{}],'prefix-{{item.type}}',/item 1.*missing/],
  [[{}],'{{item}}',/item 1.*must be/],
  [[[]],'{{item}}',/item 1.*must be/],
  [[NaN],'{{item}}',/item 1.*must be/],
]) await assert.rejects(executeWorkflow(flow({key}),{items},{predict}),error=>{
  const step=error.step;
  assert.equal(step.nodeId,'group');
  assert.ok(step.groupingFailure);
  if(items.length===2) {
    assert.equal(step.groupingFailure.index,1);
    assert.equal(step.listCounts.processed,1);
    assert.equal(step.grouping.groups[0].count,1);
    assert.equal(listCountSummary(step),'2 items in → 1 group produced · 1/2 processed');
  }
  return pattern.test(error.message);
});
await assert.rejects(executeWorkflow(flow(),{items:{}},{predict}),/expected an array/);
await assert.rejects(executeWorkflow(flow({resultAs:''}),{items:rows},{predict}),/Store groups as/);
const context={input:{items:[rows[0],{}]},vars:{groups:'unchanged'},locals:{},decisions:{}};
await assert.rejects(executeWorkflow(flow(),context,{predict}),/missing/);
assert.equal(context.vars.groups,'unchanged','Partial groups are not published on failure');
// Full counts remain accurate beyond preview limits without one trace per row.
const many=Array.from({length:2000},(_,i)=>({id:i,type:`type${i%25}`}));
const large=await executeWorkflow(flow(),{items:many},{predict});
assert.equal(large.trace.length,2);
assert.equal(large.output.length,25);
assert.equal(large.output.reduce((sum,g)=>sum+g.count,0),2000);
assert.equal(large.trace[0].grouping.groupCount,25);
assert.equal(large.trace[0].grouping.groups.length,12);
assert.equal(large.trace[0].grouping.groupsOmitted,13);
assert.ok(large.trace[0].grouping.groups.every(g=>g.count===80));
assert.ok(large.trace[0].output.length<25);
assert.ok(large.trace[0].references.length<=2,'Key reference previews are sampled, not multiplied per row');
// One CSV per group retains all rows/columns and supports normal item pickers.
const exported={nodes:[n('csv','csv',{content:'id,type\n001,support\n002,billing\n003,support\n',resultAs:'rows'}),n('group','groupby',{source:'{{rows}}',key:'{{item.type}}',resultAs:'groups'}),n('each','foreach',{source:'{{groups}}',itemVar:'group',collectAs:'files',workflow:{nodes:[n('csvout','csv-output',{source:'{{group.items}}',columns:'{{rowsCsv.columns}}',filename:'emails-{{group.key}}.csv'})],edges:[]}}),n('out','output',{value:'{{groups}}'})],edges:[e('csv','next','group'),e('group','done','each'),e('each','done','out')]};
const files=await executeWorkflow(exported,{}, {predict});
assert.deepEqual(files.files.map(f=>[f.filename,f.rowCount]),[['emails-support.csv',2],['emails-billing.csv',1]]);
assert.deepEqual(parseCSV(files.files[0].content).rows,[{id:'001',type:'support'},{id:'003',type:'support'}]);
const selection=new TraceSelection();selection.update(files.trace);
assert.equal(selection.step(['each'],'csvout').file.filename,'emails-billing.csv');
selection.choose([],'each','0');assert.equal(selection.step(['each'],'csvout').file.filename,'emails-support.csv');
// Group By in a nested Map remains isolated per outer item and portable.
const nested={nodes:[n('map','map',{source:'{{input.items}}',resultAs:'mapped',mode:'workflow',workflow:flow({source:'{{item.values}}',key:'{{item}}'})}),n('out','output',{value:'{{mapped}}'})],edges:[e('map','done','out')]};
const nestedRun=await executeWorkflow(JSON.parse(JSON.stringify(nested)),{items:[{values:['a','a']},{values:['b']}]},{predict});
assert.deepEqual(nestedRun.output,[[{key:'a',items:['a','a'],count:2}],[{key:'b',items:['b'],count:1}]]);
selection.reset();selection.update(nestedRun.trace);
assert.equal(selection.step(['map'],'group').grouping.groups[0].key,'b');
selection.choose([],'map','0');assert.equal(selection.step(['map'],'group').grouping.groups[0].key,'a');
// Direct keyed access returns full item arrays, including safe special names.
const keyed=await executeWorkflow(flow({outputFormat:'keyed'}),{items:rows},{predict});
assert.deepEqual(keyed.output,{support:[rows[0],rows[2]],billing:[rows[1]],sales:[rows[3]]});
assert.deepEqual(getPath(keyed.context.vars,'groups.support'),[rows[0],rows[2]]);
assert.equal(getPath(keyed.context.vars,'groups.support.length'),2);
assert.equal(getPath(keyed.context.vars,'groups.absent'),undefined);
assert.equal(keyed.trace[0].grouping.outputFormat,'keyed');
assert.equal(keyed.trace[0].grouping.groupCount,3);
assert.deepEqual((await executeWorkflow(flow({outputFormat:'keyed'}),{items:[]},{predict})).output,{});
const specialKeys=['__proto__','constructor','toString','feature.request','column[0]','',"O'Reilly"];
const special=await executeWorkflow(flow({outputFormat:'keyed',key:'{{item}}'}),{items:specialKeys},{predict});
assert.equal(Object.getPrototypeOf(special.output),Object.prototype);
for (const key of specialKeys) assert.deepEqual(getPath({groups:special.output},`groups[${JSON.stringify(key)}]`),[key]);
assert.deepEqual(JSON.parse(JSON.stringify(special.output)),special.output);
assert.equal(Object.prototype.polluted,undefined);
for (const keys of [[42,'42'],[true,'true'],[null,'null']]) {
  await assert.rejects(executeWorkflow(flow({outputFormat:'keyed',key:'{{item}}'}),{items:keys},{predict}),error=>{
    assert.equal(error.step.groupingFailure.index,1);
    assert.equal(error.step.listCounts.processed,1);
    return /different typed keys.*Group list/.test(error.message);
  });
}
assert.deepEqual((await executeWorkflow(flow({outputFormat:'keyed',key:'{{item}}'}),{items:[42,42,false,null]},{predict})).output,{'42':[42,42],false:[false],null:[null]});
await assert.rejects(executeWorkflow(flow({outputFormat:'invalid'}),{items:rows},{predict}),/output format/);
const bucketCSV={nodes:[n('group','groupby',{source:'{{input.items}}',key:'{{item.type}}',resultAs:'groups',outputFormat:'keyed'}),n('csvout','csv-output',{source:'{{groups.support}}',columns:'["id","type"]',filename:'support.csv'})],edges:[e('group','done','csvout')]};
const bucketExport=await executeWorkflow(JSON.parse(JSON.stringify(bucketCSV)),{items:rows},{predict});
assert.deepEqual(parseCSV(bucketExport.files[0].content).rows,[rows[0],rows[2]]);
const largeKeyed=await executeWorkflow(flow({outputFormat:'keyed'}),{items:many},{predict});
assert.equal(largeKeyed.output.type0.length,80);
assert.equal(Object.keys(largeKeyed.output).length,25);
assert.equal(Object.values(largeKeyed.output).flat().length,2000);
assert.equal(largeKeyed.trace[0].grouping.groupCount,25);
// Switching format is opt-in; old serialized definitions still return lists.
assert.ok(Array.isArray((await executeWorkflow(JSON.parse(JSON.stringify(flow())),{items:rows},{predict})).output));
console.log('Workflow Group By ordering, typed keys, counts, bounded diagnostics, nested scope and CSV export checks passed.');
