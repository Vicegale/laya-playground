import assert from 'node:assert/strict';
import { executeWorkflow } from '../static/workflow-runtime.js';
import { fieldCatalog } from '../static/workflow-field-schema.js';
import { parseCSV } from '../static/workflow-csv.js';

const n = (id, type, config = {}) => ({ id, label: id, type, config });
const e = (from, to, fromPort = 'next') => ({ id: `${from}-${fromPort}-${to}`, from, to, fromPort });
const chain = (...nodes) => ({ nodes, edges: nodes.slice(1).map((node, i) => e(nodes[i].id, node.id, ['map','foreach','filter'].includes(nodes[i].type) ? 'done' : 'next')) });
const col = (name, value, transform = 'none') => ({ name, value, transform });
const catalog = (workflow, nodeId, options = {}) => new Map(fieldCatalog({ workflow, nodeId, input: {}, ...options }).map(f => [f.path, f]));
const csv = n('csv', 'csv', { resultAs: 'rows', content: 'id,email,score,active,type\r\n001, Ada@Example.COM ,0.94132,true,first\r\n002,Ben@EXAMPLE.COM,0.87321,false,second\r\n' });
const map = n('map', 'map', { source: '{{rows}}', resultAs: 'mapped', format: 'fields', keepOriginal: true, columns: [col('email', '{{item.email}}', 'lower'), col('score', '{{input.score}}', 'round'), col('active', '{{item.active}}', 'boolean'), col('position', '{{index}}')] });
const out = n('out', 'csv-output', { source: '{{mapped}}', columns: '{{rowsCsv.columns}}', filename: 'cleaned.csv', bom: false });
const workflow = chain(csv, map, out);
const result = await executeWorkflow(workflow, {});
assert.deepEqual(result.output, [{ id: '001', email: 'ada@example.com', score: .94, active: true, type: 'first', position: 0 }, { id: '002', email: 'ben@example.com', score: .87, active: false, type: 'second', position: 1 }]);
assert.deepEqual(parseCSV(result.files[0].content).columns, ['id','email','score','active','type','position']);
assert.equal(result.trace.find(t => t.type === 'map').listCounts.output, 2);
assert.equal(result.trace.find(t => t.type === 'map-value').references.find(r => r.path === 'item.email').value, ' Ada@Example.COM ');
assert.equal(csv.config.content.includes(' Ada@Example.COM '), true);

const project = columns => chain(n('in','input'), n('m','map',{ source:'{{input}}', resultAs:'mapped', format:'fields', columns }), n('out','output',{ value:'{{mapped}}' }));
const special = await executeWorkflow(project([col('__proto__', '{{item["odd.header"]}}'), col('constructor','{{item.type}}'), col('clean','{{item.text}}','trim'), col('upper','{{item.text}}','upper'), col('number','{{item.number}}','number')]), [{ 'odd.header':'safe', type:'real', text:' Hi ', number:'003' }]);
assert.equal(Object.getPrototypeOf(special.output[0]), Object.prototype);
assert.equal(Object.hasOwn(special.output[0], '__proto__'), true);
assert.equal(special.output[0].__proto__, 'safe');
assert.equal(special.output[0].constructor, 'real');
assert.equal(special.output[0].clean, 'Hi');
assert.equal(special.output[0].upper, 'HI');
assert.equal(special.output[0].number, 3);
for (const [columns, pattern] of [
  [[], /at least one/], [[col('', '{{item}}')], /choose an output name/],
  [[col('a',''), col('a','')], /repeated/], [[col('a','','nope')], /unknown transform/],
]) await assert.rejects(executeWorkflow(project(columns), []), pattern);
for (const [transform, input, pattern] of [
  ['number', '', /finite number/], ['number', null, /finite number/], ['number', true, /finite number/],
  ['number', 'Infinity', /finite number/], ['boolean', 'yes', /true.*false/], ['lower', 23, /text value/],
]) await assert.rejects(executeWorkflow(project([col('value','{{item}}',transform)]), [input]), pattern);
try { await executeWorkflow(project([col('score','{{item.score}}','number')]), [{score:'2'},{}]); assert.fail('Missing source must fail'); }
catch (error) { assert.match(error.message, /Column “score”.*missing/); assert.match(error.step.location,/item 2/); assert.equal(error.trace.filter(t=>t.type==='map-value' && t.status==='success').length,1); }

