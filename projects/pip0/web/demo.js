/** All demo documents are fictional and are generated in this browser. */
const BLUE_PNG='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQSjtPEmIY1TCqYfhqAAD1eF8QWGbQsQAAAABJRU5ErkJggg==';
const RED_PNG='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO45RpKEmIY1TCqYfhqAABJdnQQxw+oPwAAAABJRU5ErkJggg==';
function binary(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}

// A real small PDF, including a cross-reference table. Its text is deliberately
// English ASCII so it needs no embedded fonts. These are not disguised TXT files.
function pdf(label) {
  const stream=`BT /F1 18 Tf 40 150 Td (${label}) Tj ET`;
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out='%PDF-1.4\n';const offsets=[0];
  objects.forEach((body,index)=>{offsets.push(out.length);out+=`${index+1} 0 obj\n${body}\nendobj\n`;});
  const xref=out.length;
  out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))out+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export function makeDemoEntries(now=Date.now()) {
  const day=offset=>{const date=new Date(now);date.setHours(12,0,0,0);date.setDate(date.getDate()+offset);return date.valueOf();};
  const monday=new Date(now);monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-((monday.getDay()+6)%7)-3);
  const lastWeek=monday.valueOf();
  const data=[
    {path:'ダウンロード/講義レポート.txt',text:'講義レポート\n振り子の周期をPythonで比較する演習です。長さを変えた結果をまとめました。\n',type:'text/plain',at:day(0)},
    {path:'ダウンロード/予算見積.csv',text:'項目,数量,金額\n実験用紙,3,900\n電池,4,800\n',type:'text/csv',at:lastWeek},
    {path:'ダウンロード/議事録.txt',text:'作品展示の会議\n決まったこと：デモを3つ用意する。次回までに展示用の説明を更新する。\n',type:'text/plain',at:day(-1)},
    {path:'ダウンロード/IMG_0042.png',bytes:binary(BLUE_PNG),type:'image/png',at:lastWeek,colour:'blue'},
    {path:'写真/青空の写真.png',bytes:binary(BLUE_PNG),type:'image/png',at:day(0),colour:'blue'},
    {path:'写真/赤い図.png',bytes:binary(RED_PNG),type:'image/png',at:day(-1),colour:'red'},
    {path:'ダウンロード/download.txt',text:'公園で見つけた植物の観察メモ\n葉の形と色を見比べました。\n',type:'text/plain',at:day(-2)},
    {path:'授業/report.pdf',bytes:pdf('Fictional lecture report'),type:'application/pdf',at:lastWeek},
    {path:'授業/発表スライド.pdf',bytes:pdf('Fictional presentation outline'),type:'application/pdf',at:day(-2)},
    {path:'メモ/音声メモ.txt',text:'音声の教材案\n高い音と低い音を聞き比べる。周波数を変えて波形も確認する。\n',type:'text/plain',at:day(-3)},
    {path:'ソース/解析コード.py',text:'"""架空の教材用データを集計します。"""\nvalues = [12, 18, 24]\nprint(sum(values) / len(values))\n',type:'text/x-python',at:day(0)},
    {path:'データ/実験データ.csv',text:'長さ_cm,周期_s\n20,0.90\n40,1.27\n60,1.55\n',type:'text/csv',at:day(-3)},
    {path:'初稿/レポート.txt',text:'演習レポートの初稿です。まだ結果の図はありません。\n',type:'text/plain',at:lastWeek},
    {path:'改訂/レポート.txt',text:'演習レポートの改訂版です。結果の図と考察を追加しました。\n',type:'text/plain',at:day(-1)},
    {path:'メモ/会計メモ.md',text:'# 展示の会計メモ\n\nこれはデモ用の架空データです。予算は5,000円とします。\n',type:'text/markdown',at:day(-4)},
  ];
  return data.map((item,index)=>{
    const name=item.path.split('/').at(-1);
    const parts=[item.bytes??item.text];
    const file=typeof File==='function'?new File(parts,name,{type:item.type,lastModified:item.at}):new Blob(parts,{type:item.type});
    return {id:`demo-${String(index+1).padStart(2,'0')}`,name,path:item.path,size:file.size,lastModified:item.at,file,
      ...(item.text?{text:item.text}:{}),
      ...(item.colour?{analysis:{colour:item.colour,note:'デモ画像の色（架空データ）'}}:{}),
    };
  });
}
