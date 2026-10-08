import demos from './index.js';
import { installGameSection, seeded } from './perception.js';

const COLS = 13, ROWS = 11;
const CARDINAL = ['up', 'left', 'right', 'down'];
const V = { up:{dc:0,dr:-1}, down:{dc:0,dr:1}, left:{dc:-1,dr:0}, right:{dc:1,dr:0} };
const key = (r,c) => `${r},${c}`;

installGameSection({
  id: 'bomberman', navLabel: 'Bomberman',
  titleHtml: 'See the arena.<br>Choose one action.',
  lead: 'Bomberman gives Laya a compact local arena view and asks it to choose directly between the legal actions. Code reports walls, crates, enemies, bombs and imminent blast danger; it does not pathfind, score tiles or preview candidate actions.',
  sees: 'The current tile plus the four cardinal directions, including the next tile and one tile beyond when visible. Blast danger is reported as timing on those spaces. BOMB is offered only when it can actually be placed.',
  controls: 'Move with arrows or WASD and place a bomb with Space. MOVE, WAIT and BOMB are all options in one Laya choice; the returned option is executed directly.',
});

export class Bomberman {
  constructor(seed) {
    this.rand = seeded(seed);
    this.best = 0;
    this.crashes = 0;
    this.level = 1;
    this.optionTurn = 0;
    this.reset(true);
  }

  reset(first = false) {
    if (!first) this.level = 1;
    this.score = 0; this.dead = 0; this.won = 0;
    this.moveCool = 0; this.enemyClock = 0; this.modelMove = null;
    this.bombs = []; this.explosions = [];
    this.buildBoard();
  }

