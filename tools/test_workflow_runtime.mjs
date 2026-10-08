import assert from 'node:assert/strict';
import { executeWorkflow, getPath, renderTemplate, evalCondition } from '../static/workflow-runtime.js';

const edge = (from, port, to) => ({ id: `${from}-${port}-${to}`, from, fromPort: port, to });
const node = (id, type, config = {}) => ({ id, type, label: id, config, position: { x: 0, y: 0 } });

assert.equal(getPath({ input: { items: [{ x: 7 }] } }, 'input.items[0].x'), 7);
assert.equal(renderTemplate('hello {{input.name}}', { input: { name: 'world' } }), 'hello world');
assert.equal(evalCondition({ left: 'input.n', op: 'gte', right: '3' }, { input: { n: 4 } }), true);

const branch = {
  nodes: [node('in','input'), node('c','condition',{mode:'all',conditions:[{left:'input.n',op:'gte',right:'3'}]}), node('yes','output',{value:'yes'}), node('no','output',{value:'no'})],
  edges: [edge('in','next','c'), edge('c','true','yes'), edge('c','false','no')],
};
assert.equal((await executeWorkflow(branch, { n: 4 })).output, 'yes');
assert.equal((await executeWorkflow(branch, { n: 1 })).output, 'no');

const child = {
  nodes: [
    node('ci','input'),
    node('d','decision',{decisionType:'choice',key:'label',state:'{{item.text}}',question:'Which label?',options:[{key:'good',description:'positive'},{key:'bad',description:'negative'}]}),
    node('co','output',{format:'json',value:'{"text": {{item.text}}, "label": {{decisions.label.choice}}}'})
  ],
  edges: [edge('ci','next','d'), edge('d','good','co'), edge('d','bad','co')],
};
const loop = {
  nodes: [node('in','input'), node('loop','foreach',{source:'{{input.items}}',itemVar:'item',indexVar:'index',collectAs:'done',workflow:child}), node('out','output',{value:'{{done}}'})],
  edges: [edge('in','next','loop'), edge('loop','done','out')],
};
const calls = [];
const predict = async payload => {
  calls.push(payload);
  const q = Object.keys(payload.questions)[0];
  const choice = String(payload.state).includes('nice') ? 'good' : 'bad';
  return { answers: { [q]: { choice, probabilities: { good: choice === 'good' ? .9 : .1, bad: choice === 'bad' ? .9 : .1 } } } };
};
const loopResult = await executeWorkflow(loop, { items: [{ text:'nice' }, { text:'awful' }] }, { predict });
assert.deepEqual(loopResult.output, [{ text:'nice', label:'good' }, { text:'awful', label:'bad' }]);
assert.equal(calls.length, 2);
assert.equal(loopResult.trace.filter(t => t.type === 'decision').length, 2);

const noul = {
  nodes: [node('in','input'), node('d','decision',{decisionType:'noul',key:'ok',state:'{{input.text}}',question:'Is this true?',threshold:.7}), node('t','output',{value:'true'}), node('f','output',{value:'false'})],
  edges: [edge('in','next','d'), edge('d','true','t'), edge('d','false','f')],
};
const noulPredict = async payload => ({ answers: { ok: { noul: payload.state === 'yes' ? .8 : .6 } } });
assert.equal((await executeWorkflow(noul, { text:'yes' }, { predict:noulPredict })).output, 'true');
assert.equal((await executeWorkflow(noul, { text:'maybe' }, { predict:noulPredict })).output, 'false');

const sub = { nodes:[node('i','input'),node('o','output',{format:'json',value:'{"name": {{input.name}}}'})], edges:[edge('i','next','o')] };
const parent = { nodes:[node('i','input'),node('s','subflow',{resultAs:'nested',workflow:sub}),node('o','output',{value:'{{nested}}'})], edges:[edge('i','next','s'),edge('s','done','o')] };
assert.deepEqual((await executeWorkflow(parent,{name:'Ada'})).output,{name:'Ada'});

console.log('workflow runtime tests passed');
