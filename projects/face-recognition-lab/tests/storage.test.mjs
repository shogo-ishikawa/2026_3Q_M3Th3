import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,STORAGE_KEY,emptyState,validateState,unitVector,meanTemplate,loadState,saveState,removeMember,exportCSV,MAX_MEMBERS,MAX_TEMPLATES,MAX_STORAGE_CHARS} from '../browser-store.js';
const vector = index => Array.from({length:128},(_,i)=>i===index?1:0);
const member = {id:'member-a',name:'サンプル',embedding:vector(0),samples:2,consentAt:'2026-11-11T00:00:00.000Z'};
const storage = () => {const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};

test('default state is transient and saving does not retain features without opt-in',()=>{
 const s=storage(),state=emptyState();state.members=[member];
 assert.equal(DEFAULT_SETTINGS.persist,false);assert.equal(saveState(state,s).ok,true);assert.equal(s.getItem(STORAGE_KEY),null);
 state.settings.persist=true;saveState(state,s);assert.deepEqual(loadState(s).state,validateState(state));
 state.settings.persist=false;saveState(state,s);assert.equal(s.getItem(STORAGE_KEY),null);
});
test('only templates and settings are serialised; pictures and logs are discarded',()=>{
 const s=storage(),state={...emptyState(),members:[{...member,photo:'private-data'}],logs:[{private:true}],settings:{...DEFAULT_SETTINGS,persist:true}};
 saveState(state,s);const raw=s.getItem(STORAGE_KEY);assert.ok(!raw.includes('private'));assert.ok(!raw.includes('photo'));assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['members','settings','version']);
});
test('malformed vectors, duplicate identities and invalid settings fail closed',()=>{
 for(const bad of [Array(127).fill(1),Array(128).fill(0),Array(128).fill(1e308),[...vector(0).slice(0,127),Infinity],[...vector(0).slice(0,127),'1']])assert.throws(()=>unitVector(bad));
 for(const setting of [{threshold:NaN},{threshold:2},{voteWindow:4},{blurUnknown:'yes'},{persist:1}])assert.throws(()=>validateState({...emptyState(),settings:{...DEFAULT_SETTINGS,...setting}}));
 assert.throws(()=>validateState({...emptyState(),members:[member,member]}));
 assert.throws(()=>validateState({...emptyState(),members:[{...member,name:'\n'}]}));
});
test('mean template is normalised and input samples remain unchanged',()=>{
 const samples=[vector(0),vector(1)],before=JSON.stringify(samples),mean=meanTemplate(samples);
 assert.ok(Math.abs(mean[0]-Math.SQRT1_2)<1e-10);assert.ok(Math.abs(Math.hypot(...mean)-1)<1e-10);assert.equal(JSON.stringify(samples),before);
 assert.throws(()=>meanTemplate([]));assert.throws(()=>meanTemplate([vector(0),vector(0).map(x=>-x)]));
});
test('removing a member removes every related log but preserves other records',()=>{
 const state={...emptyState(),members:[member,{...member,id:'member-b',name:'別の登録'}]};
 const result=removeMember(state,[{member_id:'member-a'},{member_id:'member-b'},{member_id:''}],member.id);
 assert.deepEqual(result.state.members.map(m=>m.id),['member-b']);assert.deepEqual(result.logs.map(r=>r.member_id),['member-b','']);assert.equal(state.members.length,2);
});
test('unavailable or malformed storage falls back with an explicit warning',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 assert.equal(loadState(blocked).state.settings.persist,false);assert.ok(loadState(blocked).warning);assert.equal(saveState(emptyState(),blocked).ok,false);
 const s=storage();for(const bad of ['{','x'.repeat(400001),JSON.stringify({version:10})]){s.setItem(STORAGE_KEY,bad);assert.ok(loadState(s).warning);assert.deepEqual(loadState(s).state.members,[]);}
});
test('CSV preserves commas, line breaks and quotes while preventing formula execution',()=>{
 const text=exportCSV([{name:'=1+2',score:-0.25,note:'a,"b"\nc'}],['name','score','note']);
 assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"\'=1+2"'));assert.ok(text.includes('"-0.25"'));assert.ok(text.includes('"a,""b""\nc"'));
});

