// =====================================================================
// Aide — AI Secretary
// Gemini API + Firebase (optional sync) + Tasks + Action Engine
// =====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, getDocs, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// =========== State & Storage Keys ===========
const LS = {
  key:'g_key', model:'g_model', profile:'g_profile', ground:'g_ground',
  fb:'g_fb_config'
};

const state = {
  apiKey:   localStorage.getItem(LS.key) || '',
  model:    localStorage.getItem(LS.model) || 'gemini-2.0-flash',
  profile:  localStorage.getItem(LS.profile) || '',
  grounding:localStorage.getItem(LS.ground) || 'on',
  fbConfig: localStorage.getItem(LS.fb) || '',
  user: null,
  history: [],
  tasks: [],
  library: [],
  pending: [],
  recording: null,
  taskFilter: 'all',
};

// =========== DOM helpers ===========
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const chatEl = $('#chat'), form=$('#form'), input=$('#input'), sendBtn=$('#sendBtn');
const preview=$('#preview'), fileInput=$('#fileInput');
const taskListEl=$('#taskList'), taskEmpty=$('#taskEmpty'), taskBadge=$('#taskBadge');
const libListEl=$('#libList'), libEmpty=$('#libEmpty');

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
function fmtTime(ts){const d=new Date(ts);return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;}
function fmtDate(ts){const d=new Date(ts);return `${d.getMonth()+1}/${d.getDate()}`;}
function escapeHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function iconFor(mime=''){
  if(mime.startsWith('image/'))return '🖼';
  if(mime.startsWith('audio/'))return '🎙';
  if(mime.includes('pdf'))return '📄';
  if(mime.includes('text')||mime.includes('json')||mime.includes('csv'))return '📝';
  return '📎';
}
function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}

