import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,STORAGE_KEY,emptyState,validateState,unitVector,meanTemplate,loadState,saveState,removeMember,exportCSV} from '../browser-store.js';
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