const decision = n('dec','decision',{ key:'tag', state:'{{item.text}}', options:[{key:'support'},{key:'other'}] });
const body = { nodes:[n('bi','input'),decision,n('bo','output',{format:'fields',columns:[col('email_type','{{decisions.tag.choice}}'),col('confidence','{{decisions.tag.confidence}}')]})], edges:[e('bi','dec'),e('dec','bo','support'),e('dec','bo','other')] };
const nested = chain(n('in','input'),n('map','map',{mode:'workflow',source:'{{input.items}}', resultAs:'tagged',keepOriginal:true,workflow:body}),n('out','csv-output',{source:'{{tagged}}',bom:false}));
const input = {items:[{id:'001',text:'Help'},{id:'002',text:'Other'}]};
const tagged = await executeWorkflow(nested,input,{ predict:async request=>({answers:{tag:{choice:request.state==='Help'?'support':'other',probabilities:{support:.9,other:.1}}}}) });
assert.deepEqual(tagged.output.map(r=>[r.id,r.email_type,r.confidence]),[['001','support',.9],['002','other',.1]]);
assert.deepEqual(input.items.map(r=>Object.keys(r)),[['id','text'],['id','text']]);
assert.equal(parseCSV(tagged.files[0].content).rows[0].email_type,'support');

// Known shapes and honest samples before any model runs.
let fields = catalog(nested,'map',{input});
assert.ok(![...fields.keys()].some(k=>k.includes('decisions.tag')), 'Body decisions are unavailable to the parent');
fields = catalog(nested,'dec',{input,path:['map']});
assert.equal(fields.get('item.text').sample,'Help');
assert.ok(!fields.has('decisions.tag.choice'),'A node cannot use its own future result');
fields = catalog(nested,'bo',{input,path:['map']});
assert.equal(fields.get('decisions.tag.choice').type,'string');
assert.equal(fields.get('decisions.tag.choice').hasSample,false);
assert.equal(fields.get('decisions.tag.confidence').type,'number | null');
assert.ok(fields.has('decisions.tag.probabilities.support'));
assert.equal(fields.get('item.text').sample,'Help');
fields = catalog(nested,'out',{input});
assert.ok(fields.has('tagged[0].email_type'));
assert.ok(fields.has('tagged[0].id'));
assert.ok(!fields.has('decisions.tag.choice'),'Body scope does not leak into parent');
assert.equal(fields.get('tagged[0].confidence').hasSample,false);
fields = catalog(workflow,'map',{perItem:true});
assert.equal(fields.get('item.email').sample,' Ada@Example.COM ');
assert.equal(fields.get('item.type').type,'string', 'CSV header type must not collide with schema metadata');
assert.match(fields.get('item.email').origin,/CSV preview/);
assert.ok(!catalog(workflow,'map').has('item.email'),'Map source field picker uses incoming scope');
fields = catalog(workflow,'out');
assert.equal(fields.get('mapped[0].active').type,'boolean');
assert.equal(fields.get('mapped[0].score').type,'number');
assert.equal(fields.get('mapped[0].id').type,'string');

// A conditional branch field remains conditional after reconvergence.
const branches = { nodes:[n('in','input'), n('gate','condition'),n('a','set',{assignments:[{path:'branch',value:'123'}]}),n('b','set',{assignments:[{path:'other',value:'true'}]}),n('join','output'),n('future','set',{assignments:[{path:'future',value:'secret'}]}),n('orphan','set',{assignments:[{path:'unreachable',value:'secret'}]})], edges:[e('in','gate'),e('gate','a','true'),e('gate','b','false'),e('a','join'),e('b','join'),e('join','future')] };
fields = catalog(branches,'join');
assert.equal(fields.get('branch').conditional,true);
assert.equal(fields.get('branch').type,'number');
assert.equal(fields.get('other').type,'boolean');
assert.ok(!fields.has('future') && !fields.has('unreachable'));
assert.equal(catalog(branches,'future').size,0,'Terminal outputs stop reachability');

const quoted = chain(n('in','input'),n('map','map',{source:'{{input}}',resultAs:'values',format:'fields',columns:[col('normal','{{item["odd.header"]}}')]}),n('out','output'));
fields = catalog(quoted,'map',{perItem:true,input:[{'odd.header':'first',type:'hello'},{'odd.header':'second', extra:3}]});
assert.equal(fields.get('item["odd.header"]').sample,'first');
assert.equal(fields.get('item.type').type,'string');
assert.equal(fields.get('item.extra').hasSample,false);
assert.equal(fields.get('item.extra').conditional,true);

