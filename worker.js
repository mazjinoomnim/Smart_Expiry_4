// SmartExpiry device gateway - Cloudflare Worker + D1
// Set FIREBASE_WEB_API_KEY as a Worker secret and bind D1 as DB.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail=(msg,status=400)=>json({error:msg},status);
const hex=b=>Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
const randomHex=(bytes=32)=>hex(crypto.getRandomValues(new Uint8Array(bytes)));
const digest=async s=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const authUser=async(req,env)=>{
 const token=(req.headers.get('Authorization')||'').match(/^Bearer (.+)$/)?.[1];
 if(!token)return null;
 const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token})});
 if(!r.ok)return null;const j=await r.json();return j.users?.[0]?.localId||null;
};
const getDevice=async(req,env)=>{
 const id=req.headers.get('X-Device-ID')||'';
 const secret=req.headers.get('X-Device-Secret')||'';
 if(!/^M5-[0-9A-F]{6}$/.test(id)||!secret)return null;
 const d=await env.DB.prepare('SELECT * FROM devices WHERE device_id=?').bind(id).first();
 if(!d||d.secret_hash!==await digest(secret))return null;
 return d;
};
const dayUTC7=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const dayNumber=s=>Date.parse(s+'T00:00:00Z')/86400000;

// Firebase Cloud Messaging (HTTP v1) using a service account stored ONLY in Worker secrets.
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode64=obj=>b64url(new TextEncoder().encode(JSON.stringify(obj)));
const accessToken=async env=>{
 const sa=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON||'{}');
 if(!sa.private_key||!sa.client_email||!sa.project_id)throw new Error('FCM_SERVICE_ACCOUNT_JSON missing');
 const now=Math.floor(Date.now()/1000);
 const header=encode64({alg:'RS256',typ:'JWT'});
 const body=encode64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
 const pem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const der=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(header+'.'+body));
 const jwt=header+'.'+body+'.'+b64url(new Uint8Array(signed));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
 if(!r.ok)throw new Error('FCM OAuth '+r.status);
 return {token:(await r.json()).access_token,project:sa.project_id};
};
const sendPush=async(auth,token,title,body,tag,productId)=>{
 const r=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(auth.project)+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'content-type':'application/json'},body:JSON.stringify({message:{token,data:{title,body,tag,productId:String(productId||'')},webpush:{headers:{Urgency:'high'}}}})});
 if(!r.ok){const detail=await r.text();throw new Error('FCM '+r.status+' '+detail.slice(0,250))}
};
const sendDailyPush=async env=>{
 const today=dayUTC7();
 const rows=await env.DB.prepare('SELECT uid,products_json FROM push_products').all();
 let auth=null;
 for(const row of rows.results){
  const subscriptions=await env.DB.prepare('SELECT token FROM push_tokens WHERE uid=?').bind(row.uid).all();
  if(!subscriptions.results.length)continue;
  let products=[];try{products=JSON.parse(row.products_json||'[]')}catch{continue}
  for(const item of products){
   const days=dayNumber(item.exp)-dayNumber(today);
   // Notify at 3, 2, 1, 0 days, and once on the first day after expiry.
   if(days>3||days< -1)continue;
   if(days<=0){const ack=await env.DB.prepare('SELECT 1 FROM acknowledgements WHERE uid=? AND product_id=? AND expiry=?').bind(row.uid,item.id,item.exp).first();if(ack)continue;}
   const title=days<0?`${item.name} has expired`:days===0?`${item.name} expires today`:`${item.name} expires in ${days} day${days===1?'':'s'}`;
   const body=days<0?'Please check this product.':days===0?'Check this product before use.':'Check your SmartExpiry product list.';
   for(const sub of subscriptions.results){
    const exists=await env.DB.prepare('SELECT 1 FROM push_sent WHERE uid=? AND token=? AND product_id=? AND expiry=? AND sent_day=?').bind(row.uid,sub.token,item.id,item.exp,today).first();
    if(exists)continue;
    try{
     if(!auth)auth=await accessToken(env);
     await sendPush(auth,sub.token,'SmartExpiry: '+title,body,'expiry-'+item.id+'-'+today,item.id);
     await env.DB.prepare('INSERT OR IGNORE INTO push_sent(uid,token,product_id,expiry,sent_day) VALUES(?,?,?,?,?)').bind(row.uid,sub.token,item.id,item.exp,today).run();
    }catch(e){console.error('Push send failed',e.message)}
   }
  }
 }
};

