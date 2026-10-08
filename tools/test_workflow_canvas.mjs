import assert from 'node:assert/strict';
import { executeWorkflow } from '../static/workflow-runtime.js';
import { canvasLayout, nodeKey, TraceSelection, stepOutput } from '../static/workflow-canvas-model.js';

const n = (id, type, config = {}, x = 0, y = 0) => ({ id, label: id, type, config, position: { x, y } });
const e = (from, port, to) => ({ id: `${from}-${port}-${to}`, from, fromPort: port, to });
const inner = { nodes: [n('in','input'), n('out','output',{value:'{{item}}'},240)], edges:[e('in','next','out')] };
const root = { nodes:[n('in','input'), n('loop','foreach',{source:'{{input.items}}',workflow:inner},240),n('out','output',{},500)], edges:[e('in','next','loop'),e('loop','done','out')] };
const before = JSON.stringify(root);
const layout = canvasLayout(root);
assert.equal(layout.nodes.length, 5);
assert.equal(new Set(layout.nodes.map(r=>r.cellId)).size, 5);
assert.equal(JSON.stringify(root), before, 'Expansion must not alter authored positions or workflows');
const parent = layout.nodes.find(r=>r.node.id==='loop');
for (const child of layout.nodes.filter(r=>r.preview)) {
  assert.ok(child.x >= parent.x && child.x+child.width <= parent.x+parent.width);
  assert.ok(child.y >= parent.y+180 && child.y+child.height <= parent.y+parent.height);
}
const rootOutput = layout.nodes.find(r=>!r.preview&&r.node.id==='out');
assert.ok(rootOutput.x >= parent.x+parent.width+36, 'Expansion reserves space before following nodes');
const collapsed = canvasLayout(root,[],new Map([[nodeKey([],'loop'),false]]));
assert.equal(collapsed.nodes.length, 3);
const callers = {nodes:[n('one','subflow',{workflow:inner}),n('two','subflow',{workflow:inner},300)],edges:[]};
const duplicateBodies = canvasLayout(callers);
assert.equal(new Set(duplicateBodies.nodes.map(r=>r.cellId)).size, 6);
assert.equal(new Set(duplicateBodies.edges.map(r=>r.cellId)).size, 2);
assert.ok(canvasLayout({nodes:Array.from({length:300},(_,i)=>n(String(i),'set')),edges:[]}).omitted);

// Reused loop IDs and differing inner list lengths must not mix invocations.
const innerBody = { nodes:[n('out','output',{value:'{{item}}'})],edges:[] };
const outerBody = {nodes:[n('loop','foreach',{source:'{{item.values}}',workflow:innerBody,collectAs:'inner'}),n('end','output',{value:'{{inner}}'})],edges:[e('loop','done','end')]};
const nested = {nodes:[n('loop','foreach',{source:'{{input.items}}',workflow:outerBody,collectAs:'done'}),n('end','output',{value:'{{done}}'})],edges:[e('loop','done','end')]};
const result = await executeWorkflow(nested,{items:[{values:['a','b']},{values:['c']}]});
assert.deepEqual(result.output,[['a','b'],['c']]);
const selection = new TraceSelection(); selection.update(result.trace);
assert.equal(selection.step(['loop','loop'],'out').output,'c');
assert.equal(selection.picker([],'loop').options.length,2);
assert.equal(selection.picker(['loop'],'loop').options.length,1);
selection.choose([],'loop','0');
assert.equal(selection.step(['loop','loop'],'out').output,'b');
assert.equal(selection.picker(['loop'],'loop').options.length,2);
selection.choose(['loop'],'loop','0');
assert.equal(selection.step(['loop','loop'],'out').output,'a');
selection.choose([],'loop','1');
assert.equal(selection.step(['loop','loop'],'out').output,'c', 'Inner selection belongs to its outer invocation');
selection.choose([],'loop','0');
assert.equal(selection.step(['loop','loop'],'out').output,'a', 'Returning to an outer item restores its own inner selection');
const bStep=result.trace.find(t=>t.nodeId==='out'&&t.output==='b');
selection.reveal(bStep);
assert.equal(selection.step(['loop','loop'],'out').output,'b');
selection.choose([],'loop','latest');
assert.equal(selection.step(['loop','loop'],'out').output,'c');

// Branches belonging to other items must not be highlighted as executed.
const chooseBody={nodes:[n('rule','condition',{conditions:[{left:'item.keep',op:'eq',right:'true'}]}),n('yes','output',{format:'json',value:'true'}),n('no','output',{format:'json',value:'false'})],edges:[e('rule','true','yes'),e('rule','false','no')]};
const branchRoot={nodes:[n('loop','foreach',{source:'{{input.items}}',workflow:chooseBody})],edges:[]};
const branchRun=await executeWorkflow(branchRoot,{items:[{keep:true},{keep:false}]});
selection.reset();selection.update(branchRun.trace);
assert.equal(selection.step(['loop'],'yes'),null);
assert.deepEqual(stepOutput(selection.step(['loop'],'no')),{available:true,value:false});
selection.choose([],'loop','0');
assert.equal(selection.step(['loop'],'no'),null);
assert.equal(selection.step(['loop'],'yes').output,true);

const outputs=await executeWorkflow({nodes:[n('in','input'),n('set','set',{assignments:[{path:'value',value:'{{input.n}}'}]}),n('rule','condition',{conditions:[{left:'value',op:'gte',right:'1'}]}),n('out','output',{value:'{{value}}'})],edges:[e('in','next','set'),e('set','next','rule'),e('rule','true','out')]},{n:3});
assert.deepEqual(outputs.trace.map(t=>t.output),[{n:3},{value:3},true,3]);
assert.deepEqual(stepOutput({status:'running'}),{available:false});
console.log('Workflow canvas and item-selection checks passed.');
