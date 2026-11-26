/* PNS front-end demo. Local accounts and simulated payments are not server authorization. */
(() => {
'use strict';
const STORE_KEY='pns-demo-portal-v1',SESSION_KEY='pns-demo-session-v1';
const PRICE=5000,VOUCHERS=['PNSCOBA5000','PNSSAHABAT'];
const DEMOS=[{id:'demo-pelari',name:'Andi Pelari',username:'pelari',email:'pelari@example.com',password:'PnsDemo123!'}, {id:'demo-sahabat',name:'Sari Sahabat',username:'sahabat',email:'sahabat@example.com',password:'PnsDemo456!'}];
const orders=new Map();
const read=()=>{const raw=localStorage.getItem(STORE_KEY);if(!raw)return {version:1,users:[]};const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.users))throw Error('Data demo tidak dapat dibaca. Gunakan browser lain untuk mencoba.');return data;};
const write=data=>{try{localStorage.setItem(STORE_KEY,JSON.stringify(data));}catch(e){throw Error('Penyimpanan browser penuh atau tidak tersedia. Perubahan belum tersimpan.');}};
const uid=()=>crypto.randomUUID();
const session=()=>{try{return JSON.parse(sessionStorage.getItem(SESSION_KEY))?.userId||null;}catch(e){return null;}};
const publicUser=u=>u?{id:u.id,name:u.name,username:u.username,email:u.email}:null;
function user(){try{return publicUser(read().users.find(u=>u.id===session()));}catch(e){return null;}}
function requireUser(data){const u=data.users.find(u=>u.id===session());if(!u)throw Error('Sesi berakhir. Silakan masuk lagi.');return u;}
function safeNext(value){return ['pelayanan.html','profil.html'].includes(value)?value:'pelayanan.html';}
const next=safeNext(new URLSearchParams(location.search).get('next'));
if(document.documentElement.hasAttribute('data-pns-private')&&!user()){
 document.documentElement.dataset.session='guest';location.replace('login.html?next='+safeNext(location.pathname.split('/').pop()));
}
async function hashPassword(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
async function credentials(password){const salt=uid();return {salt,passwordHash:await hashPassword(password,salt)};}
function validatePassword(value){if(typeof value!=='string'||value.length<8||value.length>128)throw Error('Password perlu 8–128 karakter.');}
function validateName(value){const name=String(value||'').trim();if(!name||name.length>60)throw Error('Isi nama, maksimal 60 karakter.');return name;}
const ready=(async()=>{
 try{
  let data=read();
  if(!data.users.length){
   const users=await Promise.all(DEMOS.map(async({password,...u})=>({...u,...await credentials(password),routes:[],downloads:[],usedVouchers:[]})));
   data=read();if(!data.users.length){data.users=users;write(data);}
  }
 }catch(e){throw Error('Demo membutuhkan penyimpanan browser dan koneksi HTTPS. '+e.message);}
})();
// A handled rejection keeps public pages usable; forms display the same error when used.
ready.catch(()=>{});
async function login(identity,password){
 await ready;const data=read(),key=String(identity).trim().toLowerCase(),u=data.users.find(x=>x.username.toLowerCase()===key||x.email.toLowerCase()===key);
 if(!u||await hashPassword(password,u.salt)!==u.passwordHash)throw Error('Username/email atau password belum cocok.');
 sessionStorage.setItem(SESSION_KEY,JSON.stringify({userId:u.id}));return publicUser(u);
}
async function register(values){
 await ready;const name=validateName(values.name),username=String(values.username||'').trim().toLowerCase(),email=String(values.email||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(username))throw Error('Username 3–24 karakter: huruf, angka, titik, garis bawah, atau strip.');
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Isi alamat email yang valid.');
 validatePassword(values.password);const auth=await credentials(values.password),data=read();
 if(data.users.some(u=>u.username.toLowerCase()===username||u.email.toLowerCase()===email))throw Error('Username atau email sudah dipakai.');
 const u={id:uid(),name,username,email,...auth,routes:[],downloads:[],usedVouchers:[]};data.users.push(u);write(data);
 sessionStorage.setItem(SESSION_KEY,JSON.stringify({userId:u.id}));return publicUser(u);
}
async function demoGoogle(id){await ready;const u=read().users.find(x=>x.id===id&&DEMOS.some(d=>d.id===id));if(!u)throw Error('Akun contoh tidak tersedia.');sessionStorage.setItem(SESSION_KEY,JSON.stringify({userId:u.id}));return publicUser(u);}
function logout(){sessionStorage.removeItem(SESSION_KEY);orders.clear();}
function leaveAccount(){logout();location.replace('index.html');}
async function updateName(value){await ready;const data=read(),u=requireUser(data);u.name=validateName(value);write(data);return publicUser(u);}
async function changePassword(current,password){
 await ready;validatePassword(password);const data=read(),u=requireUser(data);
 if(await hashPassword(current,u.salt)!==u.passwordHash)throw Error('Password saat ini belum cocok.');
 const auth=await credentials(password);const fresh=read(),active=requireUser(fresh);if(active.id!==u.id)throw Error('Sesi berubah. Silakan coba lagi.');Object.assign(active,auth);write(fresh);
}
async function saveRoute(meta){
 await ready;const data=read(),u=requireUser(data);
 const item={filename:String(meta.filename).slice(0,160),distance:Number(meta.distance),points:Number(meta.points)};
 if(!Number.isFinite(item.distance)||item.distance<=0||!Number.isFinite(item.points))throw Error('Ringkasan rute tidak valid.');
 const key=JSON.stringify(item),existing=u.routes.find(r=>r.key===key);
 if(existing)return existing.id;
 const record={...item,key,id:uid(),createdAt:new Date().toISOString()};u.routes.unshift(record);u.routes=u.routes.slice(0,100);write(data);return record.id;
}
function history(){const u=requireUser(read());return {routes:structuredClone(u.routes),downloads:structuredClone(u.downloads)};}
function createCheckout(meta){
 const u=requireUser(read());if(!meta||!Number.isFinite(meta.distance)||meta.distance<=0||!Number.isFinite(meta.pace)||!Number.isFinite(meta.duration))throw Error('Buat aktivitas yang valid terlebih dahulu.');
 const order={id:uid(),userId:u.id,createdAt:new Date().toISOString(),filename:String(meta.filename).slice(0,160),name:String(meta.name).slice(0,120),distance:meta.distance,pace:meta.pace,duration:meta.duration,routeName:String(meta.routeName||'Rute GPX').slice(0,160),price:PRICE};
 orders.set(order.id,order);return {...order};
}
function cancelCheckout(id){orders.delete(id);}
function settleCheckout(id,method,code=''){
 const order=orders.get(id);if(!order)throw Error('Pesanan sudah selesai atau dibatalkan. Mulai unduhan baru.');
 const data=read(),u=requireUser(data);if(u.id!==order.userId)throw Error('Sesi akun berubah. Buka ulang pembayaran.');
 let voucher=null;if(method==='voucher'){
  voucher=String(code).trim().toUpperCase();
  if(!VOUCHERS.includes(voucher))throw Error('Kode voucher belum valid. Periksa kembali kodenya.');
  if(u.usedVouchers.includes(voucher))throw Error('Voucher ini sudah dipakai di akun demo ini.');
 }else if(method!=='qr-demo')throw Error('Metode pembayaran tidak tersedia.');
 const receipt={...order,method,voucher,amount:method==='voucher'?0:PRICE,paidAt:new Date().toISOString(),status:'demo-confirmed'};
 if(voucher)u.usedVouchers.push(voucher);u.downloads.unshift(receipt);u.downloads=u.downloads.slice(0,100);write(data);orders.delete(id);return {...receipt};
}
const byId=id=>document.getElementById(id);
function status(id,message,ok=false){const el=byId(id);if(!el)return;el.textContent=message;el.hidden=!message;el.classList.toggle('is-success',ok);}
function updateNav(){
 const nav=document.querySelector('.site-header nav');if(!nav)return;
 let link=byId('accountNav');if(!link){link=document.createElement('a');link.id='accountNav';nav.appendChild(link);}
 let exit=byId('logoutNav');if(!exit){exit=document.createElement('button');exit.id='logoutNav';exit.type='button';exit.className='account-logout';exit.textContent='Keluar';exit.setAttribute('aria-label','Keluar dari akun PNS');exit.addEventListener('click',leaveAccount);nav.appendChild(exit);}
 const u=user();exit.hidden=!u;link.href=u?'profil.html':'login.html';link.textContent=u?'Profil Saya':'Masuk';if(location.pathname.endsWith('/profil.html'))link.setAttribute('aria-current','page');
 document.querySelectorAll('a[href="pelayanan.html"],a[href="login.html?next=pelayanan.html"]').forEach(a=>{a.href=u?'pelayanan.html':'login.html?next=pelayanan.html';});
}
async function submitForm(form,handler,errorId){
 const button=form.querySelector('[type=submit]');button.disabled=true;status(errorId,'');
 try{await handler();}catch(e){status(errorId,e.message);}finally{button.disabled=false;}
}
function initLogin(){
 if(!byId('loginForm'))return;
 function show(mode){const signup=mode==='daftar';byId('loginPanel').hidden=signup;byId('registerPanel').hidden=!signup;byId('loginTitle').textContent=signup?'Daftar jadi PNS.':'Selamat datang kembali.';status('loginStatus','');status('registerStatus','');}
 show(new URLSearchParams(location.search).get('mode'));
 document.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.authMode)));
 byId('loginForm').addEventListener('submit',e=>{e.preventDefault();submitForm(e.currentTarget,async()=>{await login(byId('loginIdentity').value,byId('loginPassword').value);location.assign(next);},'loginStatus');});
 byId('registerForm').addEventListener('submit',e=>{e.preventDefault();submitForm(e.currentTarget,async()=>{await register({name:byId('registerName').value,username:byId('registerUsername').value,email:byId('registerEmail').value,password:byId('registerPassword').value});location.assign(next);},'registerStatus');});
 document.querySelectorAll('[data-demo-fill]').forEach(button=>button.addEventListener('click',()=>{const demo=DEMOS.find(d=>d.username===button.dataset.demoFill);byId('loginIdentity').value=demo.username;byId('loginPassword').value=demo.password;byId('loginIdentity').focus();}));
 const modal=byId('gmailDialog');byId('gmailLogin').addEventListener('click',()=>modal.showModal());byId('closeGmail').addEventListener('click',()=>modal.close());
 document.querySelectorAll('[data-google-demo]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await demoGoogle(button.dataset.googleDemo);location.assign(next);}catch(e){status('gmailStatus',e.message);button.disabled=false;}}));
 byId('continueSession').hidden=!user();byId('continueSession').href=next;
}
function formatMoney(value){return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);}
function dateText(value){return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB';}
function paceText(value){const seconds=Math.round(value);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} /km`;}
function historyCard(title,details,tag){const card=document.createElement('article');card.className='history-item';const info=document.createElement('div'),h=document.createElement('h3');h.textContent=title;info.appendChild(h);details.forEach(detail=>{const p=document.createElement('p');p.textContent=detail;info.appendChild(p);});card.appendChild(info);if(tag){const badge=document.createElement('span');badge.className='demo-chip';badge.textContent=tag;card.appendChild(badge);}return card;}
function renderProfile(){
 const u=user();if(!u)return;byId('profileGreeting').textContent=u.name;byId('profileName').value=u.name;byId('profileUsername').textContent='@'+u.username;byId('profileEmail').textContent=u.email;
 const data=history();byId('routeCount').textContent=data.routes.length;byId('downloadCount').textContent=data.downloads.length;
 const downloads=byId('downloadHistory'),routes=byId('routeHistory');downloads.replaceChildren();routes.replaceChildren();
 if(!data.downloads.length)downloads.appendChild(historyCard('Belum ada unduhan.',['Selesaikan pembayaran demo atau gunakan voucher untuk unduhan pertamamu.']));
 data.downloads.forEach(r=>downloads.appendChild(historyCard(r.name,[`${(r.distance/1000).toFixed(2)} km · ${paceText(r.pace)} · ${r.filename}`,`${dateText(r.paidAt)} · ${r.method==='voucher'?'Voucher '+r.voucher:'QR demo'} · ${formatMoney(r.amount)}`],'Unduhan demo')));
 if(!data.routes.length)routes.appendChild(historyCard('Belum ada rute.',['Rute akan muncul setelah file GPX berhasil diunggah di Ruang Pelayanan.']));
 data.routes.forEach(r=>routes.appendChild(historyCard(r.filename,[`${(r.distance/1000).toFixed(2)} km · ${r.points} titik · ${dateText(r.createdAt)}`],'GPX')));
}
function initProfile(){
 if(!byId('profileForm')||!user())return;
 renderProfile();byId('logoutButton').addEventListener('click',leaveAccount);
 byId('profileForm').addEventListener('submit',e=>{e.preventDefault();submitForm(e.currentTarget,async()=>{await updateName(byId('profileName').value);renderProfile();status('profileStatus','Nama berhasil diperbarui.',true);},'profileStatus');});
 byId('passwordForm').addEventListener('submit',e=>{e.preventDefault();submitForm(e.currentTarget,async()=>{if(byId('newPassword').value!==byId('confirmPassword').value)throw Error('Konfirmasi password belum sama.');await changePassword(byId('currentPassword').value,byId('newPassword').value);e.target.reset();status('passwordStatus','Password akun PNS demo berhasil diganti.',true);},'passwordStatus');});
}
let checkout=null,finishDownload=null,settling=false;
function initPayment(){
 const dialog=byId('paymentDialog');if(!dialog)return;
 const cancel=()=>{if(checkout)cancelCheckout(checkout.id);checkout=null;finishDownload=null;};
 byId('closePayment').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',cancel);
 document.querySelectorAll('[data-pay-method]').forEach(b=>b.addEventListener('click',()=>{
  const qr=b.dataset.payMethod==='qr';byId('qrPanel').hidden=!qr;byId('voucherPanel').hidden=qr;
  document.querySelectorAll('[data-pay-method]').forEach(t=>{t.setAttribute('aria-selected',String(t===b));t.tabIndex=t===b?0:-1;});status('paymentStatus','');if(!qr)byId('voucherCode').focus();
 }));
 // Arrow navigation follows the standard tab pattern; Enter/Space are native button actions.
 byId('paymentTabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-pay-method]')],current=tabs.indexOf(document.activeElement);const index=e.key==='Home'?0:e.key==='End'?1:(current+1)%2;tabs[index].click();tabs[index].focus();});
 function confirm(method){
  if(settling||!checkout)return;settling=true;const buttons=[byId('confirmQr'),byId('confirmVoucher')];buttons.forEach(b=>b.disabled=true);
  try{
   const receipt=settleCheckout(checkout.id,method,byId('voucherCode').value),deliver=finishDownload;
   checkout=null;finishDownload=null;dialog.close();deliver();status('downloadStatus',`${receipt.method==='voucher'?'Voucher berhasil dipakai':'Pembayaran demo dikonfirmasi'}. Unduhan TCX dimulai. Riwayat tersedia di Profil Saya.`,true);
  }catch(e){status('paymentStatus',e.message);}finally{settling=false;buttons.forEach(b=>b.disabled=false);}
 }
 byId('confirmQr').addEventListener('click',()=>confirm('qr-demo'));
 byId('voucherForm').addEventListener('submit',e=>{e.preventDefault();confirm('voucher');});
}
async function requestDownload(meta,deliver){
 try{
  await ready;if(!user()){location.assign('login.html?next=pelayanan.html');return;}
  if(checkout)return;
  checkout=createCheckout(meta);finishDownload=deliver;status('paymentStatus','');status('downloadStatus','');byId('voucherForm').reset();
  byId('orderName').textContent=checkout.name;byId('orderDistance').textContent=(checkout.distance/1000).toFixed(2)+' km · '+paceText(checkout.pace);byId('orderTotal').textContent=formatMoney(PRICE);byId('orderReference').textContent='DEMO-'+checkout.id.slice(0,8).toUpperCase();
  byId('demoQr').src='assets/qr-demo-'+(crypto.getRandomValues(new Uint8Array(1))[0]%4+1)+'.svg';
  document.querySelector('[data-pay-method="qr"]').click();byId('paymentDialog').showModal();
 }catch(e){if(checkout)cancelCheckout(checkout.id);checkout=null;finishDownload=null;status('downloadStatus',e.message);}
}
window.PNSPortal=Object.freeze({ready,user,login,register,demoGoogle,logout,updateName,changePassword,saveRoute,history,createCheckout,cancelCheckout,settleCheckout,requestDownload,safeNext});
document.addEventListener('DOMContentLoaded',()=>{updateNav();initLogin();initPayment();ready.then(()=>{updateNav();initProfile();}).catch(e=>{status('loginStatus',e.message);status('registerStatus',e.message);status('profileStatus',e.message);});});
// Recheck access when returning from the browser's back/forward cache.
window.addEventListener('pageshow',()=>{updateNav();if(document.documentElement.hasAttribute('data-pns-private')&&!user())location.replace('login.html?next='+safeNext(location.pathname.split('/').pop()));});
})();
