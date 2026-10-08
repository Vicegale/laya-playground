import assert from 'node:assert/strict';
import { executeWorkflow } from '../static/workflow-runtime.js';
import { canvasLayout, TraceSelection } from '../static/workflow-canvas-model.js';

const n=(id,type,config={})=>({id,type,label:id,config,position:{x:0,y:0}});
const e=(a,p,b)=>({id:`${a}-${p}-${b}`,from:a,fromPort:p,to:b});
const cases=[{key:'support',value:'support'},{key:'billing',value:'billing'}];
const build=(config={})=>({name:'Switch',nodes:[n('in','input'),n('route','switch',{value:'{{input.value}}',cases,...config}),...['support','billing','default'].map(key=>n(key,'output',{value:key}))],edges:[e('in','next','route'),...['support','billing','default'].map(key=>e('route',key,key))]});
const options={predict:()=>{throw new Error('Switch must not call inference');}};
for (const [value,expected] of [['support','support'],['billing','billing'],['other','default'],['Support','default'],['','default'],[null,'default']]) {
  const result=await executeWorkflow(build(),{value},options);
  assert.equal(result.output,expected);
  const step=result.trace.find(t=>t.type==='switch');
  assert.equal(step.port,expected);
  assert.deepEqual(step.output,{value,case:expected,matched:expected!=='default'});
  assert.equal(step.references[0].path,'input.value');
  assert.equal(step.input,value);
}
// CSV strings and typed JSON values remain distinct; templates retain types.
const typedCases=[{key:'support',format:'text',value:'42'},{key:'billing',format:'json',value:'42'}];
assert.equal((await executeWorkflow(build({cases:typedCases}),{value:'42'},options)).output,'support');
assert.equal((await executeWorkflow(build({cases:typedCases}),{value:42},options)).output,'billing');
for (const value of [true,false,0,null,'']) {
  const config={cases:[{key:'support',format:'json',value:JSON.stringify(value)}]};
  assert.equal((await executeWorkflow(build(config),{value},options)).output,'support');
}
assert.equal((await executeWorkflow(build({cases:[{key:'support',value:'{{input.expected}}'}]}),{value:false,expected:false},options)).output,'support');
const ordered=await executeWorkflow(build({cases:[{key:'support',value:'same'},{key:'billing',value:'same'}]}),{value:'same'},options);
assert.equal(ordered.output,'support');
assert.equal(ordered.trace[1].tests.length,1,'Stop evaluating cases after the first match');
assert.equal((await executeWorkflow(build({cases:[]}),{value:'x'},options)).output,'default');
assert.equal((await executeWorkflow(build({value:null,cases:[{key:'support',format:'json',value:'null'}]}),{},options)).output,'support');
for (const value of [undefined,{},[],Infinity]) {
  await assert.rejects(executeWorkflow(build(),{value},options),err=>err.step.type==='switch'&&/missing|expects/.test(err.message));
}
for (const [config,pattern] of [
  [{cases:[{key:'default',value:'x'}]},/reserved/],
  [{cases:[{key:'',value:'x'}]},/nonempty/],
  [{cases:[{key:'support',value:'x'},{key:' support ',value:'y'}]},/unique/],
  [{cases:[{key:'support',format:'json',value:'broken'}]},/invalid JSON/],
  [{cases:[{key:'support',format:'json',value:''}]},/invalid JSON/],
  [{cases:[{key:'support',format:'json',value:'[]'}]},/must resolve/],
  [{cases:[{key:'support',value:'{{input.missing}}'}]},/must resolve/],
  [{cases:[{key:'support',format:'bad',value:'x'}]},/unknown/],
  [{cases:{}},/must be a list/],
]) await assert.rejects(executeWorkflow(build(config),{value:'x'},options),pattern);
// An unmatched/default or unwired matched case never falls through to a next
// edge, another case or default. Nested Map reports the exact failing item.
const unwired=build();unwired.edges=unwired.edges.filter(e=>e.fromPort!=='support');unwired.edges.push(e('route','next','billing'));
const stopped=await executeWorkflow(unwired,{value:'support'},options);
assert.equal(stopped.output,undefined);
assert.equal(stopped.trace.at(-1).status,'warning');
assert.equal(stopped.trace.at(-1).port,'support');
const nested={nodes:[n('map','map',{source:'{{input.items}}',resultAs:'result',mode:'workflow',workflow:build() }),n('out','output',{value:'{{result}}'})],edges:[e('map','done','out')]};
const result=await executeWorkflow(nested,{items:[{value:'support'},{value:'billing'},{value:'other'}]},options);
assert.deepEqual(result.output,['support','billing','default']);
const select=new TraceSelection();select.update(result.trace);
assert.equal(select.step(['map'],'route').port,'default');
select.choose([],'map','0');assert.equal(select.step(['map'],'route').port,'support');
assert.equal(select.step(['map'],'billing'),null,'Other-item branches stay unselected');
await assert.rejects(executeWorkflow(nested,{items:[{value:'support'},{}]},options),err=>err.step.nodeId==='route'&&err.step.iterations[0].index===1&&err.step.references[0].missing);
const large=n('route','switch',{cases:Array.from({length:20},(_,i)=>({key:`case${i}`,value:String(i)}))});
assert.ok(canvasLayout({nodes:[large],edges:[]}).nodes[0].height>=30+21*18);
console.log('Workflow Switch exact routing, typed cases, default and nested diagnostics checks passed.');