// =========== Markdown-lite renderer ===========
function mdLite(s){
  let html = escapeHtml(s);
  // headings
  html = html.replace(/^### (.+)$/gm,'<h4>$1</h4>')
             .replace(/^## (.+)$/gm,'<h3>$1</h3>')
             .replace(/^# (.+)$/gm,'<h2>$1</h2>');
  // bold/italic/code
  html = html.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
             .replace(/`([^`]+)`/g,'<code>$1</code>');
  // links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  // bullets
  html = html.replace(/^[-•] (.+)$/gm,'• $1');
  // bare urls
  html = html.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g,(m,a,b)=>{
    if(/href="/.test(html.slice(Math.max(0,html.indexOf(b)-15),html.indexOf(b))))return m;
    return `${a}<a href="${b}" target="_blank" rel="noopener">${b}</a>`;
  });
  return html;
}

// =====================================================================
// IndexedDB (local cache) — works offline & without Firebase
// =====================================================================
let db;
async function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open('aide',2);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['messages','library','tasks'].forEach(s=>{
        if(!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:'id'});
      });
    };
    r.onsuccess=e=>{db=e.target.result;res();};
    r.onerror=()=>rej(r.error);
  });
}
const idb = {
  put:(s,v)=>new Promise((res,rej)=>{const r=db.transaction(s,'readwrite').objectStore(s).put(v);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}),
  del:(s,id)=>new Promise((res,rej)=>{const r=db.transaction(s,'readwrite').objectStore(s).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}),
  all:(s)=>new Promise((res,rej)=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}),
  clear:(s)=>new Promise((res,rej)=>{const r=db.transaction(s,'readwrite').objectStore(s).clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}),
};

// =====================================================================
// Firebase (optional cloud sync)
// =====================================================================
let fbApp=null, fbAuth=null, fbDb=null;
let unsubscribers = [];

function tryInitFirebase(){
  if(!state.fbConfig) return;
  try{
    const cfg = JSON.parse(state.fbConfig);
    fbApp = initializeApp(cfg);
    fbAuth = getAuth(fbApp);
    fbDb = getFirestore(fbApp);
    onAuthStateChanged(fbAuth, async user=>{
      state.user = user;
      $('#authLabel').textContent = user ? (user.displayName||'ログアウト') : 'Googleでログイン';
      if(user){
        await syncFromCloud();
        subscribeCloud();
        toast(`☁️ ${user.displayName} で同期中`);
      }else{
        unsubscribers.forEach(u=>u());
        unsubscribers = [];
      }
    });
  }catch(e){
    console.warn('Firebase init failed',e);
    toast('⚠️ Firebase設定が不正です');
  }
}

async function loginGoogle(){
  if(!fbAuth){toast('先に設定でFirebase設定を貼ってください');$('#settingsBtn').click();return;}
  try{
    await signInWithPopup(fbAuth, new GoogleAuthProvider());
  }catch(e){toast('ログイン失敗: '+e.message);}
}
async function logoutGoogle(){if(fbAuth)await signOut(fbAuth);$('#authLabel').textContent='Googleでログイン';toast('ログアウトしました');}

function userCol(name){return collection(fbDb,'users',state.user.uid,name);}

async function syncFromCloud(){
  if(!state.user || !fbDb) return;
  // messages
  const ms = await getDocs(query(userCol('messages'),orderBy('ts','asc')));
  state.history = ms.docs.map(d=>({id:d.id,...d.data()}));
  for(const m of state.history) await idb.put('messages',m);
  renderChat();
  // tasks
  const ts = await getDocs(query(userCol('tasks'),orderBy('ts','desc')));
  state.tasks = ts.docs.map(d=>({id:d.id,...d.data()}));
  for(const t of state.tasks) await idb.put('tasks',t);
  renderTasks();
  // library
  const ls = await getDocs(query(userCol('library'),orderBy('ts','desc')));
  state.library = ls.docs.map(d=>({id:d.id,...d.data()}));
  for(const l of state.library) await idb.put('library',l);
  renderLibrary();
}
function subscribeCloud(){
  unsubscribers.push(
    onSnapshot(query(userCol('messages'),orderBy('ts','asc')),snap=>{
      state.history = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderChat();
    }),
    onSnapshot(query(userCol('tasks'),orderBy('ts','desc')),snap=>{
      state.tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderTasks();
    }),
    onSnapshot(query(userCol('library'),orderBy('ts','desc')),snap=>{
      state.library = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderLibrary();
    }),
  );
}

// Unified persistence: writes to both IDB and Firestore (if logged in)
async function persist(kind, item){
  item.id = item.id || uid();
  await idb.put(kind, item);
  if(state.user && fbDb){
    try{ await setDoc(doc(fbDb,'users',state.user.uid,kind,item.id),item); }
    catch(e){console.warn('cloud write failed',e);}
  }
}
async function removeItem(kind, id){
  await idb.del(kind, id);
  if(state.user && fbDb){
    try{ await deleteDoc(doc(fbDb,'users',state.user.uid,kind,id)); }catch(e){}
  }
}

// =====================================================================
// Action Engine — generates deep links for routes / restaurants / etc.
// =====================================================================
function buildActionLinks(query){
  const links = [];
  const q = query || '';

  // Detect "A から B" or "A→B" or "A to B" route patterns
  const routeMatch = q.match(/(.+?)(?:から|→|->|から|to)\s*(.+?)(?:まで|の行き方|への行き方|$)/);
  if(routeMatch && /(行き方|ルート|乗り換え|移動|電車|バス|徒歩|車)/.test(q)){
    const [_, a, b] = routeMatch;
    const o=encodeURIComponent(a.trim()), d=encodeURIComponent(b.trim());
    links.push(
      {label:'🗺 Google Maps', url:`https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=transit`},
      {label:'🚆 ジョルダン乗換', url:`https://www.jorudan.co.jp/norikae/cgi/nori.cgi?eki1=${o}&eki2=${d}&Dym=&Ddate=&Dhour=&Dminute=&Cway=0&Csg=1`},
      {label:'🚉 Yahoo!乗換', url:`https://transit.yahoo.co.jp/search/result?from=${o}&to=${d}`}
    );
  }

  // Restaurant / cafe / shop in a place
  const placeMatch = q.match(/(.+?)(?:で|の)([^、。\n]*?(寿司|居酒屋|焼肉|カフェ|ラーメン|レストラン|ランチ|ディナー|定食|和食|イタリアン|フレンチ|中華|韓国料理|バー)[^、。\n]*)/);
  if(placeMatch){
    const place = placeMatch[1].trim(), kind = placeMatch[2].trim();
    const term = encodeURIComponent(`${place} ${kind}`);
    links.push(
      {label:'🍽 食べログで検索', url:`https://tabelog.com/rstLst/?vs=1&sw=${term}`},
      {label:'🗺 Maps で探す', url:`https://www.google.com/maps/search/${term}`},
      {label:'🔥 ホットペッパー', url:`https://www.hotpepper.jp/CSP/hp200/doSearch.do?freeWord=${term}`}
    );
  }else if(/(店|レストラン|カフェ|寿司|焼肉|居酒屋|ラーメン)/.test(q) && !routeMatch){
    const term = encodeURIComponent(q);
    links.push(
      {label:'🍽 食べログで検索', url:`https://tabelog.com/rstLst/?vs=1&sw=${term}`},
      {label:'🗺 Maps で探す', url:`https://www.google.com/maps/search/${term}`}
    );
  }

  // Hotel / 宿
  if(/(ホテル|宿|旅館|宿泊)/.test(q)){
    const term = encodeURIComponent(q);
    links.push(
      {label:'🏨 楽天トラベル', url:`https://travel.rakuten.co.jp/dsearch/?f_keyword=${term}`},
      {label:'🏨 Booking.com', url:`https://www.booking.com/search.html?ss=${term}`}
    );
  }

  // Flight / 航空券
  if(/(航空券|フライト|飛行機)/.test(q)){
    links.push(
      {label:'✈️ Google Flights', url:`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`},
      {label:'✈️ Skyscanner', url:`https://www.skyscanner.jp/`}
    );
  }

  // Generic place / weather / news shortcuts
  if(/(天気)/.test(q)){
    const m = q.match(/(.+?)の?天気/);
    const place = m?m[1].trim():'東京';
    links.push({label:'🌤 tenki.jp', url:`https://tenki.jp/search/?keyword=${encodeURIComponent(place)}`});
  }

  return links;
}

