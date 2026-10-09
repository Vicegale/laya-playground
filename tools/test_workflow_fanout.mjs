import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeWorkflow, WorkflowExecutionError } from '../static/workflow-runtime.js';
import { fieldCatalog } from '../static/workflow-field-schema.js';
import { parseCSV } from '../static/workflow-csv.js';

const n = (id, type, config = {}) => ({ id, label: id, type, config });
const e = (from, to, fromPort = 'next') => ({ id: `${from}-${fromPort}-${to}`, from, to, fromPort });
const set = (id, path, value) => n(id,'set',{assignments:[{path,value}]});
const fields = (wf, id, path = []) => new Map(fieldCatalog({workflow:wf,nodeId:id,path,input:{text:'review'}}).map(f=>[f.path,f]));
const basic = {nodes:[n('in','input'),set('a','sentiment','positive'),set('b','topic','quality'),n('join','output',{format:'fields',columns:[{name:'sentiment',value:'{{sentiment}}'},{name:'topic',value:'{{topic}}'}]})],edges:[e('in','a'),e('in','b'),e('a','join'),e('b','join')]};
const result = await executeWorkflow(basic,{text:'review'});
assert.deepEqual(result.output,{sentiment:'positive',topic:'quality'});
assert.equal(result.trace.filter(t=>t.nodeId==='join').length,1);
assert.deepEqual(result.trace[0].edgeIds,['in-next-a','in-next-b']);
assert.deepEqual(result.trace[0].nextNodes.map(n=>n.id),['a','b']);
assert.equal(result.trace.find(t=>t.nodeId==='b').scope.variables.sentiment,undefined,'Sibling scopes are isolated');
assert.deepEqual(result.trace.at(-1).scope.variables,{sentiment:'positive',topic:'quality'});
assert.equal(result.outputs.length,1);
assert.equal(fields(basic,'join').get('sentiment').conditional,false);
assert.equal(fields(basic,'join').get('topic').conditional,false);

const terminals = {nodes:[n('in','input'),set('a','private','first'),n('left','output',{value:'{{private}}'}),n('right','output',{value:'{{input}}'})],edges:[e('in','a'),e('in','right'),e('a','left')]};
const separate = await executeWorkflow(terminals,'second');
assert.deepEqual(new Set(separate.output),new Set(['first','second']));
assert.equal(separate.outputs.length,2);
assert.ok(separate.trace.find(t=>t.nodeId==='right').scope.variables.private===undefined);
assert.ok(separate.trace.some(t=>t.nodeId==='left'),'An earlier terminal does not cancel other branches');
assert.equal(separate.outputs.find(t=>t.nodeId==='left').value,'first');

const long = structuredClone(basic);
long.nodes.push(set('long','extra','third'));
long.edges = [e('in','a'),e('in','b'),e('a','long'),e('long','join'),e('b','join')];
const joined = await executeWorkflow(long,{});
assert.equal(joined.trace.at(-1).nodeId,'join');
assert.deepEqual(joined.trace.at(-1).scope.variables,{sentiment:'positive',topic:'quality',extra:'third'});
assert.equal(joined.trace.filter(t=>t.nodeId==='join').length,1);

// Unselected alternatives settle without executing or blocking shared nodes.
const conditional = {nodes:[n('in','input'),n('gate','condition',{conditions:[{left:'input.flag',op:'eq',right:'true'}]}),set('yes','chosen','yes'),set('no','chosen','no'),set('side','extra','side'),n('join','output',{value:'{{chosen}}'})],edges:[e('in','gate'),e('in','side'),e('gate','yes','true'),e('gate','no','false'),e('yes','join'),e('no','join'),e('side','join')]};
for(const flag of [true,false]) {
  const run=await executeWorkflow(conditional,{flag});
  assert.equal(run.output,flag?'yes':'no');
  assert.equal(run.context.vars.extra,'side');
  assert.ok(!run.trace.some(t=>t.nodeId===(flag?'no':'yes')));
  assert.equal(run.trace.filter(t=>t.nodeId==='join').length,1);
}
const samePort = structuredClone(basic);
samePort.nodes[0]=n('in','condition',{conditions:[{left:'input',op:'exists'}]});
samePort.edges=[e('in','a','true'),e('in','b','true'),e('a','join'),e('b','join')];
assert.deepEqual((await executeWorkflow(samePort,{})).output,{sentiment:'positive',topic:'quality'});
assert.equal(fields(samePort,'join').get('sentiment').conditional,false);