export default {
 async scheduled(event,env,ctx){ctx.waitUntil(sendDailyPush(env))},
 async fetch(req,env){
 const origin=req.headers.get('Origin');
 const allowed='https://mazjinoomnim.github.io';
 const cors={'access-control-allow-origin':allowed,'access-control-allow-headers':'Authorization,Content-Type,X-Device-ID,X-Device-Secret','access-control-allow-methods':'GET,POST,OPTIONS','vary':'Origin'};
 const respond=r=>{const h=new Headers(r.headers);if(origin===allowed||!origin)for(const [k,v] of Object.entries(cors))h.set(k,v);return new Response(r.body,{status:r.status,headers:h})};
 try{
  if(req.method==='OPTIONS')return respond(new Response(null,{status:204}));
  const url=new URL(req.url),p=url.pathname;
  if(p==='/health')return respond(json({ok:true}));
  if(req.method==='POST'&&p==='/device/register'){
   const data=await req.json();const id=String(data.deviceId||'');const secret=String(data.deviceSecret||'');
   if(!/^M5-[0-9A-F]{6}$/.test(id)||!/^([0-9a-f]{64})$/.test(secret))return respond(fail('Invalid device credentials'));
   const old=await env.DB.prepare('SELECT * FROM devices WHERE device_id=?').bind(id).first();
   if(old && old.secret_hash!==await digest(secret))return respond(fail('Device ID already registered',409));
   // Code is 12 hex characters (48 bits), expires after 10 minutes.
   const code=randomHex(6).toUpperCase(),expiry=Date.now()+600000;
   await env.DB.prepare('INSERT INTO devices(device_id,secret_hash,pair_code,pair_expires,owner_uid,products_json) VALUES(?,?,?,?,NULL,?) ON CONFLICT(device_id) DO UPDATE SET pair_code=excluded.pair_code,pair_expires=excluded.pair_expires').bind(id,await digest(secret),code,expiry,'[]').run();
   return respond(json({pairCode:code,expiresIn:600}));
  }
  if(req.method==='POST'&&p==='/pair'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in with Google first',401));
   const data=await req.json();const code=String(data.pairCode||'').trim().toUpperCase();
   if(!/^[0-9A-F]{12}$/.test(code))return respond(fail('Invalid pairing code'));
   const result=await env.DB.prepare('UPDATE devices SET owner_uid=?,pair_code=NULL,pair_expires=NULL,products_json=? WHERE pair_code=? AND pair_expires>? AND owner_uid IS NULL').bind(uid,'[]',code,Date.now()).run();
   if(result.meta.changes!==1)return respond(fail('Code expired, already used, or device already paired',409));
   return respond(json({paired:true}));
  }
  if(req.method==='GET'&&p==='/my-devices'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const rows=await env.DB.prepare('SELECT device_id FROM devices WHERE owner_uid=?').bind(uid).all();
   return respond(json({devices:rows.results.map(x=>x.device_id)}));
  }
  if(req.method==='POST'&&p==='/sync'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const data=await req.json();const items=data.products;
   if(!Array.isArray(items)||items.length>100)return respond(fail('Invalid product list'));
   const products=[];
   for(const p of items){if(typeof p.id!=='string'||!p.id||p.id.length>150)return respond(fail('Invalid product ID'));if(typeof p.name!=='string'||p.name.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(p.exp)||!Number.isFinite(dayNumber(p.exp)))return respond(fail('Invalid product'));products.push({id:p.id,name:p.name,exp:p.exp})}
   await env.DB.prepare('UPDATE devices SET products_json=? WHERE owner_uid=?').bind(JSON.stringify(products),uid).run();
   return respond(json({synced:products.length}));
  }
  // Per-product acknowledgement is keyed by Firebase UID, product ID and expiry date.
  if(req.method==='GET'&&p==='/acknowledgements'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const rows=await env.DB.prepare('SELECT product_id AS id, expiry AS exp FROM acknowledgements WHERE uid=?').bind(uid).all();
   return respond(json({items:rows.results}));
  }
  if(req.method==='POST'&&p==='/acknowledge'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const data=await req.json();const id=data.productId,exp=data.exp;
   if(typeof id!=='string'||!id||id.length>150||typeof exp!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(exp)||!Number.isFinite(dayNumber(exp)))return respond(fail('Invalid product'));
   const row=await env.DB.prepare('SELECT products_json FROM push_products WHERE uid=?').bind(uid).first();
   const list=JSON.parse(row?.products_json||'[]');
   if(!list.some(x=>x.id===id&&x.exp===exp))return respond(fail('Product not in your synced list',409));
   if(dayNumber(exp)>dayNumber(dayUTC7()))return respond(fail('Product is not expired yet',409));
   await env.DB.prepare('INSERT OR IGNORE INTO acknowledgements(uid,product_id,expiry) VALUES(?,?,?)').bind(uid,id,exp).run();
   return respond(json({acknowledged:true}));
  }
  // Register a phone's Firebase Cloud Messaging token for the signed-in user.
  if(req.method==='POST'&&p==='/push/subscribe'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const data=await req.json();const token=String(data.token||'');
   if(!token||token.length>4096)return respond(fail('Invalid FCM token'));
   await env.DB.prepare('INSERT INTO push_tokens(uid,token) VALUES(?,?) ON CONFLICT(token) DO UPDATE SET uid=excluded.uid').bind(uid,token).run();
   return respond(json({subscribed:true}));
  }
  // Unlink only this account's token on explicit sign-out; preserve the browser permission.
  if(req.method==='POST'&&p==='/push/unsubscribe'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const data=await req.json();const token=String(data.token||'');
   if(!token||token.length>4096)return respond(fail('Invalid FCM token'));
   await env.DB.prepare('DELETE FROM push_tokens WHERE uid=? AND token=?').bind(uid,token).run();
   return respond(json({unsubscribed:true}));
  }
  // Keep a user-specific snapshot for scheduled notifications, even without an M5 device.
  if(req.method==='POST'&&p==='/push/products'){
   const uid=await authUser(req,env);if(!uid)return respond(fail('Sign in first',401));
   const data=await req.json(),items=data.products;
   if(!Array.isArray(items)||items.length>100)return respond(fail('Invalid product list'));
   const products=[];
   for(const item of items){
    if(typeof item.id!=='string'||!item.id||item.id.length>150||typeof item.name!=='string'||!item.name||item.name.length>80||typeof item.exp!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.exp)||!Number.isFinite(dayNumber(item.exp)))return respond(fail('Invalid product'));
    products.push({id:item.id,name:item.name,exp:item.exp});
   }
   await env.DB.prepare('INSERT INTO push_products(uid,products_json) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET products_json=excluded.products_json').bind(uid,JSON.stringify(products)).run();
   return respond(json({synced:products.length}));
  }
  if(req.method==='GET'&&p==='/device/alerts'){
   const d=await getDevice(req,env);if(!d)return respond(fail('Invalid device credentials',401));
   if(!d.owner_uid)return respond(json({paired:false,alerts:[]}));
   const today=dayUTC7();
   const acks=await env.DB.prepare('SELECT product_id,expiry FROM acknowledgements WHERE uid=?').bind(d.owner_uid).all();
   const acknowledged=new Set(acks.results.map(x=>x.product_id+'|'+x.expiry));
   const alerts=JSON.parse(d.products_json||'[]').map(p=>({...p,daysLeft:dayNumber(p.exp)-dayNumber(today)})).filter(p=>p.daysLeft<=3).map(p=>({...p,acknowledged:acknowledged.has(p.id+'|'+p.exp)})).sort((a,b)=>a.daysLeft-b.daysLeft);
   return respond(json({paired:true,today,alerts}));
  }
  return respond(fail('Not found',404));
 }catch(e){return respond(fail('Server error',500))}
}};