  buildBoard() {
    this.walls = new Set(); this.crates = new Set();
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
      if (r===0||r===ROWS-1||c===0||c===COLS-1||(r%2===0&&c%2===0)) this.walls.add(key(r,c));
    }
    const safe = new Set([key(1,1),key(1,2),key(2,1),key(ROWS-2,COLS-2),key(ROWS-2,COLS-3),key(ROWS-3,COLS-2)]);
    for (let r=1;r<ROWS-1;r++) for (let c=1;c<COLS-1;c++) {
      const k=key(r,c); if (this.walls.has(k)||safe.has(k)) continue;
      if (this.rand() < 0.52) this.crates.add(k);
    }
    this.player={r:1,c:1};
    const enemySpawns=[[ROWS-2,COLS-2],[1,COLS-2],[ROWS-2,1]];
    this.enemies=enemySpawns.slice(0,Math.min(3,1+this.level)).map(([r,c])=>({r,c,dead:false}));
  }

  setModelDriven(enabled){this.modelDriven=enabled;if(!enabled)this.modelMove=null;}
  solid(r,c,ignoreBombAt=null){
    const k=key(r,c); if(this.walls.has(k)||this.crates.has(k)) return true;
    return this.bombs.some(b=>!b.dead&&b.r===r&&b.c===c&&(!ignoreBombAt||k!==ignoreBombAt));
  }
  passable(r,c,ignoreBombAt=null){return r>=1&&r<ROWS-1&&c>=1&&c<COLS-1&&!this.solid(r,c,ignoreBombAt);}
  neighbor(r,c,dir){const d=V[dir];return {r:r+d.dr,c:c+d.dc};}

  blastCells(bomb, crates=this.crates){
    const cells=[[bomb.r,bomb.c]];
    for(const dir of CARDINAL){
      const d=V[dir];
      for(let i=1;i<=2;i++){
        const r=bomb.r+d.dr*i,c=bomb.c+d.dc*i,k=key(r,c);
        if(this.walls.has(k)) break;
        cells.push([r,c]);
        if(crates.has(k)) break;
      }
    }
    return cells;
  }

  dangerAt(r,c,window=1.45){
    if(this.explosions.some(e=>e.r===r&&e.c===c)) return true;
    return this.bombs.some(b=>!b.dead&&b.timer<=window&&this.blastCells(b).some(([rr,cc])=>rr===r&&cc===c));
  }


  canBomb(){return !this.dead&&!this.won&&this.bombs.filter(b=>!b.dead).length<2&&!this.bombs.some(b=>b.r===this.player.r&&b.c===this.player.c);}

  dangerFact(r,c){
    if(this.explosions.some(e=>e.r===r&&e.c===c)) return 'An explosion covers that tile now.';
    if(this.dangerAt(r,c,.75)) return 'A bomb will blast that tile very soon.';
    if(this.dangerAt(r,c,1.5)) return 'A bomb will blast that tile soon.';
    return 'No current bomb is about to blast that tile.';
  }

  cellFact(r,c){
    if(r<0||r>=ROWS||c<0||c>=COLS||this.walls.has(key(r,c))) return 'solid wall';
    if(this.crates.has(key(r,c))) return 'destructible crate';
    const bomb=this.bombs.find(b=>!b.dead&&b.r===r&&b.c===c);
    const enemy=this.enemies.find(e=>!e.dead&&e.r===r&&e.c===c);
    let content=bomb?'bomb':enemy?'enemy':'open floor';
    if(this.explosions.some(e=>e.r===r&&e.c===c)) content += ', explosion now';
    else if(this.dangerAt(r,c,.75)) content += ', blast very soon';
    else if(this.dangerAt(r,c,1.5)) content += ', blast soon';
    return content;
  }

  directionView(dir){
    const first=this.neighbor(this.player.r,this.player.c,dir);
    const firstFact=this.cellFact(first.r,first.c);
    if(firstFact==='solid wall'||firstFact==='destructible crate'||firstFact.startsWith('bomb')) return `${dir.toUpperCase()}: ${firstFact}.`;
    const second=this.neighbor(first.r,first.c,dir);
    return `${dir.toUpperCase()}: ${firstFact}; one more tile ${this.cellFact(second.r,second.c)}.`;
  }

  actionCandidates(){
    const candidates=[];
    const start=key(this.player.r,this.player.c);
    for(const dir of CARDINAL){
      const n=this.neighbor(this.player.r,this.player.c,dir);
      if(!this.passable(n.r,n.c,start)) continue;
      candidates.push({id:dir,label:`${dir.toUpperCase()} option`,type:'move',dir,...n});
    }
    candidates.push({id:'hold',label:'WAIT option',type:'hold',r:this.player.r,c:this.player.c});
    if(this.canBomb()) candidates.push({id:'bomb',label:'BOMB option',type:'bomb',r:this.player.r,c:this.player.c});
    return candidates;
  }

  placeBomb(){if(!this.canBomb())return false;this.bombs.push({r:this.player.r,c:this.player.c,timer:2,dead:false});return true;}

  explode(b){
    b.dead=true;
    const cells=this.blastCells(b);
    for(const [r,c] of cells){
      this.explosions.push({r,c,timer:0.38});
      const k=key(r,c);
      if(this.crates.delete(k)){this.score+=20;this.best=Math.max(this.best,this.score);}
      for(const e of this.enemies)if(!e.dead&&e.r===r&&e.c===c){e.dead=true;this.score+=100;this.best=Math.max(this.best,this.score);}
      for(const other of this.bombs)if(!other.dead&&other!==b&&other.r===r&&other.c===c)other.timer=0;
    }
  }

  moveEntity(entity,dir,allowBombStart=false){
    const n=this.neighbor(entity.r,entity.c,dir),ignore=allowBombStart?key(entity.r,entity.c):null;
    if(this.passable(n.r,n.c,ignore)){entity.r=n.r;entity.c=n.c;return true;}return false;
  }

  crash(){if(this.dead)return;this.dead=0.9;this.crashes++;this.best=Math.max(this.best,this.score);this.modelMove=null;}

  update(dt,input={}){
    if(this.dead){this.dead-=dt;if(this.dead<=0||input.restart){this.dead=0;this.bombs=[];this.explosions=[];this.player={r:1,c:1};}return;}
    if(this.won){this.won-=dt;if(this.won<=0){this.won=0;this.level++;this.buildBoard();this.bombs=[];this.explosions=[];}return;}

    this.moveCool=Math.max(0,this.moveCool-dt);
    if(this.modelDriven){
      if(this.moveCool<=0&&this.modelMove){this.moveEntity(this.player,this.modelMove,true);this.moveCool=0.11;}
    }else if(this.moveCool<=0){
      let dir=null;if(input.up)dir='up';else if(input.down)dir='down';else if(input.left)dir='left';else if(input.right)dir='right';
      if(dir){this.moveEntity(this.player,dir,true);this.moveCool=0.11;}
      if(input.bomb)this.placeBomb();
    }

    for(const b of this.bombs)if(!b.dead){b.timer-=dt;if(b.timer<=0)this.explode(b);}
    this.bombs=this.bombs.filter(b=>!b.dead);
    for(const e of this.explosions)e.timer-=dt;
    this.explosions=this.explosions.filter(e=>e.timer>0);
    if(this.explosions.some(e=>e.r===this.player.r&&e.c===this.player.c))return this.crash();

    this.enemyClock-=dt;
    if(this.enemyClock<=0){
      this.enemyClock=0.26;
      for(const e of this.enemies)if(!e.dead){
        const choices=CARDINAL.filter(dir=>{const n=this.neighbor(e.r,e.c,dir);return this.passable(n.r,n.c)&&!this.dangerAt(n.r,n.c,0.7);});
        if(choices.length)this.moveEntity(e,choices[(this.rand()*choices.length)|0]);
        if(e.r===this.player.r&&e.c===this.player.c)return this.crash();
      }
    }

    if(this.enemies.every(e=>e.dead)){
      this.score+=300;this.best=Math.max(this.best,this.score);this.won=0.8;
    }
  }

  observe(){
    const candidates=this.actionCandidates();
    const rotation=this.optionTurn++%candidates.length;
    const optionOrder=candidates.map((_,i)=>(i+rotation)%candidates.length);
    this.lastCandidates=candidates;
    const descriptions={
      up:'move UP one tile',left:'move LEFT one tile',right:'move RIGHT one tile',down:'move DOWN one tile',
      hold:'WAIT on the current tile',bomb:'place a BOMB on the current tile',
    };
    const currentBomb=this.bombs.some(b=>!b.dead&&b.r===this.player.r&&b.c===this.player.c)?' A bomb is on the current tile.':'';
    return {
      state:[
        'Goal: survive and destroy crates or enemies with bombs. Bomb blasts travel up to two tiles in the four cardinal directions and stop at walls or crates.',
        `Current: ${this.dangerFact(this.player.r,this.player.c)}${currentBomb}`,
        ...CARDINAL.map(dir=>this.directionView(dir)),
      ].join(' '),
      questions:{
        action:{
          type:'choice',
          option_order:optionOrder,
          instructions:'Which legal Bomberman action should be taken now?',
          criteria:Object.fromEntries(candidates.map(candidate=>[candidate.id,descriptions[candidate.id]])),
        },
      },
    };
  }

  act(answers,params,apply){
    const candidates=this.lastCandidates?.length?this.lastCandidates:this.actionCandidates();
    const requested=answers?.action?.choice;
    const chosen=candidates.find(candidate=>candidate.id===requested)||candidates.find(candidate=>candidate.id==='hold')||candidates[0];
    if(apply){
      this.modelMove=null;
      if(chosen?.type==='move') this.modelMove=chosen.dir;
      else if(chosen?.type==='bomb') this.placeBomb();
    }
    const label=!chosen?'WAIT':chosen.type==='bomb'?'BOMB':chosen.type==='hold'?'WAIT':chosen.dir.toUpperCase();
    const probability=chosen?(answers?.action?.probabilities?.[chosen.id]??0):0;
    return {label,why:chosen?`Laya chose ${chosen.id} (${probability.toFixed(2)})`:'no legal action'};
  }

  draw(ctx,w,h){
    const cw=w/COLS,rh=h/ROWS;
    ctx.fillStyle='rgb(8,8,8)';ctx.fillRect(0,0,w,h);
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
      const x=c*cw,y=r*rh,k=key(r,c);
      if(this.walls.has(k)){ctx.fillStyle='rgb(68,68,68)';ctx.fillRect(x+1,y+1,cw-2,rh-2);ctx.fillStyle='rgb(20,20,20)';ctx.fillRect(x+4,y+4,Math.max(1,cw-8),Math.max(1,rh-8));}
      else if(this.crates.has(k)){ctx.fillStyle='rgb(135,135,135)';ctx.fillRect(x+3,y+3,cw-6,rh-6);ctx.strokeStyle='rgb(65,65,65)';ctx.strokeRect(x+5,y+5,cw-10,rh-10);}
    }
    for(const b of this.bombs){const x=(b.c+.5)*cw,y=(b.r+.5)*rh;ctx.fillStyle='rgb(215,215,215)';ctx.beginPath();ctx.arc(x,y,Math.min(cw,rh)*.27,0,Math.PI*2);ctx.fill();ctx.fillStyle='rgb(95,95,95)';ctx.fillRect(x,y-rh*.34,cw*.08,rh*.16);}
    for(const e of this.explosions){const x=(e.c+.5)*cw,y=(e.r+.5)*rh;ctx.fillStyle='rgb(245,245,245)';ctx.fillRect(x-cw*.32,y-rh*.1,cw*.64,rh*.2);ctx.fillRect(x-cw*.1,y-rh*.32,cw*.2,rh*.64);}
    for(const e of this.enemies)if(!e.dead){const x=(e.c+.5)*cw,y=(e.r+.5)*rh;ctx.fillStyle='rgb(165,165,165)';ctx.beginPath();ctx.arc(x,y,Math.min(cw,rh)*.28,0,Math.PI*2);ctx.fill();}
    if(!(this.dead&&Math.floor(this.dead*12)%2)){const x=(this.player.c+.5)*cw,y=(this.player.r+.5)*rh;ctx.fillStyle='rgb(245,245,245)';ctx.beginPath();ctx.arc(x,y,Math.min(cw,rh)*.3,0,Math.PI*2);ctx.fill();ctx.fillStyle='rgb(35,35,35)';ctx.fillRect(x-cw*.15,y-rh*.07,cw*.08,rh*.08);ctx.fillRect(x+cw*.07,y-rh*.07,cw*.08,rh*.08);}
    ctx.fillStyle='rgb(145,145,145)';ctx.font=`${Math.max(10,h*.027)}px monospace`;ctx.textAlign='left';ctx.fillText(`LEVEL ${this.level}   ENEMIES ${this.enemies.filter(e=>!e.dead).length}`,14,20);ctx.textAlign='right';ctx.fillText('BOMBERMAN / CANDIDATE ACTIONS',w-14,20);ctx.textAlign='left';
  }
}