// Foreach resets decisions, retains caller input, and respects custom aliases.
const beforeLoop = n('outer','decision',{key:'outer',options:[{key:'yes'}]});
const loop = n('loop','foreach',{source:'{{input.items}}',itemVar:'row',indexVar:'position',collectAs:'result',workflow:chain(n('bi','input'),n('bo','output'))});
const loopFlow = {nodes:[n('in','input'),beforeLoop,loop,n('out','output')],edges:[e('in','outer'),e('outer','loop','yes'),e('loop','out','done')]};
fields = catalog(loopFlow,'bo',{input,path:['loop']});
assert.equal(fields.get('row.text').sample,'Help');
assert.ok(fields.has('position') && fields.has('input.items'));
assert.ok(!fields.has('decisions.outer.choice') && !fields.has('item'));
const subflow = n('sub','subflow',{input:'{{input.items[0]}}',resultAs:'answer',workflow:chain(n('bi','input'),n('bo','output',{format:'json',value:'{"text": {{input.text}}, "number": 4}'}))});
const subRoot = {nodes:[n('in','input'),beforeLoop,subflow,n('out','output')],edges:[e('in','outer'),e('outer','sub','yes'),e('sub','out')]};
fields = catalog(subRoot,'bo',{input,path:['sub']});
assert.equal(fields.get('input.text').sample,'Help');
assert.ok(!fields.has('decisions.outer.choice'));
assert.ok(catalog(subRoot,'out',{input}).has('answer.number'));
const grouping = chain(csv,n('g','groupby',{source:'{{rows}}',key:'{{item.type}}',resultAs:'groups',outputFormat:'keyed'}),n('out','output'));
assert.ok(!catalog(grouping,'out').has('groups.first'),'Dynamic grouping keys are not invented pre-run');

// Captured samples come only from the selected step and retain their provenance.
const step = tagged.trace.find(t=>t.nodeId==='bo' && t.iterations[0].index===1);
fields = catalog(nested,'bo',{input,path:['map'],observed:{scope:step.scope,item:2,edited:false}});
assert.equal(fields.get('item.text').sample,'Other');
assert.equal(fields.get('decisions.tag.choice').sample,'other');
assert.equal(fields.get('decisions.tag.choice').observed,true);
assert.equal(fields.get('decisions.tag.choice').item,2);
const edited = structuredClone(nested); edited.nodes[1].config.workflow.nodes[1].config.key='renamed';
fields = catalog(edited,'bo',{input,path:['map'],observed:{scope:step.scope,item:2,edited:true}});
assert.ok(!fields.has('decisions.tag.choice'),'Removed decision roots are not offered from stale runs');
assert.equal(fields.get('item.text').edited,true);
assert.equal(fields.get('decisions.renamed.choice').hasSample,false);

// Bounded diagnostic previews cannot masquerade as undefined or complete data.
const boundedScope = {input:{},variables:{rows:Array.from({length:12},(_,i)=>({email:`row${i}`})).concat('[88 more items omitted]'), rowsCsv:{columns:['id','email'], rowCount:100, '[preview]':'50 more fields omitted'}},decisions:{},locals:{item:{email:'[undefined]', score:'[deeper values omitted]'}}};
fields = catalog(workflow,'map',{perItem:true,observed:{scope:boundedScope,item:1}});
assert.equal(fields.get('rows.length').sample,100,'Use original length encoded by the trace truncation marker');
assert.ok(![...fields.keys()].some(k=>k.includes('[preview]')));
assert.equal(fields.get('item.email').hasSample,false,'Missing diagnostic sentinels are not real string samples');
assert.equal(fields.get('item.score').hasSample,false);
const wide = {...csv,config:{...csv.config,content:Array.from({length:100},(_,i)=>`column${i}`).join(',')+'\n'+Array.from({length:100},(_,i)=>`value${i}`).join(',')+'\n'}};
fields = catalog(chain(wide,map,out),'map',{perItem:true});
assert.ok(fields.has('item.column99'),'Current item fields take priority over duplicate variable aliases');

assert.deepEqual((await executeWorkflow(project([col('empty',null)]), [{}])).output,[{empty:null}]);
fields = catalog(branches,'join',{observed:{scope:{input:{},variables:{other:true},locals:{},decisions:{}}}});
assert.equal(fields.get('branch').hasSample,false,'An unexecuted conditional literal must not be shown as a captured value');
assert.equal(fields.get('branch').observed,true);
assert.equal(fields.get('branch').conditional,true);
assert.equal((await executeWorkflow(project([col('large','{{item}}','round')]), [Number.MAX_VALUE])).output[0].large,Number.MAX_VALUE,'Rounding finite large numbers must not overflow');
console.log('Workflow field mapping and scope checks passed');
