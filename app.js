// --- version (bump when you change assets) ---
const APP_VERSION = '1.0.0';
document.getElementById('appver').textContent = `v${APP_VERSION}`;
const MAX_VISIBLE_LOG = 10;   // show only the last 10 scans in UI
// --- tiny IndexedDB helper ---
const DB_NAME='biobank_pick'; const STORE='scans'; const META='meta';
function idb() { return new Promise((res,rej)=>{
  const req = indexedDB.open(DB_NAME, 2);
  req.onupgradeneeded = ()=>{ const db=req.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const s=db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
      s.createIndex('by_tube_id','tube_id',{unique:false});
    } else {
      const s=req.transaction.objectStore(STORE);
      if (!s.indexNames.contains('by_tube_id')) s.createIndex('by_tube_id','tube_id',{unique:false});
    }
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
  };
  req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);
});}
async function put(store, val){ const db=await idb();
  return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(val);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);});
}
async function getAll(store){ const db=await idb();
  return new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);});
}
async function setMeta(k,v){ const db=await idb();
  return new Promise((res,rej)=>{ const tx=db.transaction(META,'readwrite'); tx.objectStore(META).put(v,k);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);});
}
async function getMeta(k){ const db=await idb();
  return new Promise((res,rej)=>{ const tx=db.transaction(META,'readonly'); const req=tx.objectStore(META).get(k);
    req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);});
}
async function hasTube(tube){
  const db = await idb();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readonly');
    const idx=tx.objectStore(STORE).index('by_tube_id');
    const req=idx.get(tube);
    req.onsuccess=()=>res(!!req.result); req.onerror=()=>rej(req.error);
  });
}

// --- state & helpers ---
let pickIndex = new Map(), picked = new Set();
const $ = sel => document.querySelector(sel);
const norm = s => String(s||'').trim().toUpperCase();
const nowISO = ()=> new Date().toISOString();
const mode = ()=> document.querySelector('input[name="mode"]:checked')?.value || 'pick';
const ctxVal = id => document.getElementById(id).value.trim();

function flash(msg, cls){
  const res = document.getElementById('result');
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = msg;
  res.prepend(p);

  // 🧹 limit the visible log
  while (res.childElementCount > MAX_VISIBLE_LOG) {
    res.removeChild(res.lastElementChild);
  }
}
function setStatus(msg){ document.getElementById('status').textContent = msg; }

// --- picklist loading (offline via file picker) ---
document.getElementById('pickfile').addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text(); const rows = JSON.parse(text);
  pickIndex.clear(); rows.forEach(r=> pickIndex.set(norm(r.tube_id), r));
  await setMeta('picklist', rows);
  await setMeta('picklist_id', rows[0]?.picklist_id || file.name);
  flash(`Picklist loaded: ${pickIndex.size} tubes`, 'ok');
});

// restore picklist + operator on startup
(async ()=>{
  const cached = await getMeta('picklist');
  if (cached?.length) cached.forEach(r=> pickIndex.set(norm(r.tube_id), r));
  if(!await getMeta('operator')){
    const op = prompt('Operator initials?','');
    if (op) await setMeta('operator', op);
  }
  if (!(cached?.length)) { document.querySelector('input[name="mode"][value="free"]').checked = true; }
})();

// --- camera & scanning (BarcodeDetector only; simplest, offline) ---
async function scan() {
  const video = document.getElementById('video');

  // 1️⃣ Try native BarcodeDetector (if supported)
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('data_matrix')) {
        const det = new BarcodeDetector({formats:['data_matrix','qr_code']});
        const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
        video.srcObject = stream; await video.play();
        setStatus('Scanning (native)…');
        (function tick(){
          createImageBitmap(video).then(async bmp=>{
            const codes = await det.detect(bmp);
            if (codes.length) handleCode(codes[0].rawValue);
            requestAnimationFrame(tick);
          }).catch(()=>requestAnimationFrame(tick));
        })();
        return;
      }
    } catch (err) { console.warn('Native detector failed:', err); }
  }

  // 2️⃣ Fallback: ZXing (works on iOS)
  try {
    if (!window.ZXing) throw new Error('ZXing not loaded');
    const reader = new ZXing.BrowserMultiFormatReader();
    const devices = await reader.listVideoInputDevices();
    const backCam = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
    setStatus('Scanning (ZXing)…');
    await reader.decodeFromVideoDevice(backCam?.deviceId, video, (res, err) => {
      if (res) handleCode(res.getText());
    });
  } catch (err) {
    console.error(err);
    setStatus('No camera scanning support available.');
  }
}