const demo={
  id:'bomberman',title:'Bomberman',checkpoint:'english',
  keys:'ARROWS OR WASD TO MOVE · SPACE TO BOMB',touch:true,
  keyCodes:['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space'],
  touchKeys:[['ArrowLeft','←','Move left'],['ArrowUp','↑','Move up'],['Space','●','Place bomb'],['ArrowDown','↓','Move down'],['ArrowRight','→','Move right']],
  simulationSpeed:{min:.5,max:1.5,step:.1,value:1},
  blurb:'One board state, one action choice. Every legal move, WAIT and BOMB is an option; JavaScript resolves mechanics but never ranks the actions.',
  params:[],
  answerLabel:'ANSWER · ACTION',
  answerForFeed:answers=>({probabilities:answers?.action?.probabilities||{},choice:answers?.action?.choice||'unknown'}),
  input:(keys,pressed)=>({
    up:keys.has('ArrowUp')||keys.has('KeyW'),down:keys.has('ArrowDown')||keys.has('KeyS'),left:keys.has('ArrowLeft')||keys.has('KeyA'),right:keys.has('ArrowRight')||keys.has('KeyD'),
    bomb:pressed.has('Space')||pressed.has('pointer'),restart:pressed.has('Space'),
  }),
  create:seed=>new Bomberman(seed),
};
if(!demos.some(d=>d.id===demo.id))demos.push(demo);
export default demo;