// Branch writes merge at field level, and conflicting values fail at the join.
const nested = {nodes:[n('in','input'),set('a','tags.sentiment','positive'),set('b','tags.topic','quality'),n('join','output',{value:'{{tags}}'})],edges:[e('in','a'),e('in','b'),e('a','join'),e('b','join')]};
assert.deepEqual((await executeWorkflow(nested,{})).output,{sentiment:'positive',topic:'quality'});
assert.equal(fields(nested,'join').get('tags.sentiment').conditional,false);
const conflict=structuredClone(nested);conflict.nodes[2].config.assignments=[{path:'tags.sentiment',value:'negative'}];
await assert.rejects(executeWorkflow(conflict,{}),error=>{
  assert.ok(error instanceof WorkflowExecutionError);
  assert.equal(error.step.nodeId,'join');
  assert.equal(error.step.mergeConflict.path,'vars.tags.sentiment');
  assert.deepEqual(error.step.mergeConflict.nodes,['a','b']);
  assert.equal(error.trace.filter(t=>t.type==='set'&&t.status==='success').length,2);
  return /conflicting.*vars.tags.sentiment/.test(error.message);
});
const same = structuredClone(conflict);same.nodes[2].config.assignments[0].value='positive';
assert.deepEqual((await executeWorkflow(same,{})).output,{sentiment:'positive'});
const sequential = {nodes:[n('in','input'),set('a','score','1'),set('b','score','2'),n('join','output',{value:'{{score}}'})],edges:[e('in','a'),e('a','b'),e('a','join'),e('b','join')]};
assert.equal((await executeWorkflow(sequential,{})).output,2,'Causally later writes replace inherited values');
const overwritten = {nodes:[n('in','input'),set('a','x','1'),set('later','x','2'),set('b','x','2'),n('join','output',{value:'{{x}}'})],edges:[e('in','a'),e('in','b'),e('a','later'),e('later','join'),e('b','join')]};
assert.equal((await executeWorkflow(overwritten,{})).output,2,'Superseded ancestor writes cannot create a false conflict');

// Duplicate wires do not execute a shared target twice; unreachable sources do
// not block it, and terminal outgoing edges remain ignored.
const duplicate=structuredClone(basic);duplicate.nodes.push(set('orphan','unused','x'));duplicate.edges.push({...e('in','a'),id:'duplicate'},e('orphan','join'),e('join','orphan'));
const duplicateRun=await executeWorkflow(duplicate,{});
assert.equal(duplicateRun.trace.filter(t=>t.nodeId==='a').length,1);
assert.equal(duplicateRun.trace.filter(t=>t.nodeId==='join').length,1);
assert.ok(!duplicateRun.trace.some(t=>t.nodeId==='orphan'));

const csvs={nodes:[n('in','input'),n('one','csv-output',{source:'{{input}}',filename:'one.csv',bom:false}),n('two','csv-output',{source:'{{input}}',filename:'two.csv',bom:false})],edges:[e('in','one'),e('in','two')]};
const exported=await executeWorkflow(csvs,[{id:'001',text:'hello'}]);
assert.deepEqual(exported.files.map(f=>f.filename),['one.csv','two.csv']);
assert.equal(exported.outputs.length,2);
assert.ok(exported.files.every(f=>parseCSV(f.content).rows[0].id==='001'));
const dangling={nodes:[n('in','input'),set('stop','x','1'),n('out','output',{value:'done'})],edges:[e('in','stop'),e('in','out')]};
assert.equal((await executeWorkflow(dangling,{})).output,'done','An unwired branch does not discard other outputs');
assert.equal((await executeWorkflow(dangling,{})).trace.find(t=>t.nodeId==='stop').status,'warning');