async function handleCode(raw){
  const tube = norm(raw);
  const m = mode();

  // picklist mode (if list loaded)
  if (m==='pick' && pickIndex.size){
    const rec = pickIndex.get(tube);
    const entry = {
      ts: nowISO(), tube_id: tube, mode:'pick',
      result: rec ? 'ok' : 'not_in_picklist',
      freezer: rec?.freezer || '', rack: rec?.rack || '', box: rec?.box || '', pos: rec?.pos || '',
      picklist_id: (await getMeta('picklist_id')) || '',
      operator: (await getMeta('operator')) || '', device: navigator.userAgent
    };
    await upsertScanUnique(entry, 'first'); // or 'last' if you prefer the latest scan to win
    flash(entry.result==='ok' ? `OK ${tube} → ${entry.freezer}/${entry.rack}/${entry.box}/${entry.pos}`
                              : `NOT IN PICKLIST: ${tube}`,
         entry.result==='ok' ? 'ok' : 'err');
    return;
  }

  // free-scan mode
  const dup = await hasTube(tube);
  const entry = {
    ts: nowISO(), tube_id: tube, mode:'free_scan', result: dup ? 'duplicate' : 'new',
    freezer: ctxVal('ctx_freezer'), rack: ctxVal('ctx_rack'), box: ctxVal('ctx_box'), pos: ctxVal('ctx_pos'),
    operator: (await getMeta('operator')) || '', device: navigator.userAgent
  };
  await upsertScanUnique(entry, 'first'); // or 'last' if you prefer the latest scan to win
  flash(`${dup?'DUP':'OK'} ${tube}` + (entry.freezer?` → ${entry.freezer}/${entry.rack}/${entry.box}/${entry.pos}`:''), dup?'err':'ok');
  // play short beep
try {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, ctx.currentTime); // pitch
  osc.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.1); // 100 ms beep
} catch (_) {}

// light vibration if available
if (navigator.vibrate) navigator.vibrate(80);
}

// --- CSV export (offline) ---
document.getElementById('download').addEventListener('click', async ()=>{
  const log = await getAll(STORE);
  const header = ['timestamp','tube_id','mode','result','freezer','rack','box','pos','picklist_id','operator','device'];
  const rows = log.map(r=>[r.ts,r.tube_id,r.mode,r.result,r.freezer||'',r.rack||'',r.box||'',r.pos||'',r.picklist_id||'',r.operator||'',r.device||'']);
  const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const csv = [header, ...rows].map(r=>r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});

  // Web Share (Android) else download
  if (navigator.canShare && navigator.canShare({files:[new File([blob],'scan_log.csv',{type:'text/csv'})]})) {
    try { await navigator.share({files:[new File([blob],'scan_log.csv',{type:'text/csv'})], title:'Scan Log'}); return; } catch {}
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href:url, download:`scan_log_${Date.now()}.csv`});
  a.click(); URL.revokeObjectURL(url);
});

// --- UI wiring ---
document.getElementById('start').addEventListener('click', scan);

async function upsertScanUnique(entry, keep='first'){ // 'first' or 'last'
  const db = await idb();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('by_tube_id');

    // Look up existing row for this tube_id
    const req = idx.openCursor(entry.tube_id);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        if (keep === 'last') {
          // merge into existing (preserve id)
          const updated = { ...cur.value, ...entry };
          cur.update(updated);
        }
        // keep === 'first' -> do nothing (skip new duplicate)
        res();
      } else {
        store.add(entry);
        res();
      }
    };
    req.onerror = () => rej(req.error);
  });
}
