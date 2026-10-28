const APP_VERSION = "M0-v1";
const DB_NAME = "how-m0", STORE = "records";
const $ = id => document.getElementById(id);
const logEl = $("log");
function log(m){ logEl.textContent = new Date().toLocaleTimeString()+"  "+m+"\n"+logEl.textContent; }

function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME,1);
    r.onupgradeneeded = ()=>r.result.createObjectStore(STORE,{keyPath:"id"});
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
async function getAll(){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const q = db.transaction(STORE).objectStore(STORE).getAll();
    q.onsuccess = ()=>res(q.result.sort((a,b)=>a.id<b.id?-1:1));
    q.onerror = ()=>rej(q.error);
  });
}
async function addRecord(title){
  const db = await openDB();
  const rec = {id:crypto.randomUUID(), title, createdAt:new Date().toISOString()};
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = ()=>res(rec);
    tx.onabort = ()=>rej(tx.error||new Error("aborted"));
  });
}
async function sha256(text){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function fingerprint(){
  const recs = await getAll();
  return recs.length+" records, checksum "+(await sha256(JSON.stringify(recs))).slice(0,12);
}
function replaceAll(records, simulateFail){
  return openDB().then(db=>new Promise((res,rej)=>{
    const tx = db.transaction(STORE,"readwrite");
    const s = tx.objectStore(STORE);
    tx.oncomplete = ()=>res();
    tx.onabort = ()=>rej(tx.error||new Error("Transaction aborted"));
    s.clear();
    const failAt = Math.floor(records.length/2);
    for(let i=0;i<records.length;i++){
      s.put(records[i]);
      if(simulateFail && i===failAt){ tx.abort(); return; }
    }
    if(simulateFail && records.length===0) tx.abort();
  }));
}

async function showList(){
  const recs = await getAll();
  $("list").textContent = recs.length+" record(s)\n"+recs.map(r=>"- "+r.title+"  ["+r.id.slice(0,8)+"]").join("\n");
}
async function showInfo(){
  const lines = ["App version: "+APP_VERSION];
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
  lines.push("Running as installed app: "+standalone);
  lines.push("Online now: "+navigator.onLine);
  lines.push("Service worker controlling page: "+!!navigator.serviceWorker?.controller);
  try{
    if(navigator.storage?.persisted) lines.push("Persistent storage granted: "+await navigator.storage.persisted());
    if(navigator.storage?.estimate){ const e = await navigator.storage.estimate(); lines.push("Storage used/quota (bytes): "+e.usage+" / "+e.quota); }
  }catch(e){ lines.push("Storage info error: "+e.message); }
  lines.push("User agent: "+navigator.userAgent);
  $("info").textContent = lines.join("\n");
}
async function requestPersist(){
  try{ if(navigator.storage?.persist){ const g = await navigator.storage.persist(); log("Persistent storage request result: "+g); } }catch(e){ log("persist() error: "+e.message); }
}

async function buildBackup(){
  const records = await getAll();
  return JSON.stringify({
    format:"house-of-worship-m0-backup", backupVersion:1, appVersion:APP_VERSION,
    exportedAt:new Date().toISOString(), count:records.length,
    checksum:await sha256(JSON.stringify(records)), records
  },null,1);
}
function fileName(){ return "how-m0-backup-"+new Date().toISOString().slice(0,10)+".json"; }
async function exportShare(){
  const text = await buildBackup();
  const file = new File([text], fileName(), {type:"application/json"});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file], title:file.name}); log("Share sheet completed or closed."); return; }
    catch(e){ log("Share not completed: "+e.message); return; }
  }
  log("File sharing not supported here. Use 'Export as download'.");
}
async function exportDownload(){
  const text = await buildBackup();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text],{type:"application/json"}));
  a.download = fileName(); a.click();
  log("Download started: "+a.download);
}

let pending = null;
async function validate(text){
  const issues = []; let d;
  try{ d = JSON.parse(text); }catch(e){ return {issues:["Not valid JSON."]}; }
  if(d.format!=="house-of-worship-m0-backup") issues.push("Wrong format.");
  if(d.backupVersion!==1) issues.push("Unsupported backup version: "+d.backupVersion);
  if(!Array.isArray(d.records)) { issues.push("Records missing."); return {issues}; }
  const ids = new Set();
  d.records.forEach((r,i)=>{
    if(!r || typeof r.id!=="string" || typeof r.title!=="string") issues.push("Record "+i+" is malformed.");
    else { if(ids.has(r.id)) issues.push("Duplicate ID in file: "+r.id); ids.add(r.id); }
  });
  if(d.count!==d.records.length) issues.push("Count mismatch.");
  if(d.checksum!==await sha256(JSON.stringify(d.records))) issues.push("Checksum mismatch (file altered or damaged).");
  return {issues, data:d};
}

$("add").onclick = async()=>{
  const t = $("title").value.trim();
  if(!t){ log("Enter a title first."); return; }
  await addRecord(t); $("title").value=""; log("Added: "+t); showList(); requestPersist(); showInfo();
};
$("refresh").onclick = ()=>{ showList(); showInfo(); };
$("share").onclick = exportShare;
$("download").onclick = exportDownload;
$("file").onchange = async e=>{
  pending = null; $("replace").disabled = true;
  const f = e.target.files[0]; if(!f) return;
  const v = await validate(await f.text());
  if(v.issues.length){
    $("preview").textContent = "REJECTED. Library unchanged.\n- "+v.issues.join("\n- ");
    log("Import rejected: "+v.issues.length+" issue(s)."); return;
  }
  pending = v.data;
  $("preview").textContent = "VALID. Records: "+v.data.count+"\nBackup app version: "+v.data.appVersion+"\nExported: "+v.data.exportedAt+"\nCurrent library: "+await fingerprint();
  $("replace").disabled = false;
};
$("replace").onclick = async()=>{
  if(!pending) return;
  if(!confirm("Replace the current library with this backup? Current data will be replaced.")) { log("Replace cancelled. Library unchanged."); return; }
  const before = await fingerprint();
  try{
    await replaceAll(pending.records, $("fail").checked);
    log("Replace committed. Before: "+before+" | After: "+await fingerprint());
  }catch(e){
    log("Replace FAILED: "+e.message+" | Before: "+before+" | After: "+await fingerprint()+(before===(await fingerprint())?"  -> UNCHANGED":"  -> CHANGED (problem)"));
  }
  showList();
};
$("failtest").onclick = async()=>{
  const before = await fingerprint();
  try{ await replaceAll([{id:"x1",title:"a"},{id:"x2",title:"b"},{id:"x3",title:"c"}], true); }
  catch(e){ log("Forced failure: "+e.message); }
  const after = await fingerprint();
  log("Failed-write test. Before: "+before+" | After: "+after+(before===after?"  -> UNCHANGED (expected)":"  -> CHANGED (problem)"));
  showList();
};

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").then(()=>log("Service worker registered.")).catch(e=>log("SW error: "+e.message));
  navigator.serviceWorker.addEventListener("controllerchange",()=>log("New version active. Close and reopen the app."));
}
window.addEventListener("online",()=>{log("Network: online");showInfo();});
window.addEventListener("offline",()=>{log("Network: offline");showInfo();});
showList(); showInfo();
