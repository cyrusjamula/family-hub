const feedbackEl=id=>document.getElementById(id);
let feedbackMe,feedbackId=null,feedbackContext='unspecified',feedbackDraft=null,feedbackSelected=null,feedbackPublic=null,feedbackObjectURL=null,feedbackVersion=0,feedbackBusy=false;
async function feedbackRequest(route,body){
 const response=await fetch('/api/feedback'+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Feedback request failed');return data;
}
async function feedbackRun(fn){
 if(feedbackBusy)return;feedbackBusy=true;feedbackEl('feedback-status').textContent='';
 feedbackEl('feedback-dialog').querySelectorAll('button').forEach(button=>button.disabled=true);
 try{await fn();}catch(error){feedbackEl('feedback-status').textContent=error.message;}
 finally{feedbackBusy=false;feedbackEl('feedback-dialog').querySelectorAll('button').forEach(button=>button.disabled=false);}
}
function clearFeedbackPreview(){
 ++feedbackVersion;feedbackDraft=null;feedbackEl('feedback-review-panel').hidden=true;feedbackEl('feedback-submit-consent').checked=false;
 if(feedbackObjectURL){URL.revokeObjectURL(feedbackObjectURL);feedbackObjectURL=null;}
 feedbackEl('feedback-local-image').removeAttribute('src');feedbackEl('feedback-local-image').hidden=true;
}
function clearPublicPreview(){feedbackPublic=null;feedbackEl('feedback-public-panel').hidden=true;feedbackEl('feedback-publish-consent').checked=false;}
async function openFeedback(id){
 feedbackEl('feedback-dialog').showModal();
 const response=await fetch('/api/me');if(!response.ok)throw Error('Sign in to send feedback');feedbackMe=await response.json();
 const config=await feedbackRequest('/config');if(!config.enabled)throw Error('Feedback setup is pending. Your draft stays on this page.');
 feedbackId??=crypto.randomUUID();
 feedbackContext=document.querySelector('[data-view][aria-pressed="true"]')?.dataset.view||'unspecified';
 feedbackEl('feedback-status').textContent='Nothing is collected until you choose to submit. Reports stay private until Cyrus approves publication.';
 if(id)await showFeedbackReport(id);else await listFeedback();
}
async function prepareFeedback(){
 clearFeedbackPreview();const version=feedbackVersion;
 const title=feedbackEl('feedback-title').value.trim(),details=feedbackEl('feedback-details').value.trim();
 if(!title||title.length>120||!details||details.length>3000)throw Error('Enter a short title and feedback details');
 const includeContext=feedbackEl('feedback-context').checked,includeName=feedbackEl('feedback-name').checked,confirmScreenshot=feedbackEl('feedback-image-consent').checked;
 const file=feedbackEl('feedback-file').files?.[0];let screenshot;
 if(file){
  if(!confirmScreenshot)throw Error('Allow the selected screenshot first');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>150000)throw Error('Choose a PNG, JPEG or WebP screenshot up to 150 KB');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  if(version!==feedbackVersion||!feedbackEl('feedback-image-consent').checked||feedbackEl('feedback-file').files?.[0]!==file)return;
  screenshot={type:file.type,data:btoa(binary)};
 }
 if(version!==feedbackVersion)return;
 feedbackDraft={id:feedbackId,title,details,includeContext,context:feedbackContext,includeName,confirmScreenshot,screenshot,confirmPrivateFeedback:true};
 feedbackEl('feedback-review-text').textContent=[title,details,'Private reporter: '+feedbackMe.name,'Public name: '+(includeName?feedbackMe.name:'not included'),'Context: '+(includeContext?feedbackContext:'not included'),'Screenshot: '+(screenshot?'private attachment, visible to you and Cyrus':'none')].join('\n\n');
 if(screenshot){feedbackObjectURL=URL.createObjectURL(file);feedbackEl('feedback-local-image').src=feedbackObjectURL;feedbackEl('feedback-local-image').hidden=false;}
 feedbackEl('feedback-review-panel').hidden=false;
}
async function listFeedback(){
 const rows=await feedbackRequest('');feedbackEl('feedback-list').replaceChildren();
 for(const row of rows){const box=document.createElement('article'),button=document.createElement('button');button.type='button';button.textContent=row.reporter+' · '+row.state+' · '+row.created;button.onclick=()=>feedbackRun(()=>showFeedbackReport(row.id));box.append(button);feedbackEl('feedback-list').append(box);}
 if(!rows.length)feedbackEl('feedback-list').textContent='No reports yet.';
}
async function showFeedbackReport(id){
 const row=await feedbackRequest('/report?id='+encodeURIComponent(id));feedbackSelected=row;clearPublicPreview();
 feedbackEl('feedback-report').hidden=false;feedbackEl('feedback-report-title').textContent=row.title;
 const details=feedbackEl('feedback-report-details');details.textContent=[row.reporter+' · '+row.state,row.details,'Context: '+row.context,'Public first-name permission: '+(row.includeName?'yes':'no')].join('\n\n');
 if(row.issueUrl){const a=document.createElement('a');a.href=row.issueUrl;a.textContent='Open GitHub issue';a.target='_blank';a.rel='noopener noreferrer';details.append(document.createTextNode('\n'),a);}
 feedbackEl('feedback-report-image').hidden=!row.hasScreenshot;feedbackEl('feedback-report-image').removeAttribute('src');
 if(row.hasScreenshot)feedbackEl('feedback-report-image').src='/api/feedback/image?id='+encodeURIComponent(id);
 feedbackEl('feedback-owner-review').hidden=feedbackMe.role!=='owner'||row.state!=='pending';
 feedbackEl('feedback-public-title').value=row.title;feedbackEl('feedback-public-details').value=row.details;
}
feedbackEl('feedback-open').onclick=()=>feedbackRun(()=>openFeedback());
feedbackEl('feedback-new').onclick=()=>{clearFeedbackPreview();clearPublicPreview();feedbackId=crypto.randomUUID();feedbackEl('feedback-form').reset();feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-status').textContent='New private report. Nothing has been submitted.';};
feedbackEl('feedback-close').onclick=()=>{clearFeedbackPreview();clearPublicPreview();feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-report-image').removeAttribute('src');feedbackEl('feedback-dialog').close();};
feedbackEl('feedback-dialog').addEventListener('cancel',()=>{clearFeedbackPreview();clearPublicPreview();feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-report-image').removeAttribute('src');});
feedbackEl('feedback-form').addEventListener('input',event=>{if(event.target.id!=='feedback-submit-consent')clearFeedbackPreview();});
feedbackEl('feedback-image-consent').addEventListener('change',()=>{clearFeedbackPreview();feedbackEl('feedback-file').disabled=!feedbackEl('feedback-image-consent').checked;if(feedbackEl('feedback-file').disabled)feedbackEl('feedback-file').value='';});
feedbackEl('feedback-review').onclick=()=>feedbackRun(prepareFeedback);
feedbackEl('feedback-form').onsubmit=event=>{event.preventDefault();feedbackRun(async()=>{
 if(!feedbackDraft||!feedbackEl('feedback-submit-consent').checked)throw Error('Preview and confirm this report first');
 const result=await feedbackRequest('/submit',feedbackDraft);
 clearFeedbackPreview();feedbackId=crypto.randomUUID();feedbackEl('feedback-title').value='';feedbackEl('feedback-details').value='';feedbackEl('feedback-context').checked=false;feedbackEl('feedback-name').checked=false;feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;
 feedbackEl('feedback-status').textContent='Report saved privately for Cyrus. No GitHub issue has been published yet.';await listFeedback();await showFeedbackReport(result.id);
});};
feedbackEl('feedback-refresh').onclick=()=>feedbackRun(listFeedback);
for(const id of ['feedback-public-title','feedback-public-details'])feedbackEl(id).addEventListener('input',clearPublicPreview);
feedbackEl('feedback-public-preview').onclick=()=>feedbackRun(async()=>{
 clearPublicPreview();const title=feedbackEl('feedback-public-title').value,details=feedbackEl('feedback-public-details').value;
 const preview=await feedbackRequest('/preview',{id:feedbackSelected.id,publicTitle:title,publicDetails:details});
 if(title!==feedbackEl('feedback-public-title').value||details!==feedbackEl('feedback-public-details').value)return;
 feedbackPublic={...preview,id:feedbackSelected.id,publicTitle:title,publicDetails:details};
 feedbackEl('feedback-public-text').textContent='PUBLIC: '+preview.repository+'\n\n'+preview.payload.title+'\n\n'+preview.payload.body;feedbackEl('feedback-public-panel').hidden=false;
});
feedbackEl('feedback-publish').onclick=()=>feedbackRun(async()=>{
 if(!feedbackPublic||!feedbackEl('feedback-publish-consent').checked)throw Error('Preview and approve the exact public issue first');
 const result=await feedbackRequest('/publish',{id:feedbackPublic.id,publicTitle:feedbackPublic.publicTitle,publicDetails:feedbackPublic.publicDetails,digest:feedbackPublic.digest,confirmPublicIssue:true});
 clearPublicPreview();feedbackEl('feedback-status').textContent='GitHub issue created. Screenshot remains restricted.';await listFeedback();await showFeedbackReport(feedbackSelected.id);
});
feedbackEl('feedback-reject').onclick=()=>feedbackRun(async()=>{await feedbackRequest('/reject',{id:feedbackSelected.id});await listFeedback();await showFeedbackReport(feedbackSelected.id);});
function feedbackFromLink(){const match=window.location.hash.match(/^#feedback=([a-f0-9-]{36})$/);if(match)feedbackRun(()=>openFeedback(match[1]));}
window.addEventListener('hashchange',feedbackFromLink);feedbackFromLink();