test('legacy version 1 settings and single embeddings migrate without losing consent or identity',()=>{
 const legacy={version:1,settings:{threshold:.73,voteWindow:15,blurUnknown:false,persist:true},members:[member]};
 const migrated=validateState(legacy);
 assert.equal(migrated.settings.threshold,.73);assert.equal(migrated.settings.voteWindow,15);assert.equal(migrated.settings.profile,'fast');assert.equal(migrated.settings.maxFaces,6);assert.equal(migrated.settings.cameraId,'');assert.equal(migrated.settings.mirror,false);
 assert.deepEqual(migrated.members[0].templates,[vector(0)]);assert.deepEqual(migrated.members[0].embedding,vector(0));assert.equal(migrated.members[0].consentAt,member.consentAt);
 const s=storage();s.setItem(STORAGE_KEY,JSON.stringify(legacy));assert.deepEqual(loadState(s).state,migrated);
});
test('one hundred enrollments and twelve distinct templates survive an opt-in round trip',()=>{
 assert.equal(MAX_MEMBERS,100);assert.equal(MAX_TEMPLATES,12);assert.equal(DEFAULT_SETTINGS.voteWindow,3);
 const state=emptyState();state.settings={...state.settings,persist:true,profile:'group',maxFaces:50,cameraId:'camera-device-2',mirror:true};
 state.members=Array.from({length:MAX_MEMBERS},(_,i)=>({...member,id:'member-'+i,name:'登録'+i,templates:Array.from({length:MAX_TEMPLATES},(_,j)=>vector(j)),samples:MAX_TEMPLATES}));
 const s=storage();assert.equal(saveState(state,s).ok,true);assert.deepEqual(loadState(s).state,validateState(state));
 assert.throws(()=>validateState({...state,members:[...state.members,{...member,id:'overflow'}]}));
 assert.throws(()=>validateState({...state,members:[{...member,templates:Array.from({length:MAX_TEMPLATES+1},()=>vector(0))}]}));
});
test('malformed new settings and template collections are rejected instead of discarded',()=>{
 for(const setting of [{profile:'unknown'},{profile:null},{maxFaces:8},{maxFaces:51},{cameraId:1},{cameraId:'a\n'},{cameraId:'x'.repeat(257)},{mirror:'yes'}])assert.throws(()=>validateState({...emptyState(),settings:{...DEFAULT_SETTINGS,...setting}}));
 for(const templates of [[],null,[Array(128).fill(0)],[[...vector(0).slice(0,127),NaN]],'template'])assert.throws(()=>validateState({...emptyState(),members:[{...member,templates}]}));
 const withTemplates={...member,templates:[vector(0),vector(1)]};delete withTemplates.embedding;
 assert.deepEqual(validateState({...emptyState(),members:[withTemplates]}).members[0].embedding,vector(0));
 const before=JSON.stringify(withTemplates);validateState({...emptyState(),members:[withTemplates]});assert.equal(JSON.stringify(withTemplates),before);
});
test('oversized stored data and device quota failures preserve usable transient state',()=>{
 const s=storage();s.setItem(STORAGE_KEY,' '.repeat(MAX_STORAGE_CHARS+1));assert.ok(loadState(s).warning);assert.deepEqual(loadState(s).state.members,[]);
 const state={...emptyState(),members:[member],settings:{...DEFAULT_SETTINGS,persist:true}};
 const blocked={getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}};
 assert.equal(saveState(state,blocked).ok,false);assert.equal(state.members[0].id,member.id);assert.ok(saveState(state,blocked).warning);
});
