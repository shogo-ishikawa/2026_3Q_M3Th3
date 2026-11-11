import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiFaceTracker,memberScores,MATCH_LIMITS} from '../tracking.js';
const vector = index => Array.from({length:128},(_,i)=>i===index?1:0);
const member = (id,index) => ({id,name:id,embedding:vector(index),templates:[vector(index)]});
const members=[member('a',0),member('b',1)];
const face=(index,x=0,extra={})=>({box:[x,0,80,80],embedding:vector(index),score:.99,landmarks:[],expression:[1,0,0,0,0,0,0,0],quality:{score:95,face_size:80,brightness:120,sharpness:100,yaw:0},...extra});
const opts=(frameKey,extra={})=>({members,frameKey,nowMs:Number(frameKey)*100,camera:true,...extra});

test('each face confirms independently and retains its track ID when detector ordering changes',()=>{
 const t=new MultiFaceTracker();const first=t.update([face(0,0),face(1,150)],opts(1));
 const ids=Object.fromEntries(first.map(row=>[row.candidate,row.id]));
 assert.ok(first.every(row=>row.decision==='pending'&&row.votesSeen===1));
 const second=t.update([face(1,150),face(0,0)],opts(2));
 assert.deepEqual(second.map(row=>row.id),[ids.b,ids.a]);
 const third=t.update([face(1,150),face(0,0)],opts(3));
 assert.ok(third.every(row=>row.decision==='matched'&&row.votesSeen===3));
 assert.equal(new Set(third.map(row=>row.id)).size,2);
 });
test('crossing faces use their fresh embeddings instead of inheriting a nearby identity',()=>{
 const t=new MultiFaceTracker();const first=t.update([face(0,0),face(1,100)],opts(1));
 const next=t.update([face(0,45),face(1,55)],opts(2));
 const crossed=t.update([face(0,100),face(1,0)],opts(3));
 assert.deepEqual(next.map(row=>row.id),first.map(row=>row.id));
 assert.deepEqual(crossed.map(row=>row.id),first.map(row=>row.id));
 assert.deepEqual(crossed.map(row=>row.top.member.id),['a','b']);
 assert.ok(crossed.every(row=>row.decision==='matched'));
 });
test('a different face in the same box gets fresh evidence and no prior self-report',()=>{
 const t=new MultiFaceTracker();t.update([face(0)],opts(1));t.update([face(0)],opts(2));
 const old=t.update([face(0)],opts(3))[0];t.setSelfReport(old.id,'happiness');
 const current=t.update([face(1)],opts(4))[0];
 assert.notEqual(current.id,old.id);assert.equal(current.decision,'pending');assert.equal(current.votesSeen,1);assert.equal(current.selfReport,'');
 assert.equal(current.candidate,'b');
 });
test('a raw unknown or a changed member candidate cannot reuse earlier positive votes',()=>{
 const t=new MultiFaceTracker();for(let i=1;i<=3;i++)t.update([face(0)],opts(i));
 const notRegistered=face(0,0,{embedding:[.6,.6,.5291502622,...Array(125).fill(0)]});
 const unknown=t.update([notRegistered],opts(4))[0];
 assert.equal(unknown.candidate,null);assert.notEqual(unknown.decision,'matched');assert.equal(unknown.selfReport,'');
 const s=new MultiFaceTracker();const first=[member('old',0)];
 for(let i=1;i<=3;i++)s.update([face(0)],opts(i,{members:first}));
 const changed=s.update([face(0)],opts(4,{members:[member('new',0)]}))[0];
 assert.equal(changed.candidate,'new');assert.equal(changed.votesSeen,1);assert.equal(changed.decision,'pending');
 });
test('duplicate frame keys and older asynchronous timestamps never add confirmation votes',()=>{
 const t=new MultiFaceTracker();const first=t.update([face(0)],opts(1));
 const repeated=t.update([face(0)],opts(1,{nowMs:150}));
 assert.equal(repeated[0].votesSeen,1);assert.equal(repeated[0].timeline.length,1);
 const second=t.update([face(0)],opts(2));assert.equal(second[0].votesSeen,2);
 assert.deepEqual(t.update([face(0)],opts(0)),[]);
 const third=t.update([face(0)],opts(3));assert.equal(third[0].votesSeen,3);assert.equal(third[0].decision,'matched');
 assert.equal(first[0].id,third[0].id);
 });
test('loss, expiration, input generation and settings changes clear temporal evidence',()=>{
 const t=new MultiFaceTracker({ttlMs:500});const before=t.update([face(0)],opts(1))[0];
 t.update([],opts(2));const afterLoss=t.update([face(0)],opts(3))[0];
 assert.notEqual(afterLoss.id,before.id);assert.equal(afterLoss.votesSeen,1);
 t.update([],opts(4));t.update([],opts(9));assert.equal(t.tracks.size,0);
 const afterExpiry=t.update([face(0)],opts(10))[0];assert.notEqual(afterExpiry.id,afterLoss.id);
 const generated=t.update([face(0)],opts(11,{generation:2}))[0];assert.notEqual(generated.id,afterExpiry.id);assert.equal(generated.votesSeen,1);
 const changed=t.update([face(0)],opts(12,{generation:2,voteWindow:5}))[0];assert.notEqual(changed.id,generated.id);assert.equal(changed.votesSeen,1);assert.equal(changed.votesRequired,5);
 });
