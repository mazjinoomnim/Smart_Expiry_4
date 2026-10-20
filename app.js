import { DEVICE_API_URL } from './device-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { getMessaging, getToken, isSupported, deleteToken } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { VAPID_PUBLIC_KEY } from './push-config.js';
const catalog={cookie:{id:'cookie',name:'Cookie',emoji:'🍪',category:'Bakery · Store in a cool, dry place',mfg:'2026-10-15',exp:'2026-10-17'},coffee:{id:'coffee',name:'Coffee',emoji:'☕',category:'Beverage · Follow label storage instructions',mfg:'2026-10-15',exp:'2026-10-22'},yogurt:{id:'yogurt',name:'Yogurt',emoji:'🍓',category:'Dairy · Keep chilled',mfg:'2026-09-20',exp:'2026-10-11'},bread:{id:'bread',name:'Bread',emoji:'🍞',category:'Bakery · Store in a cool place',mfg:'2026-10-10',exp:'2026-10-16'},milk:{id:'milk',name:'Fresh Milk',emoji:'🥛',category:'Dairy · Keep chilled',mfg:'2026-09-25',exp:'2026-10-25'},burger:{id:'burger',name:'Hamburger',emoji:'🍔',category:'Prepared food · Keep chilled',mfg:'2026-10-14',exp:'2026-10-16'},broccoli:{id:'broccoli',name:'Broccoli',emoji:'🥦',category:'Vegetable · Keep chilled',mfg:'2026-10-14',exp:'2026-10-20'},beef:{id:'beef',name:'Beef',emoji:'🥩',category:'Raw meat · Keep refrigerated',mfg:'2026-10-14',exp:'2026-10-17'},sausage:{id:'sausage',name:'Sausage',emoji:'🌭',category:'Processed meat · Keep refrigerated',mfg:'2026-10-14',exp:'2026-10-22'},eggs:{id:'eggs',name:'Fresh Eggs',emoji:'🥚',category:'Eggs · Keep refrigerated',mfg:'2026-10-10',exp:'2026-10-24'}};
const $=id=>document.getElementById(id);
const configured=!!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
let auth,db,user=null,unsubscribe=null,tracked=[],products={},filter='all',current=null;
let pairedDevices=[];
let acknowledgedIds=new Set();
let acknowledgeBusy=new Set();
let pendingProduct=null;
let firebaseApp=null;
let messaging=null;
let pushRegisterGeneration=0;
let pushRegistrationBusy=false;
let qrScanner=null,scannerBusy=false,scannerDone=false,qrLibraryPromise=null;
const urlProduct=(new URLSearchParams(location.search).get('product')||'').toLowerCase().trim();
const validQrProduct=!!catalog[urlProduct];
// Preserve QR link before showList clears the query string.
const incomingQRLink = new URLSearchParams(location.search).has('data') || (new URLSearchParams(location.search).has('name') && new URLSearchParams(location.search).has('exp')) ? location.href : null;
let incomingQRHandled = false;
const productById=id=>(pendingProduct&&pendingProduct.id===id?pendingProduct:products[id]||catalog[id]);
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(msg){$('notice').hidden=!msg;$('notice').textContent=msg||''}
function daysLeft(exp){const d=new Date(exp+'T00:00:00');const n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate());return Math.round((d-t)/86400000)}
function state(p){const d=daysLeft(p.exp);return {d,type:d<=0?'expired':d<=3?'soon':'fresh',label:d<=0?'Expired':d<=3?'Expiring soon':'Fresh',days:d<0?`${-d} days ago`:d===0?'Expires today':`${d} days left`}}
function todayISO(){const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`}
function fmt(s){return new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
function render(){const items=tracked.map(id=>productById(id)).filter(Boolean);$('count').textContent=items.length;const counts={all:items.length,fresh:0,soon:0,expired:0};items.forEach(p=>counts[state(p).type]++);document.querySelectorAll('[data-filter]').forEach(b=>{const k=b.dataset.filter;b.textContent=`${k==='all'?'All':k==='soon'?'Soon':k[0].toUpperCase()+k.slice(1)} ${counts[k]}`;b.classList.toggle('selected',filter===k)});const expired=items.filter(p=>state(p).type==='expired');$('alert').hidden=!expired.length;$('alert').textContent=expired.length?`${expired.map(p=>p.name).join(', ')} expired. Check your paired M5 for alerts.`:'';const list=$('products');list.replaceChildren();const shown=items.filter(p=>filter==='all'||state(p).type===filter);if(!shown.length){list.innerHTML=items.length===0?'<div class="emptyState"><div class="emptyIcon">📦</div><h2>No products yet</h2><p>Scan a SmartExpiry QR code to add a product automatically.</p></div>':'<p class="empty">No products in this category.</p>';return}shown.forEach(p=>{const s=state(p),row=document.createElement('div');row.className='item';row.dataset.productId=p.id;const open=document.createElement('button');open.className='productOpen';open.innerHTML=`<div class="emoji">${escapeHTML(p.emoji)}</div><div class="productInfo"><div class="name">${escapeHTML(p.name)}</div><div class="exp">EXP ${escapeHTML(fmt(p.exp))}</div></div><div class="itemMeta"><span class="pill ${s.type}">${s.label}</span><div class="daysText">${s.days}</div></div>`;open.onclick=()=>showDetail(p.id);const del=document.createElement('button');del.className='remove';del.textContent='🗑';del.title=`Remove ${p.name}`;del.setAttribute('aria-label',del.title);del.onclick=async()=>{if(!confirm(`Remove ${p.name} from My Products?`))return;try{await deleteDoc(doc(db,'users',user.uid,'products',p.id))}catch(e){notice('Remove failed: '+e.message)}};row.append(open,del);
if(s.type==='expired'){
 const ack=document.createElement('button');ack.type='button';ack.className='acknowledgeBtn';
 const acknowledged=acknowledgedIds.has(p.id);ack.textContent=acknowledged?'Acknowledged ✓':'Acknowledge';
 ack.disabled=acknowledged||acknowledgeBusy.has(p.id);
 ack.onclick=async()=>{if(!user||ack.disabled)return;acknowledgeBusy.add(p.id);ack.disabled=true;ack.textContent='Saving...';try{await deviceRequest('/acknowledge','POST',{productId:p.id,exp:p.exp});acknowledgedIds.add(p.id);render();notice(p.name+' acknowledged. M5 will stop repeating this alert after its next sync.')}catch(e){notice('Acknowledge failed: '+e.message);render()}finally{acknowledgeBusy.delete(p.id)}};
 row.append(ack);
}
list.append(row)})}
function showList(){pendingProduct=null;closeScanner();current=null;$('listPage').hidden=false;$('detailPage').hidden=true;history.replaceState(null,'',location.pathname);$('scanDock').hidden=!user;render()}
function showDetail(id){const p=productById(id);if(!p)return;closeScanner();$('scanDock').hidden=true;current=id;$('listPage').hidden=true;$('detailPage').hidden=false;$('detailEmoji').textContent=p.emoji;$('detailName').textContent=p.name;$('detailCategory').textContent=p.category;$('detailMfg').textContent=fmt(p.mfg);$('detailExp').textContent=fmt(p.exp);$('todayDate').textContent=fmt(todayISO());const s=state(p);$('detailDays').textContent=Math.abs(s.d);$('detailUnit').textContent=s.d<0?'days past expiry':s.d===0?'expires today':'days remaining';$('detailStatus').textContent=s.label.toUpperCase();$('detailStatus').className=`pill ${s.type}`;$('statusBox').style.background=s.type==='fresh'?'#e4f3e9':s.type==='soon'?'#fff2d4':'#fae5e3';$('addBtn').textContent=tracked.includes(id)?'Already Added ✓':'Add to My Products';$('addBtn').disabled=tracked.includes(id)}
$('addBtn').onclick=async()=>{if(!current||!user)return;const id=current,p=productById(id);if(!p)return;$('addBtn').disabled=true;try{await setDoc(doc(db,'users',user.uid,'products',id),{productId:id,name:p.name,emoji:p.emoji,category:p.category||'Scanned product',mfg:p.mfg,exp:p.exp,addedAt:serverTimestamp()});pendingProduct=null;showList();notice(p.name+' added to My Products ✓')}catch(e){notice('Could not save product: '+e.message);$('addBtn').disabled=false}};
$('backBtn').onclick=showList;$('nav').onclick=showList;document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});
function showAuth(){pushRegisterGeneration++;user=null;tracked=[];products={};pairedDevices=[];acknowledgedIds=new Set();
$('loginHeading').textContent=validQrProduct?'Sign in to track '+catalog[urlProduct].name:'Welcome to SmartExpiry';
$('loginDescription').textContent=validQrProduct?'Your QR code is ready. Continue with Google to view the product and choose whether to add it.':'New here? Continue with Google to register automatically. Returning users can sign in with the same Google account.';
$('loginBtn').textContent='Continue with Google';$('loginPage').hidden=false;$('scanDock').hidden=true;$('listPage').hidden=true;$('detailPage').hidden=true;$('accountBar').hidden=true;$('count').textContent='0';$('nav').hidden=true}
function showSignedIn(u){user=u;void loadDevices();void autoRegisterPush();$('loginPage').hidden=true;$('accountBar').hidden=false;$('accountName').textContent=u.displayName||u.email||'Signed in';$('nav').hidden=false;notice('');if(validQrProduct && !incomingQRLink)showDetail(urlProduct);else showList();
if(incomingQRLink && !incomingQRHandled){incomingQRHandled=true;void previewScannedQR(incomingQRLink).catch(e=>notice('Could not open QR product: '+e.message));}
unsubscribe=onSnapshot(collection(db,'users',u.uid,'products'),snapshot=>{products={};snapshot.docs.forEach(d=>{const v=d.data()||{};const base=catalog[d.id]||{};const merged={...base,...v,id:d.id};if(typeof merged.name==='string'&&validDate(merged.exp)){merged.mfg=validDate(merged.mfg)?merged.mfg:merged.exp;merged.emoji=merged.emoji||'📦';products[d.id]=merged}});tracked=Object.keys(products);render();void syncDevices();void syncPushProducts();void loadAcknowledgements();if(current)showDetail(current)},err=>notice('Cannot load your products: '+err.message))}

// QR can carry a complete product record; legacy catalog QR IDs remain supported.
function validDate(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function parseDynamicQR(raw){
 let data=null;
 try{data=JSON.parse(raw)}catch{}
 if(!data){try{
  const url=new URL(raw,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/Smart_Expiry_4/'))return null;
  const packed=url.searchParams.get('data');
  if(packed)data=JSON.parse(packed);
  else if(url.searchParams.has('name')&&url.searchParams.has('exp'))data={name:url.searchParams.get('name'),exp:url.searchParams.get('exp'),mfg:url.searchParams.get('mfg'),emoji:url.searchParams.get('emoji')};
 }catch{}}
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const name=typeof data.name==='string'?data.name.trim():'';
 if(!name||name.length>80||!validDate(data.exp))return null;
 const mfg=validDate(data.mfg)?data.mfg:data.exp;
 const emoji=typeof data.emoji==='string'&&data.emoji.length<=12?data.emoji:'📦';
 const category=typeof data.category==='string'&&data.category.length<=100?data.category:'Scanned product';
 // Stable per-batch ID: same QR cannot create duplicate records.
 const key=JSON.stringify([name,data.exp,mfg]);let hash=2166136261;
 for(let i=0;i<key.length;i++){hash^=key.charCodeAt(i);hash=Math.imul(hash,16777619)}
 return {id:'qr-'+(hash>>>0).toString(16).padStart(8,'0'),name,exp:data.exp,mfg,emoji,category};
}
async function previewScannedQR(decoded){
 if(!user)throw new Error('Sign in first');
 const dynamic=parseDynamicQR(String(decoded||'').trim());
 const legacy=dynamic?null:qrProduct(decoded);
 const p=dynamic||(legacy?catalog[legacy]:null);
 if(!p)return false;
 // Preview only. Never save to Firestore without pressing Add to My Products.
 pendingProduct=p;
 showDetail(p.id);
 return true;
}

function loadQrLibrary(){
 if(!qrLibraryPromise)qrLibraryPromise=new Promise((resolve,reject)=>{
  if(window.Html5Qrcode){resolve(window.Html5Qrcode);return}
  const script=document.createElement('script');script.src='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  script.onload=()=>window.Html5Qrcode?resolve(window.Html5Qrcode):reject(new Error('QR scanner library unavailable'));
  script.onerror=()=>reject(new Error('Could not load QR scanner. Check internet connection.'));
  document.head.append(script);
 }).catch(err=>{qrLibraryPromise=null;throw err});
 return qrLibraryPromise;
}
function qrProduct(text){
 const raw=String(text||'').trim();
 const normalized=raw.toLowerCase();
 if(Object.prototype.hasOwnProperty.call(catalog,normalized))return normalized;
 // Decode known product IDs from the QR content, not the exact QR URL version.
 // Never follow or navigate to the scanned URL; only use an allowlisted ID.
 try {
  const url=new URL(raw,location.href);
  const params=[url.searchParams.get('product'),url.searchParams.get('id'),url.searchParams.get('item')];
  for(const value of params){const id=(value||'').toLowerCase().trim();if(Object.prototype.hasOwnProperty.call(catalog,id))return id}
  // Support older QR URLs whose product query was nested in an encoded redirect.
  for(const key of ['url','link','target','redirect']){
   const nested=url.searchParams.get(key);
   if(nested && nested!==raw){const match=nested.match(/[?&](?:product|id|item)=([a-z]+)/i);if(match && catalog[match[1].toLowerCase()])return match[1].toLowerCase()}
  }
 }catch{}
 const match=raw.match(/[?&](?:product|id|item)=([a-z]+)/i);
 return match && Object.prototype.hasOwnProperty.call(catalog,match[1].toLowerCase())?match[1].toLowerCase():null;
}
function qrUnrecognized(decoded){
 $('scanStatus').textContent='QR detected, but it does not contain a valid SmartExpiry product with name and expiry date. Scanned text: '+String(decoded).slice(0,120);
 $('manualProducts').hidden=false;
}

let scannerSession=0;
async function closeScanner(){
 scannerSession++;
 $('scannerOverlay').hidden=true;scannerDone=true;
 const old=qrScanner;qrScanner=null;
 if(old){try{await old.stop()}catch{}try{old.clear()}catch{}}
 $('qrReader').replaceChildren();scannerBusy=false;
}
async function foundQr(decoded,session){
 if(scannerDone||session!==scannerSession)return;
 scannerDone=true;
 try{
  const previewed=await previewScannedQR(decoded);
  if(!previewed){scannerDone=false;qrUnrecognized(decoded)}
 }catch(e){scannerDone=false;$('scanStatus').textContent='Could not save product: '+e.message}
}
async function startScanner(){
 if(!user||scannerBusy)return;
 scannerBusy=true;scannerDone=false;
 const session=++scannerSession;
 $('scannerOverlay').hidden=false;
 $('scanStatus').textContent='Preparing camera…';$('retryScanner').hidden=true;$('manualProducts').hidden=true;
 try{
  if(!window.isSecureContext)throw new Error('Camera requires HTTPS.');
  const Scanner=await loadQrLibrary();if(scannerDone||session!==scannerSession)return;
  // Full video area is decoded (no restrictive qrbox); helps iPhone Safari.
  qrScanner=new Scanner('qrReader',{verbose:false});
  await qrScanner.start({facingMode:'environment'}, {fps:12,aspectRatio:1.333334,disableFlip:false},
    decoded=>{void foundQr(decoded,session)}, ()=>{});
  if(!scannerDone && session===scannerSession)$('scanStatus').textContent='Hold the QR code steady in the middle of the camera. Move closer or farther if needed.';
 }catch(e){
  if(session===scannerSession){$('scanStatus').textContent='Camera scanner error: '+(e?.message||e)+'. You can also choose a QR photo below.';$('retryScanner').hidden=false}
  if(qrScanner){try{await qrScanner.stop()}catch{}qrScanner=null}
 }finally{scannerBusy=false}
}
$('scanBtn').onclick=startScanner;
$('closeScanner').onclick=closeScanner;
$('retryScanner').onclick=startScanner;
$('manualProducts').addEventListener('click',e=>{const button=e.target.closest('[data-manual-product]');if(button && catalog[button.dataset.manualProduct]){void closeScanner();showDetail(button.dataset.manualProduct)}});
$('qrFile').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 $('scanStatus').textContent='Reading QR from photo…';
 try{
  const Scanner=await loadQrLibrary();
  await closeScanner();$('scannerOverlay').hidden=false;
  const reader=new Scanner('qrReader');qrScanner=reader;
  const decoded=await reader.scanFile(file,true);
  const previewed=await previewScannedQR(decoded);
  if(!previewed)qrUnrecognized(decoded);
 }catch(err){$('scanStatus').textContent='Could not read/save QR photo: '+(err?.message||err)}
 finally{e.target.value=''}
});

$('loginBtn').onclick=async()=>{
 if(!configured){notice('First configure firebase-config.js with your Firebase Web app settings.');return}
 try{
  const remember=$('rememberLogin').checked;
  await setPersistence(auth,remember?browserLocalPersistence:browserSessionPersistence);
  const provider=new GoogleAuthProvider();
  if(!remember)provider.setCustomParameters({prompt:'select_account'});
  await signInWithPopup(auth,provider);
 }catch(e){notice('Google sign-in failed: '+e.message)}
};
$('logoutBtn').onclick=async()=>{try{
 // Detach this phone's token from the old account before signing out.
 // The same browser token can be attached to a new account on next login.
 if(user&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
  try{const reg=await navigator.serviceWorker.getRegistration('./');if(reg&&await isSupported()){
   const token=await getToken(getMessaging(firebaseApp),{vapidKey:VAPID_PUBLIC_KEY,serviceWorkerRegistration:reg});
   if(token)await deviceRequest('/push/unsubscribe','POST',{token});
  }}catch(e){console.warn('Push detach on sign-out:',e.message)}
 }
 await signOut(auth)
}catch(e){notice(e.message)}};
showAuth();$('loginHeading').textContent='Checking your account…';$('loginBtn').disabled=true;if(!configured){$('loginHeading').textContent='Welcome to SmartExpiry';$('loginBtn').disabled=false;notice('Setup needed: edit firebase-config.js, then enable Google Sign-in and Firestore in Firebase Console.')}else{try{const app=initializeApp(firebaseConfig);firebaseApp=app;auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,u=>{ $('loginBtn').disabled=false;if(unsubscribe){unsubscribe();unsubscribe=null}if(u)showSignedIn(u);else showAuth()},e=>{showAuth();notice('Authentication error: '+e.message)})}catch(e){notice('Firebase setup error: '+e.message)}}

// Refresh the date and countdown when the page is revisited or the calendar day changes.
let lastRenderedDay=todayISO();
function refreshDateIfNeeded(){const day=todayISO();if(day===lastRenderedDay)return;lastRenderedDay=day;if(user){render();if(current)showDetail(current)}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDateIfNeeded()});
window.addEventListener('focus',refreshDateIfNeeded);
setInterval(refreshDateIfNeeded,60000);

async function deviceRequest(path,method='GET',body){
 if(!DEVICE_API_URL)throw new Error('Set DEVICE_API_URL in device-config.js');
 if(!user)throw new Error('Sign in first');
 const token=await user.getIdToken();
 const response=await fetch(DEVICE_API_URL.replace(/\/$/,'')+path,{method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;
}
async function loadAcknowledgements(){
 if(!user||!DEVICE_API_URL)return;
 const uid=user.uid;
 try{const result=await deviceRequest('/acknowledgements');if(!user||user.uid!==uid)return;
 acknowledgedIds=new Set((result.items||[]).filter(a=>products[a.id]&&products[a.id].exp===a.exp).map(a=>a.id));
 render();
 }catch(e){console.warn('Acknowledge sync:',e.message)}
}
async function loadDevices(){
 if(!user||!DEVICE_API_URL)return;
 try{const result=await deviceRequest('/my-devices');pairedDevices=result.devices||[];
 $('deviceList').textContent=pairedDevices.length?'Paired: '+pairedDevices.join(', '):'No devices paired yet.';
 $('pairStatus').textContent='Enter the code from M5 to pair.';
 if(pairedDevices.length)await syncDevices();
 }catch(e){$('pairStatus').textContent='Device service: '+e.message}
}
async function syncDevices(){
 if(!user||!pairedDevices.length||!DEVICE_API_URL)return;
 try{await deviceRequest('/sync','POST',{products:tracked.map(id=>({id,name:productById(id).name,exp:productById(id).exp}))});}
 catch(e){$('pairStatus').textContent='Sync failed: '+e.message}
}
$('pairBtn').onclick=async()=>{
 const code=$('pairCode').value.trim().toUpperCase();
 if(!/^[0-9A-F]{12}$/.test(code)){$('pairStatus').textContent='Enter a 12-character code from the M5.';return}
 $('pairBtn').disabled=true;$('pairStatus').textContent='Pairing...';
 try{await deviceRequest('/pair','POST',{pairCode:code});$('pairCode').value='';await loadDevices();$('pairStatus').textContent='Device paired successfully!';}
 catch(e){$('pairStatus').textContent='Pairing failed: '+e.message}
 finally{$('pairBtn').disabled=false}
};
// Refresh the snapshot when the user returns to the site.
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void syncDevices();void loadAcknowledgements()}});

// Phone notifications use FCM. The server sends daily even when this page is closed.
async function syncPushProducts(){
 if(!user||!DEVICE_API_URL)return;
 try{await deviceRequest('/push/products','POST',{products:tracked.map(id=>({id,name:productById(id).name,exp:productById(id).exp}))});}
 catch(e){console.warn('Push product sync:',e.message)}
}
// A permission grant belongs to the installed web app, not to a Google account.
// Reattach the existing FCM token to whichever account is currently signed in.
async function registerPushForAccount({askPermission=false}={}){
 const status=$('pushStatus'),btn=$('enablePush');
 if(pushRegistrationBusy)return;
 if(!user)return;
 const uid=user.uid,generation=pushRegisterGeneration;
 pushRegistrationBusy=true;btn.disabled=true;
 try{
  if(!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('Browser does not support web notifications');
  if(!VAPID_PUBLIC_KEY||VAPID_PUBLIC_KEY.includes('PASTE_'))throw new Error('Set VAPID_PUBLIC_KEY in push-config.js first');
  if(!await isSupported())throw new Error('Firebase Messaging is not supported on this browser');
  if(Notification.permission==='denied')throw new Error('Notifications are blocked in browser settings');
  if(Notification.permission!=='granted'){
   if(!askPermission){status.textContent='Tap Enable once to allow notifications on this phone.';return}
   if(await Notification.requestPermission()!=='granted')throw new Error('Notification permission was not granted');
  }
  const registration=await navigator.serviceWorker.register('./firebase-messaging-sw.js',{scope:'./'});
  messaging=getMessaging(firebaseApp);
  const token=await getToken(messaging,{vapidKey:VAPID_PUBLIC_KEY,serviceWorkerRegistration:registration});
  if(!token)throw new Error('Could not get an FCM token');
  if(!user||user.uid!==uid||generation!==pushRegisterGeneration)return;
  await deviceRequest('/push/subscribe','POST',{token});
  await syncPushProducts();
  if(user?.uid===uid)status.textContent='Notifications enabled for this Google account ✓';
 }catch(e){
  console.warn('Push registration:',e);
  if(user?.uid===uid)status.textContent='Could not enable notifications: '+e.message;
 }finally{pushRegistrationBusy=false;btn.disabled=false}
}
async function autoRegisterPush(){
 // No permission prompt on sign-in; browsers require a user gesture for first consent.
 if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
  await registerPushForAccount();
 }else if(typeof Notification!=='undefined'&&Notification.permission==='default'){
  $('pushStatus').textContent='Tap Enable once to allow notifications on this phone.';
 }
}
async function setupPush(){await registerPushForAccount({askPermission:true})}
$('enablePush').onclick=setupPush;
$('testPush').onclick=async()=>{
 const btn=$('testPush'),status=$('testPushStatus');
 if(!user){status.textContent='Please sign in first.';return}
 btn.disabled=true;status.textContent='Sending test notification…';
 try{
  const result=await deviceRequest('/push/test','POST',{});
  status.textContent='Sent to '+result.sent+' registered phone'+(result.sent===1?'':'s')+'. Check your phone notifications.'+(result.failed?' ('+result.failed+' failed)':'');
 }catch(e){status.textContent='Test failed: '+e.message}
 finally{btn.disabled=false}
};

// iPhone/iPad Safari supports web push only for Home Screen web apps (iOS 16.4+).
if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.matchMedia('(display-mode: standalone)').matches){
 $('pushStatus').textContent='On iPhone: Share → Add to Home Screen, then open SmartExpiry from its icon before enabling notifications.';
}

// Notification click deep links to the Expired list where Acknowledge is available.
const ackParams=new URLSearchParams(location.search);
if(ackParams.has('ack')){filter='expired';}
// Notification opens the Expired list and highlights the relevant product.
const notificationProductId=ackParams.get('productId');
if(notificationProductId){
 const oldRender=render;
 render=function(){oldRender();
  const target=[...document.querySelectorAll('.item')].find(el=>el.dataset.productId===notificationProductId);
  if(target){target.classList.add('notificationTarget');target.scrollIntoView({block:'center',behavior:'smooth'});}
 };
}