// =====================================================================
// Rendering — Chat
// =====================================================================
function renderChat(){
  chatEl.innerHTML='';
  if(!state.history.length){
    const div=document.createElement('div');
    div.className='msg sys';
    div.textContent='こんにちは！あなた専属のAI秘書です。右下の入力欄から何でもお願いできます。📎でファイルや音声、🎤で録音もできます。';
    chatEl.appendChild(div);
    return;
  }
  for(const m of state.history){
    renderOneMsg(m);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderOneMsg(m){
  const div=document.createElement('div');
  div.className = 'msg '+(m.role==='user'?'u':'a');

  const bubble = document.createElement('div');
  bubble.className='bubble';

  if(m.files && m.files.length){
    for(const f of m.files){
      const c=document.createElement('div');
      c.className='attachment-card';
      c.innerHTML=`<span class="ic">${iconFor(f.mime)}</span><div><div class="name">${escapeHtml(f.name)}</div><div class="sz">${(f.size/1024).toFixed(1)} KB</div></div>`;
      bubble.appendChild(c);
    }
  }

  if(m.text){
    const t=document.createElement('div');
    t.innerHTML=mdLite(m.text);
    bubble.appendChild(t);
  }

  // Action strip
  const queryForActions = (m.role==='user'?m.text:(state.history.find((x,i)=>state.history[i+1]===m)?.text || m.text));
  const actions = m.role==='assistant' ? buildActionLinks(queryForActions||'') : [];
  if(actions.length){
    const strip=document.createElement('div');
    strip.className='action-strip';
    strip.innerHTML = actions.map(a=>`<a href="${a.url}" target="_blank" rel="noopener">${a.label}</a>`).join('');
    bubble.appendChild(strip);
  }

  if(m.sources && m.sources.length){
    const s=document.createElement('div');
    s.className='sources';
    s.innerHTML='<b>参考</b>'+m.sources.map(x=>`<a href="${x.url}" target="_blank">${escapeHtml(x.title||x.url)}</a>`).join('');
    bubble.appendChild(s);
  }

  div.appendChild(bubble);
  const meta=document.createElement('div');
  meta.className='meta';
  meta.textContent=fmtTime(m.ts);
  div.appendChild(meta);

  chatEl.appendChild(div);
}

// =====================================================================
// Tasks
// =====================================================================
function renderTasks(){
  let items = state.tasks.slice();
  if(state.taskFilter==='todo') items = items.filter(t=>!t.done);
  if(state.taskFilter==='done') items = items.filter(t=>t.done);

  const remaining = state.tasks.filter(t=>!t.done).length;
  if(remaining){taskBadge.textContent=remaining;taskBadge.classList.add('show');}
  else taskBadge.classList.remove('show');

  taskListEl.innerHTML='';
  taskEmpty.style.display = items.length ? 'none' : 'flex';

  for(const t of items){
    const el=document.createElement('div');
    el.className='task'+(t.done?' done':'');
    const overdue = t.due && !t.done && new Date(t.due) < new Date(new Date().toDateString());
    el.innerHTML = `
      <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="body">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="meta-row">
          ${t.due?`<span class="due${overdue?' overdue':''}">📅 ${t.due}</span>`:''}
          <span>追加 ${fmtDate(t.ts)}</span>
        </div>
        ${t.note?`<div class="note">${escapeHtml(t.note)}</div>`:''}
      </div>
      <button class="del" data-id="${t.id}">削除</button>
    `;
    el.querySelector('.check').onclick=async()=>{
      t.done = !t.done;
      await persist('tasks',t);
      renderTasks();
    };
    el.querySelector('.del').onclick=async()=>{
      if(!confirm('削除しますか？'))return;
      state.tasks = state.tasks.filter(x=>x.id!==t.id);
      await removeItem('tasks',t.id);
      renderTasks();
    };
    taskListEl.appendChild(el);
  }
}

async function addTask(title, due, note){
  const t={id:uid(),title,due:due||null,note:note||'',done:false,ts:Date.now()};
  state.tasks.unshift(t);
  await persist('tasks',t);
  renderTasks();
}

$('#addTaskBtn').onclick=()=>{
  $('#taskTitle').value='';$('#taskDue').value='';$('#taskNote').value='';
  $('#taskModal').classList.add('show');
};
$('#closeTask').onclick=()=>$('#taskModal').classList.remove('show');
$('#saveTask').onclick=async()=>{
  const t=$('#taskTitle').value.trim();
  if(!t)return;
  await addTask(t,$('#taskDue').value,$('#taskNote').value.trim());
  $('#taskModal').classList.remove('show');
  toast('✓ タスク追加');
};
$$('.chip[data-filter]').forEach(c=>c.onclick=()=>{
  $$('.chip[data-filter]').forEach(x=>x.classList.toggle('active',x===c));
  state.taskFilter=c.dataset.filter;renderTasks();
});

// =====================================================================
// Library
// =====================================================================
function renderLibrary(){
  libListEl.innerHTML='';
  libEmpty.style.display = state.library.length ? 'none':'flex';
  for(const it of state.library){
    const card=document.createElement('div');
    card.className='lib-card';
    card.innerHTML=`
      <div class="head">
        <div class="ic">${iconFor(it.mime)}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="ts">${new Date(it.ts).toLocaleString('ja-JP')}</div>
        </div>
      </div>
      <div class="sum">${escapeHtml(it.summary||'(要約なし)')}</div>
      <div class="row">
        <button data-act="ask">質問する</button>
        <button data-act="view">要約を見る</button>
        <button class="del" data-act="del">削除</button>
      </div>`;
    card.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
      const act=b.dataset.act;
      if(act==='del'){
        if(!confirm('削除しますか？'))return;
        state.library = state.library.filter(x=>x.id!==it.id);
        await removeItem('library',it.id);renderLibrary();
      }else if(act==='view'){
        switchView('chat');
        const m={id:uid(),role:'assistant',text:`**${it.name} の要約**\n\n${it.summary}`,ts:Date.now()};
        state.history.push(m);await persist('messages',m);renderChat();
      }else if(act==='ask'){
        switchView('chat');
        if(it.b64) state.pending.push({name:it.name,mime:it.mime,size:0,b64:it.b64,kind:'lib'});
        renderPreview();
        input.value=`「${it.name}」について教えて: `;input.focus();autosize();
      }
    });
    libListEl.appendChild(card);
  }
}