test('missing, small, invalid or poor quality stays pending while other faces remain usable',()=>{
 for(const quality of [undefined,{score:95,face_size:20},{score:49,face_size:80},{score:NaN,face_size:80},{score:90,face_size:80,yaw:Infinity}]){
  const t=new MultiFaceTracker();const result=t.update([face(0,0,{quality}),face(1,150)],opts(1,{camera:false}));
  assert.equal(result[0].decision,'pending');assert.equal(result[0].qualityAccepted,false);assert.ok(result[0].pendingReason);assert.equal(result[1].decision,'matched');
 }
 assert.deepEqual(MATCH_LIMITS,{quality:50,faceSize:48,margin:.08});
 const t=new MultiFaceTracker();const result=t.update([face(0,0,{embedding:Array(128).fill(NaN)})],opts(1));
 assert.equal(result[0].decision,'pending');assert.equal(result[0].qualityAccepted,false);
 });
test('similar competing identities and duplicated registration candidates remain pending',()=>{
 const t=new MultiFaceTracker();const similar=[member('a',0),{...member('b',1),templates:[[.999,.01,...Array(126).fill(0)]]}];
 const ambiguous=t.update([face(0)],opts(1,{members:similar,camera:false}))[0];
 assert.equal(ambiguous.ambiguous,true);assert.equal(ambiguous.decision,'pending');assert.ok(ambiguous.pendingReason.includes('複数'));
 const duplicated=t.update([face(0,0),face(0,150)],opts(2,{camera:false}));
 assert.ok(duplicated.every(row=>row.collision&&row.decision==='pending'&&!row.stable));
 assert.ok(duplicated.every(row=>row.pendingReason.includes('同じ登録')));
 });
test('ambiguous spatial assignment resets track evidence instead of guessing an old track',()=>{
 const t=new MultiFaceTracker();const first=t.update([face(0,0),face(0,10)],opts(1,{members:[]}));
 const current=t.update([face(0,5)],opts(2,{members:[]}))[0];
 assert.ok(!first.some(row=>row.id===current.id));assert.equal(current.decision,'pending');
 });
test('multiple templates use their maximum match and analysis works without enrolled members',()=>{
 const ranked=memberScores(vector(1),[{...member('a',0),templates:[vector(0),vector(1)]},member('b',2)]);
 assert.equal(ranked[0].member.id,'a');assert.equal(ranked[0].score,1);
 assert.equal(memberScores(vector(0),[{id:'legacy',embedding:vector(0)}])[0].score,1);
 assert.throws(()=>memberScores(vector(0),[{id:'bad',templates:[]}]));
 const t=new MultiFaceTracker();const analysed=t.update([face(0)],opts(1,{members:[]}))[0];
 assert.deepEqual(analysed.expressionEMA,[1,0,0,0,0,0,0,0]);assert.equal(analysed.decision,'pending');
 });
test('per-face self reports and removing an enrollment do not leak between identities',()=>{
 const t=new MultiFaceTracker();const results=t.update([face(0,0),face(1,150)],opts(1,{camera:false}));
 t.setSelfReport(results[0].id,'happiness');assert.equal(t.current()[0].selfReport,'happiness');assert.equal(t.current()[1].selfReport,'');
 assert.throws(()=>t.setSelfReport(results[0].id,'not-a-label'));
 t.removeMember('a');assert.equal(t.current()[0].decision,'pending');assert.equal(t.current()[0].selfReport,'');assert.equal(t.current()[1].decision,'matched');
 const renamed=t.update([face(0,0),face(1,150)],opts(2,{camera:false,members:[member('b',1)]}));
 assert.equal(renamed[0].decision,'unknown');assert.equal(renamed[1].decision,'matched');
 });
test('up to fifty current faces each receive their own fresh result',()=>{
 const t=new MultiFaceTracker();const people=Array.from({length:50},(_,i)=>member('m'+i,i));
 const faces=people.map((_,i)=>face(i,(i%10)*100));
 // Keep repeated x positions in independent rows, as in a group photograph.
 faces.forEach((f,i)=>{f.box[1]=Math.floor(i/10)*100;});
 const results=t.update(faces,opts(1,{members:people,camera:false}));
 assert.equal(results.length,50);assert.equal(new Set(results.map(row=>row.id)).size,50);assert.ok(results.every(row=>row.decision==='matched'));
 assert.throws(()=>t.update([...faces,face(60)],opts(2,{members:people})));
 });

test('slow full-group inference still confirms continuous faces from fresh embeddings',()=>{
 const t=new MultiFaceTracker();let result;
 for(let i=0;i<3;i++)result=t.update([face(0)],opts(i,{nowMs:i*4000}));
 assert.equal(result[0].decision,'matched');assert.equal(result[0].votesSeen,3);assert.equal(result[0].id,'face-1');
});
test('registration changes are re-evaluated even when the source frame has not changed',()=>{
 const t=new MultiFaceTracker();const first=t.update([face(0)],opts(1,{camera:false}));assert.equal(first[0].decision,'matched');
 const removed=t.update([face(0)],opts(1,{camera:false,members:[]}));assert.equal(removed[0].decision,'pending');assert.equal(removed[0].candidate,null);assert.equal(removed[0].top,null);
 const list=[member('a',0)];const updated=t.update([face(0)],opts(2,{camera:false,members:list}));assert.equal(updated[0].decision,'matched');
 list[0].templates=[vector(1)];const changed=t.update([face(0)],opts(2,{camera:false,members:list}));assert.equal(changed[0].decision,'unknown');
});
test('an old input generation cannot roll back tracking after a newer source or reset',()=>{
 const t=new MultiFaceTracker();t.update([face(0)],opts(1,{generation:2,camera:false}));
 assert.deepEqual(t.update([face(1)],opts(2,{generation:1,camera:false})),[]);
 t.reset();assert.deepEqual(t.update([face(1)],opts(2,{generation:1,camera:false})),[]);
 const fresh=t.update([face(1)],opts(3,{generation:3,camera:false}));assert.equal(fresh[0].top.member.id,'b');
});
