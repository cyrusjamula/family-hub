const panel=document.createElement('section');panel.className='panel';
const heading=document.createElement('h3');heading.textContent='Privacy-preserving diagnostics';
const notice=document.createElement('p');notice.className='muted';notice.textContent='Browser error reporting is off unless you enable it here. If enabled, the Hub sends only a fixed error category and app section; it does not send error text, stack traces, page content, form values, URLs, screenshots, clipboard, keystrokes, device fingerprints or location. Collection may also be disabled on the server. Reports are restricted and capped.';
const label=document.createElement('label');
const consent=document.createElement('input');consent.id='browser-diagnostics-consent';consent.type='checkbox';
label.append(consent,document.createTextNode(' Share minimal browser error diagnostics from this device'));
const status=document.createElement('p');status.id='browser-diagnostics-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
panel.append(heading,notice,label,status);document.getElementById('view-settings').append(panel);
const sections=new Set(['chat','planner','settings','advanced']);
const preference='hub-browser-diagnostics-consent';
let sent=0;
try{consent.checked=localStorage.getItem(preference)==='true';}catch{}
status.textContent=consent.checked?'Minimal browser error reporting is enabled on this device.':'Browser error reporting is off.';
consent.addEventListener('change',()=>{
 try{localStorage.setItem(preference,String(consent.checked));}catch{}
 status.textContent=consent.checked?'Minimal browser error reporting is enabled on this device.':'Browser error reporting is off.';
});
window.addEventListener('storage',event=>{
 if(event.key!==preference&&event.key!==null)return;
 consent.checked=event.key===preference&&event.newValue==='true';
 status.textContent=consent.checked?'Minimal browser error reporting is enabled on this device.':'Browser error reporting is off.';
});
async function report(type){
 if(!consent.checked||sent>=5)return;
 sent++;
 const section=document.querySelector('[data-view][aria-pressed="true"]')?.dataset.view;
 try{
  const response=await fetch('/api/diagnostics/browser',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,section:sections.has(section)?section:'chat'})});
  if(!response.ok)return;
  const data=await response.json();
  if(typeof data.requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(data.requestId))status.textContent='Browser error reference: '+data.requestId;
 }catch{}
}
window.addEventListener('error',()=>{void report('exception');});
window.addEventListener('unhandledrejection',()=>{void report('rejection');});