// =====================================================================
// View switching
// =====================================================================
function switchView(name){
  $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('hidden',v.id!=='view-'+name));
  $('#sidebar').classList.remove('open');
  $('#scrim')?.classList.remove('show');
}
$$('.nav-item[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#menuBtn').onclick=()=>{
  $('#sidebar').classList.toggle('open');
};

// =====================================================================
// Settings modal
// =====================================================================
$('#settingsBtn').onclick=()=>{
  $('#apiKey').value=state.apiKey;
  $('#model').value=state.model;
  $('#profile').value=state.profile;
  $('#grounding').value=state.grounding;
  $('#firebaseConfig').value=state.fbConfig;
  $('#settingsModal').classList.add('show');
};
$('#closeSettings').onclick=()=>$('#settingsModal').classList.remove('show');
$('#saveSettings').onclick=()=>{
  state.apiKey=$('#apiKey').value.trim();
  state.model=$('#model').value;
  state.profile=$('#profile').value.trim();
  state.grounding=$('#grounding').value;
  const newFb = $('#firebaseConfig').value.trim();
  const fbChanged = newFb !== state.fbConfig;
  state.fbConfig = newFb;
  localStorage.setItem(LS.key,state.apiKey);
  localStorage.setItem(LS.model,state.model);
  localStorage.setItem(LS.profile,state.profile);
  localStorage.setItem(LS.ground,state.grounding);
  localStorage.setItem(LS.fb,state.fbConfig);
  $('#settingsModal').classList.remove('show');
  toast('✓ 設定を保存しました');
  if(fbChanged && state.fbConfig){
    setTimeout(()=>location.reload(),600);
  }
};

