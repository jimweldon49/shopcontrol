// Same employee account and API as the full workspace. In-app alerts are durable.
const coreSeen=new Set();let coreNotifyUser=null;
function coreEscape(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadCoreAlerts(){
 const panel=document.getElementById('mobileCoreAlerts');if(!authToken||!currentUser){panel.hidden=true;return;}
 if(coreNotifyUser!==currentUser.id){coreSeen.clear();coreNotifyUser=currentUser.id;}
 try{
  const alerts=await apiRequest('/workspace/notifications');panel.hidden=false;
  panel.innerHTML=`<h3>Parts & core notifications (${alerts.filter(a=>!a.read_at).length})</h3><button class="btn" onclick="enableCoreNotifications()">Enable device alerts while app is open</button>${alerts.filter(a=>!a.read_at).map(a=>`<article><strong>${coreEscape(a.title)}</strong><p>${coreEscape(a.message)}</p><button class="btn" onclick="readCoreAlert('${a.id}')">Mark read</button></article>`).join('')||'<p>No unread core notifications.</p>'}`;
  for(const a of alerts){if(!a.read_at&&!coreSeen.has(a.id)&&'Notification' in window&&Notification.permission==='granted'){try{new Notification(a.title,{body:a.message,tag:a.id});}catch{}}coreSeen.add(a.id);}
 }catch{panel.hidden=false;panel.textContent='Core notifications could not refresh. Check your connection.';}
}
async function enableCoreNotifications(){if('Notification' in window){await Notification.requestPermission();await loadCoreAlerts();}else alert('Device alerts are unavailable in this browser. Alerts still appear in the employee app.');}
async function readCoreAlert(id){try{await apiRequest('/workspace/notifications/'+id+'/read',{method:'PUT'});await loadCoreAlerts();}catch(e){alert(e.message);}}
document.addEventListener('DOMContentLoaded',()=>{const panel=document.createElement('section');panel.id='mobileCoreAlerts';panel.hidden=true;document.body.append(panel);loadCoreAlerts();setInterval(loadCoreAlerts,15000);});