// Decisions fan out only their selected port. A Map can combine two independent
// classifications into one enriched row, without leaking between items.
const decision=(id,key)=>n(id,'decision',{key,state:'{{item.text}}',options:[{key:'yes'},{key:'no'}]});
const body={nodes:[n('bi','input'),decision('sentiment','sentiment'),decision('topic','topic'),n('bo','output',{format:'fields',columns:[{name:'sentiment',value:'{{decisions.sentiment.choice}}'},{name:'topic',value:'{{decisions.topic.choice}}'}]})],edges:[e('bi','sentiment'),e('bi','topic'),e('sentiment','bo','yes'),e('sentiment','bo','no'),e('topic','bo','yes'),e('topic','bo','no')]};
const mapped={nodes:[n('in','input'),n('map','map',{source:'{{input}}',mode:'workflow',resultAs:'tagged',keepOriginal:true,workflow:body}),n('out','csv-output',{source:'{{tagged}}',bom:false})],edges:[e('in','map'),e('map','out','done')]};
const calls=[];
const predict=async req=>{const key=Object.keys(req.questions)[0];calls.push([key,req.state]);return {answers:{[key]:{choice:req.state==='good'?'yes':'no',confidence:.9}}};};
const tagged=await executeWorkflow(mapped,[{id:'001',text:'good'},{id:'002',text:'bad'}],{predict});
assert.deepEqual(tagged.output,[{id:'001',text:'good',sentiment:'yes',topic:'yes'},{id:'002',text:'bad',sentiment:'no',topic:'no'}]);
assert.deepEqual(calls,[['sentiment','good'],['topic','good'],['sentiment','bad'],['topic','bad']]);
assert.equal(tagged.trace.filter(t=>t.nodeId==='bo').length,2);
assert.ok(tagged.trace.filter(t=>t.nodeId==='topic').every(t=>!t.scope.decisions.sentiment),'A sibling Decision cannot read another sibling result');
assert.equal(parseCSV(tagged.files[0].content).rows.length,2);
assert.equal(fields(mapped,'bo',['map']).get('decisions.sentiment.choice').conditional,false);
assert.ok(!fields(mapped,'topic',['map']).has('decisions.sentiment.choice'));

const multiple=structuredClone(mapped);multiple.nodes[1].config.workflow={nodes:[n('bi','input'),n('first','output',{format:'json',value:'{}'}),n('second','output',{format:'json',value:'{}'})],edges:[e('bi','first'),e('bi','second')]};
await assert.rejects(executeWorkflow(multiple,[{id:'001'}]),error=>error.step.nodeId==='second' && /exactly one final Output/.test(error.message));
const cycle={nodes:[n('in','input'),set('a','x','1'),set('b','y','2')],edges:[e('in','a'),e('a','b'),e('b','a')]};
await assert.rejects(executeWorkflow(cycle,{}),error=>error.step.nodeId==='a' && /cycle.*For Each/.test(error.message));
const branchFailure=structuredClone(basic);branchFailure.nodes[2]=n('b','output',{format:'json',value:'{"bad": {{missing}}}'});
await assert.rejects(executeWorkflow(branchFailure,{}),error=>error.step.nodeId==='b' && error.trace.some(t=>t.nodeId==='a' && t.status==='success'));