$('#exportBtn').onclick=()=>{
  const dump={messages:state.history,tasks:state.tasks,library:state.library,profile:state.profile};
  const blob=new Blob([JSON.stringify(dump,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`aide-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  toast('📤 エクスポート完了');
};

// Auth button
$('#authBtn').onclick=()=>{
  if(state.user) logoutGoogle();
  else loginGoogle();
};

// =====================================================================
// Quick actions
// =====================================================================
const QUICK = [
  '渋谷から成田空港 今夜18時 最適ルート',
  '恵比寿で個室寿司 2万円以内 3件比較',
  '明日の東京の天気と服装',
  '来週月曜10時 歯医者の予約をタスクに追加',
  '添付した資料を議事録形式にまとめて',
  '京都2泊3日 桜シーズンの旅程を組んで',
];
function renderQuick(){
  const el=$('#quickRow');el.innerHTML='';
  QUICK.forEach(q=>{
    const b=document.createElement('button');b.textContent=q;
    b.onclick=()=>{input.value=q;input.focus();autosize();};
    el.appendChild(b);
  });
}

// =====================================================================
// Attachments + recording
// =====================================================================
$('#attachBtn').onclick=()=>fileInput.click();
fileInput.onchange=async e=>{
  for(const f of e.target.files){
    if(f.size>20*1024*1024){toast(`${f.name}: 20MB超過`);continue;}
    const b64=await fileToB64(f);
    state.pending.push({name:f.name,mime:f.type||'application/octet-stream',size:f.size,b64});
  }
  fileInput.value='';renderPreview();
};
function fileToB64(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(f);});}

function renderPreview(){
  if(!state.pending.length){preview.classList.remove('show');preview.innerHTML='';return;}
  preview.classList.add('show');
  preview.innerHTML=state.pending.map((p,i)=>
    `<span class="chip">${iconFor(p.mime)} ${escapeHtml(p.name)} <button data-i="${i}">✕</button></span>`
  ).join('');
  preview.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    state.pending.splice(+b.dataset.i,1);renderPreview();
  });
}

$('#micBtn').onclick=async()=>{
  const btn=$('#micBtn');
  if(state.recording){state.recording.stop();return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const rec=new MediaRecorder(stream);
    const chunks=[];
    rec.ondataavailable=e=>chunks.push(e.data);
    rec.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      btn.classList.remove('rec');
      state.recording=null;
      const blob=new Blob(chunks,{type:'audio/webm'});
      const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob);});
      const name=`録音_${new Date().toLocaleString('ja-JP').replace(/[\/\s:]/g,'-')}.webm`;
      state.pending.push({name,mime:'audio/webm',size:blob.size,b64});
      renderPreview();
      if(!input.value)input.value='この録音を文字起こしして議事録にまとめて。発言者・決定事項・ToDoを分けて整理。';
      autosize();
    };
    state.recording=rec;rec.start();
    btn.classList.add('rec');
  }catch(e){toast('マイク権限が必要です');}
};

// =====================================================================
// Gemini API call
// =====================================================================
async function callGemini(userText, attachments){
  if(!state.apiKey) throw new Error('APIキーを設定してください');

  const today=new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const systemInstruction = {parts:[{text:
`あなたは「Aide」という超優秀な個人秘書AI。本物のパーソナル秘書のように、依頼を正確に理解し、実行可能で具体的に行動する。

【今日の日付】${today}
【ユーザー情報】${state.profile||'(未設定)'}

【行動方針】
1. 日本語で、簡潔かつ実用的に回答する
2. 見出しと箇条書きを積極的に使う
3. 添付ファイルがあれば、要点抽出/要約/議事録化/翻訳など、依頼内容に応じて処理する
4. 議事録モード: 日時/参加者/議題/決定事項/ToDo(担当・期限)で構造化
5. 推測と事実は明確に区別し、不確かな点は「要確認」と明示する
6. 最新情報が必要な質問はGoogle検索を使う

【タスク自動抽出】
ユーザーが「○○して」「○月○日に○○」「明日までに○○」のようにタスクっぽい依頼をした場合、回答の最後に必ず以下のJSONブロックを出力する（依頼がなければ出力しない）:
\`\`\`task
{"title":"歯医者の予約","due":"2026-04-12","note":"午後で"}
\`\`\`
複数あるなら複数行のJSON。dueはYYYY-MM-DD形式、不明ならnull。

【ルート・予約案内】
場所への移動・店探し・予約系は、リンクをワンタップで開けるよう、本文中で **店名・場所** を明確に書く。実装側がGoogle Maps/食べログ等の検索リンクを自動付与するので、URLは自分で書かなくてよい。`}]};

  const contents=[];
  for(const m of state.history.slice(-20)){
    const parts=[];
    if(m.text) parts.push({text:m.text});
    if(m.files && m.role==='user') parts.push({text:'[添付: '+m.files.map(f=>f.name).join(', ')+']'});
    if(parts.length) contents.push({role:m.role==='user'?'user':'model',parts});
  }
  const newParts=[];
  if(userText) newParts.push({text:userText});
  for(const a of attachments||[]) newParts.push({inlineData:{mimeType:a.mime,data:a.b64}});
  contents.push({role:'user',parts:newParts});

  const body = {systemInstruction, contents, generationConfig:{temperature:0.7,maxOutputTokens:4096}};
  if(state.grounding==='on') body.tools=[{google_search:{}}];

  const url=`https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const t=await res.text();throw new Error(res.status+': '+t.slice(0,400));}
  const data=await res.json();
  const cand=data.candidates?.[0];
  let text=(cand?.content?.parts||[]).map(p=>p.text||'').join('').trim() || '(空の応答)';

  // Parse out task blocks
  const tasks=[];
  text = text.replace(/```task\s*([\s\S]+?)```/g,(m,j)=>{
    try{const o=JSON.parse(j);tasks.push(o);}catch(e){}
    return '';
  }).trim();

  // grounding sources
  const sources=[];
  const gm=cand?.groundingMetadata;
  if(gm?.groundingChunks){
    gm.groundingChunks.forEach(c=>{if(c.web?.uri)sources.push({url:c.web.uri,title:c.web.title});});
  }
  return {text,sources,tasks};
}

// =====================================================================
// Submit
// =====================================================================
form.onsubmit=async e=>{
  e.preventDefault();
  const text=input.value.trim();
  const atts=state.pending.slice();
  if(!text && !atts.length) return;
  if(!state.apiKey){toast('APIキーを設定してください');$('#settingsBtn').click();return;}

  input.value='';state.pending=[];renderPreview();autosize();

  const userMsg={id:uid(),role:'user',text,files:atts.map(a=>({name:a.name,mime:a.mime,size:a.size})),ts:Date.now()};
  state.history.push(userMsg);
  await persist('messages',userMsg);
  renderChat();

  sendBtn.disabled=true;
  $('#chatStatus').textContent='考え中…';

  // thinking placeholder
  const ph={id:'_ph',role:'assistant',text:'考え中',ts:Date.now()};
  state.history.push(ph);renderChat();
  chatEl.lastChild?.classList.add('thinking');

  try{
    const {text:answer,sources,tasks}=await callGemini(text,atts);
    state.history = state.history.filter(m=>m.id!=='_ph');
    const aMsg={id:uid(),role:'assistant',text:answer,sources,ts:Date.now()};
    state.history.push(aMsg);
    await persist('messages',aMsg);
    renderChat();

    // Auto-create tasks
    for(const t of tasks){
      if(t && t.title) await addTask(t.title,t.due,t.note);
    }
    if(tasks.length) toast(`✓ タスクを${tasks.length}件追加しました`);

    // Auto-store attachments to library with summary
    for(const a of atts){
      if(a.kind==='lib') continue;
      const it={id:uid(),name:a.name,mime:a.mime,size:a.size,
        summary: (atts.length===1 && /要約|まとめ|議事録|文字起こし/.test(text))? answer : (await summarizeFile(a)),
        b64:a.b64, ts:Date.now()};
      state.library.unshift(it);
      await persist('library',it);
    }
    if(atts.filter(a=>a.kind!=='lib').length){renderLibrary();toast('📚 資料庫に保存しました');}
  }catch(err){
    state.history = state.history.filter(m=>m.id!=='_ph');
    renderChat();
    toast('❌ '+err.message);
    console.error(err);
  }finally{
    sendBtn.disabled=false;
    $('#chatStatus').textContent='準備完了';
  }
};

async function summarizeFile(att){
  const prompt = att.mime.startsWith('audio/')
    ? 'この音声を文字起こしし、要点を5〜10行で要約。重要な数字・固有名詞・結論を含めて。'
    : 'この資料の要点を日本語で5〜10行で要約。重要な数字・固有名詞・結論を漏らさずに。';
  try{const r=await callGemini(prompt,[att]);return r.text;}catch(e){return '(要約失敗)';}
}

function autosize(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px';}
input.addEventListener('input',autosize);
input.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!/Mobi/.test(navigator.userAgent)){
    e.preventDefault();form.requestSubmit();
  }
});

// =====================================================================
// Init
// =====================================================================
(async()=>{
  await openDB();
  state.history = (await idb.all('messages')).sort((a,b)=>a.ts-b.ts);
  state.tasks   = (await idb.all('tasks')).sort((a,b)=>b.ts-a.ts);
  state.library = (await idb.all('library')).sort((a,b)=>b.ts-a.ts);
  renderChat();renderTasks();renderLibrary();renderQuick();
  tryInitFirebase();
  if(!state.apiKey){
    setTimeout(()=>toast('右下の⚙設定からGemini APIキーを入力してください'),500);
  }
})();
