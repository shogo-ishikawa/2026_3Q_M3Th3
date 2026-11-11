/* 人ごとの判定を分ける純粋な部品。古い票や別の顔の表情は引き継ぎません。 */
import {cosine, intersectionOverUnion} from './engine.js';
import {unitVector, MAX_TEMPLATES, MAX_MEMBERS} from './browser-store.js';

export const MATCH_LIMITS = Object.freeze({quality:50, faceSize:48, margin:0.08});
const SELF_REPORTS = new Set(['','neutral','happiness','surprise','sadness','anger','disgust','fear','contempt']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validBox = box => Array.isArray(box) && box.length===4 && box.every(finite) && box[2]>0 && box[3]>0;

function prepareMembers(members) {
  if(!Array.isArray(members)||members.length>MAX_MEMBERS)throw new Error('登録した顔の一覧を確認できません。');
  return members.map(member=>{
    const templates=member?.templates===undefined?[member?.embedding]:member.templates;
    if(!Array.isArray(templates)||!templates.length||templates.length>MAX_TEMPLATES)throw new Error('登録した顔の特徴量を確認できません。');
    return {member,templates:templates.map(template=>unitVector(Array.from(template || [])))};
  });
}

function scorePrepared(vector,prepared) {
  return prepared.map(({member,templates})=>{
    let score=-1;
    for(const template of templates){
      let dot=0;for(let i=0;i<128;i++)dot+=vector[i]*template[i];
      score=Math.max(score,Math.max(-1,Math.min(1,dot)));
    }
    return {member,score};
  }).sort((a,b)=>b.score-a.score || String(a.member.id).localeCompare(String(b.member.id)));
}

export function memberScores(embedding, members) {
  return scorePrepared(unitVector(Array.from(embedding || [])),prepareMembers(members));
}

function usableQuality(face) {
  const q=face.quality;
  if(!q || !finite(q.score) || q.score<0 || q.score>100 || !finite(q.face_size) || q.face_size<=0 ||
    ['brightness','contrast','sharpness','yaw','roll','pitch'].some(key=>q[key]!==undefined&&!finite(q[key]))) {
    return {ok:false,reason:'撮影条件を確認できません。'};
  }
  if(Math.min(q.face_size,face.box[2],face.box[3])<MATCH_LIMITS.faceSize)return {ok:false,reason:'顔が小さすぎます。近づくか、多人数モードで解像度を上げてください。'};
  if(q.score<MATCH_LIMITS.quality)return {ok:false,reason:'撮影条件が十分ではありません。明るさ・ピント・顔の向きを確認してください。'};
  return {ok:true,reason:''};
}

function expression(values) {
  if(!values)return null;
  if(!Array.isArray(values)||values.length!==8||values.some(value=>!finite(value)||value<0))return null;
  const sum=values.reduce((a,b)=>a+b,0);
  return sum>0&&finite(sum)?values.map(value=>value/sum):null;
}

function clearEvidence(track) {
  track.votes=[];track.expressionEMA=null;track.timeline=[];track.selfReport='';track.epoch++;
}

function cloneView(track) {
  return {...track.face,id:track.id,trackId:track.id,epoch:track.epoch,
    ranking:track.ranking.map(row=>({...row})),top:track.ranking[0]||null,
    candidate:track.candidate,rawCandidate:track.rawCandidate,decision:track.decision,stable:track.stable,
    votesSeen:track.votes.length,votesRequired:track.votesRequired,
    pendingReason:track.pendingReason,qualityAccepted:track.qualityAccepted,ambiguous:track.ambiguous,
    collision:track.collision,margin:track.margin,
    expression:track.expressionEMA?[...track.expressionEMA]:expression(track.face.expression),
    expressionEMA:track.expressionEMA?[...track.expressionEMA]:null,
    timeline:track.timeline.map(values=>[...values]),selfReport:track.selfReport,
    updatedAt:track.updatedAt,frameKey:track.frameKey,visible:track.visible};
}

export class MultiFaceTracker {
  constructor({ttlMs=1500,continuity=0.55,ambiguityMargin=0.08}={}) {
    if(!finite(ttlMs)||ttlMs<=0||!finite(continuity)||continuity<0||continuity>1||!finite(ambiguityMargin)||ambiguityMargin<0||ambiguityMargin>1)throw new Error('追跡の設定が不正です。');
    this.ttlMs=ttlMs;this.continuity=continuity;this.ambiguityMargin=ambiguityMargin;
    this.nextId=1;this.generation=undefined;this.seenGenerations=new Set();this.reset();
  }
  reset() {
    this.tracks=new Map();this.visible=[];this.lastFrameKey=undefined;this.lastNow=-Infinity;this.configuration='';this.memberRevision='';
  }
  current() { return this.visible.filter(track=>track.visible).map(cloneView); }
  setSelfReport(trackId,value) {
    if(!SELF_REPORTS.has(value))throw new Error('申告する項目を選んでください。');
    const track=this.tracks.get(String(trackId));
    if(!track?.visible||!track.qualityAccepted)throw new Error('顔を解析したあとに、その顔の申告を選んでください。');
    track.selfReport=value;
    return cloneView(track);
  }
  removeMember(memberId) {
    for(const track of this.tracks.values()){
      if(track.candidate===memberId||track.rawCandidate===memberId){
        clearEvidence(track);track.candidate=null;track.rawCandidate=null;track.stable=false;
        track.decision='pending';track.pendingReason='登録内容が変わったため、もう一度照合します。';
      }
      track.ranking=track.ranking.filter(row=>row.member.id!==memberId);
    }
  }
  update(faces,{members=[],threshold=0.70,voteWindow=3,frameKey,nowMs=Date.now(),camera=true,generation=0}={}) {
    if(!Array.isArray(faces)||faces.length>50||!Array.isArray(members)||!finite(threshold)||threshold<0||threshold>1||![3,5,10,15,30].includes(voteWindow)||!finite(nowMs)||typeof camera!=='boolean')throw new Error('顔の照合条件が不正です。');
    if((typeof frameKey!=='string'&&typeof frameKey!=='number')||(typeof frameKey==='number'&&!finite(frameKey)))throw new Error('フレームを識別する情報が必要です。');
    if((typeof generation!=='string'&&typeof generation!=='number')||(typeof generation==='number'&&!finite(generation)))throw new Error('入力の識別情報が不正です。');
    if(this.generation!==generation){
      if((typeof generation==='number'&&typeof this.generation==='number'&&generation<this.generation)||this.seenGenerations.has(generation))return [];
      this.reset();this.generation=generation;this.seenGenerations.add(generation);
      if(this.seenGenerations.size>256)this.seenGenerations.delete(this.seenGenerations.values().next().value);
    }
    const configuration=JSON.stringify([threshold,voteWindow,camera]);
    const memberRevision=JSON.stringify(members.map(member=>[member.id,member.embedding,member.templates]));
    if(configuration!==this.configuration||memberRevision!==this.memberRevision){this.tracks.clear();this.visible=[];this.lastFrameKey=undefined;this.configuration=configuration;this.memberRevision=memberRevision;}
    if(nowMs<this.lastNow)return [];
    // 同じ映像をもう一度計算しても、確認フレーム数は増やしません。
    if(frameKey===this.lastFrameKey)return this.current();
    this.lastFrameKey=frameKey;this.lastNow=nowMs;
    // 大人数の推論が長くても、最新の特徴量で継続確認できる顔を時間だけで捨てません。
    for(const [id,track] of this.tracks)if(!track.visible&&nowMs-track.updatedAt>this.ttlMs)this.tracks.delete(id);
    const prepared=faces.map(face=>{
      if(!validBox(face.box))throw new Error('顔の位置を確認できません。');
      let vector=null;try{vector=unitVector(Array.from(face.embedding||[]));}catch{/* This face stays pending; other faces can still be processed. */}
      const quality=usableQuality(face);
      return {face,vector,quality:vector?quality:{ok:false,reason:'顔の特徴量を確認できません。'}};
    });
    // 登録テンプレートの正規化は各顔で繰り返さず、この更新で一度だけ行います。
    const preparedMembers=prepareMembers(members);
    const previous=[...this.tracks.values()].filter(track=>track.visible);
    const edges=[];
    for(let fi=0;fi<prepared.length;fi++){
      const current=prepared[fi];if(!current.vector)continue;
      for(let pi=0;pi<previous.length;pi++){
        const prev=previous[pi];if(!prev.vector)continue;
        const overlap=intersectionOverUnion(current.face.box,prev.face.box);
        if(overlap<0.15)continue;
        const similarity=cosine(current.vector,prev.vector);
        if(similarity>=this.continuity)edges.push({fi,pi,score:0.6*similarity+0.4*overlap});
      }
    }
    const ambiguousFaces=new Set(),ambiguousPrevious=new Set();
    for(let fi=0;fi<prepared.length;fi++){
      const candidates=edges.filter(edge=>edge.fi===fi).sort((a,b)=>b.score-a.score);
      if(candidates.length>1&&candidates[0].score-candidates[1].score<this.ambiguityMargin)ambiguousFaces.add(fi);
    }
    for(let pi=0;pi<previous.length;pi++){
      const candidates=edges.filter(edge=>edge.pi===pi).sort((a,b)=>b.score-a.score);
      if(candidates.length>1&&candidates[0].score-candidates[1].score<this.ambiguityMargin)ambiguousPrevious.add(pi);
    }
    const assigned=new Map(),used=new Set();
    for(const edge of edges.sort((a,b)=>b.score-a.score||a.fi-b.fi||a.pi-b.pi)){
      if(ambiguousFaces.has(edge.fi)||ambiguousPrevious.has(edge.pi)||assigned.has(edge.fi)||used.has(edge.pi))continue;
      assigned.set(edge.fi,previous[edge.pi]);used.add(edge.pi);
    }
    for(const track of this.tracks.values())track.visible=false;
    const visible=prepared.map((current,fi)=>{
      let track=assigned.get(fi);
      if(!track){
        track={id:`face-${this.nextId++}`,epoch:0,votes:[],expressionEMA:null,timeline:[],selfReport:'',candidate:undefined,rawCandidate:null,ranking:[],face:current.face,vector:current.vector};
        this.tracks.set(track.id,track);
      }
      const ranking=current.vector?scorePrepared(current.vector,preparedMembers):[];
      const top=ranking[0],margin=ranking.length>1?top.score-ranking[1].score:1;
      const rawCandidate=top&&top.score>=threshold?top.member.id:null;
      const ambiguous=!!rawCandidate&&margin<MATCH_LIMITS.margin;
      const candidate=current.quality.ok&&!ambiguous?rawCandidate:null;
      if(track.candidate!==candidate||!current.quality.ok||ambiguous)clearEvidence(track);
      Object.assign(track,{face:current.face,vector:current.vector,visible:true,updatedAt:nowMs,frameKey,
        ranking,rawCandidate,candidate,margin,ambiguous,collision:false,qualityAccepted:current.quality.ok,
        votesRequired:camera?voteWindow:1,pendingReason:current.quality.reason,
        decision:'pending',stable:false});
      if(!current.quality.ok)return track;
      const probs=expression(current.face.expression);
      if(probs){track.expressionEMA=track.expressionEMA?track.expressionEMA.map((value,i)=>.7*value+.3*probs[i]):probs;track.timeline.push([...track.expressionEMA]);track.timeline=track.timeline.slice(-100);}
      if(!members.length){track.pendingReason='先に照合する顔を登録してください。';return track;}
      if(ambiguous){track.pendingReason='複数の登録と似ているため、判定を保留しています。';return track;}
      if(camera){track.votes.push(candidate);track.votes=track.votes.slice(-voteWindow);}
      track.stable=!camera||(track.votes.length===voteWindow&&track.votes.filter(value=>value===candidate).length>=Math.ceil(voteWindow*.6));
      track.decision=track.stable?(candidate?'matched':'unknown'):'pending';
      track.pendingReason=track.stable?'':'異なるフレームで同じ顔と候補を確認しています。';
      return track;
    });
    // 一つの登録が複数の枠へ同時に割り当てられたときは、人数として数えません。
    const candidates=new Map();
    for(const track of visible)if(track.rawCandidate&&track.qualityAccepted){const rows=candidates.get(track.rawCandidate)||[];rows.push(track);candidates.set(track.rawCandidate,rows);}
    for(const rows of candidates.values())if(rows.length>1)for(const track of rows){
      clearEvidence(track);track.collision=true;track.stable=false;track.decision='pending';
      track.pendingReason='同じ登録が複数の顔の候補です。';
    }
    for(const track of this.tracks.values())if(!track.visible){clearEvidence(track);track.candidate=null;track.rawCandidate=null;track.stable=false;track.decision='pending';}
    this.visible=visible;
    return this.current();
  }
}