// Prototype-like keys and deletion/type replacement retain safe object semantics.
const prototype=structuredClone(nested);prototype.nodes[1].config.assignments[0].path='__proto__.a';prototype.nodes[2].config.assignments[0].path='__proto__.b';prototype.nodes[3].config.value='{{vars.__proto__}}';
const safe=await executeWorkflow(prototype,{});
assert.deepEqual(safe.output,{a:'positive',b:'quality'});
assert.equal(Object.getPrototypeOf(safe.context.vars),Object.prototype);
const deletion={nodes:[n('in','input'),set('base','obj','{"a":1,"b":2}'),set('a','obj','{"a":3}'),set('b','extra','4'),n('join','output',{value:'{{obj}}'})],edges:[e('in','base'),e('base','a'),e('base','b'),e('a','join'),e('b','join')]};
assert.deepEqual((await executeWorkflow(deletion,{})).output,{a:3});
// The shipped 100-review workflow preserves every original cell and exports
// both independent classifications and confidences on every row.
const example = JSON.parse(await readFile(new URL('../examples/workflows/product-reviews-fanout.json', import.meta.url)));
let reviewCalls = 0;
const allReviews = await executeWorkflow(example.workflow, {}, { predict: async request => {
  reviewCalls++; const key = Object.keys(request.questions)[0];
  return { answers: { [key]: { choice: key === 'sentiment' ? 'positive' : 'quality', confidence: .8 } } };
} });
const originals = parseCSV(example.workflow.nodes[0].config.content).rows;
const rows = parseCSV(allReviews.files[0].content).rows;
assert.equal(reviewCalls, 200); assert.equal(rows.length, 100);
assert.equal(allReviews.trace.length, 403);
rows.forEach((row, i) => {
  for (const key of Object.keys(originals[i])) assert.equal(row[key], originals[i][key]);
  assert.equal(row.sentiment, 'positive'); assert.equal(row.topic, 'quality');
  assert.equal(row.sentiment_confidence, '0.8'); assert.equal(row.topic_confidence, '0.8');
});

const switched = structuredClone(basic);
switched.nodes[0] = n('in', 'switch', { value: '{{input}}', cases: [{ key: 'selected', value: 'go', format: 'text' }] });
switched.nodes.push(n('unused', 'output', {value:'never'}));
switched.edges = [e('in','a','selected'),e('in','b','selected'),e('in','unused','default'),e('a','join'),e('b','join')];
assert.deepEqual((await executeWorkflow(switched,'go')).output, {sentiment:'positive',topic:'quality'});
assert.equal((await executeWorkflow(switched,'stop')).output,'never');

const filter = {nodes:[n('in','input'),n('filter','filter',{source:'{{input}}',resultAs:'kept',mode:'workflow',workflow:{nodes:[n('bi','input'),set('a','left','true'),set('b','right','true'),n('bo','output',{format:'json',value:'{{left}}'})],edges:[e('bi','a'),e('bi','b'),e('a','bo'),e('b','bo')]}}),n('out','output',{value:'{{kept}}'})],edges:[e('in','filter'),e('filter','out','done')]};
assert.deepEqual((await executeWorkflow(filter,[1,2])).output,[1,2]);

const subflow={nodes:[n('in','input'),n('sub','subflow',{resultAs:'results',workflow:{nodes:[n('bi','input'),n('one','output',{format:'json',value:'{"tag":"a"}'}),n('two','output',{format:'json',value:'{"tag":"b"}'})],edges:[e('bi','one'),e('bi','two')]}}),n('out','output',{value:'{{results}}'})],edges:[e('in','sub'),e('sub','out','done')]};
assert.deepEqual((await executeWorkflow(subflow,{})).output,[{tag:'a'},{tag:'b'}]);
assert.equal(fields(subflow,'out').get('results').type,'array');
assert.ok(fields(subflow,'out').has('results[0].tag'));

const downstream = structuredClone(cycle); downstream.nodes.push(n('join','output')); downstream.edges.splice(1,0,e('in','join')); downstream.edges.push(e('b','join'));
await assert.rejects(executeWorkflow(downstream,{}),error=>['a','b'].includes(error.step.nodeId));
const independent=structuredClone(conflict);independent.nodes[3]=n('join','output',{value:'{{tags}}'});independent.nodes.push(n('other','output',{value:'{{tags}}'}));independent.edges=[e('in','a'),e('in','b'),e('a','join'),e('b','other')];
assert.equal((await executeWorkflow(independent,{})).outputs.length,2,'Distinct terminal scopes can use the same names independently');
console.log('Workflow fan-out, joins, isolated scopes, conflicts, nested decisions and multi-output checks passed.');
