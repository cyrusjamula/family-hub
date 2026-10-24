const feedbackEl=id=>document.getElementById(id);

// Upgrade the existing feedback markup without embedding selected files in URLs.
const feedbackReferenceLabel=document.createElement('label');feedbackReferenceLabel.textContent='Related request reference (optional; copy the UUID shown with a Hub error)';
const feedbackReference=document.createElement('input');feedbackReference.id='feedback-reference';feedbackReference.maxLength=36;feedbackReference.autocomplete='off';feedbackReference.spellcheck=false;feedbackReferenceLabel.append(feedbackReference);feedbackEl('feedback-review').before(feedbackReferenceLabel);
const oldFeedbackImage=feedbackEl('feedback-local-image');
const feedbackCanvas=document.createElement('canvas');feedbackCanvas.id='feedback-local-image';feedbackCanvas.hidden=true;
feedbackCanvas.setAttribute('role','img');feedbackCanvas.setAttribute('aria-label','Selected screenshot preview');oldFeedbackImage.replaceWith(feedbackCanvas);
const feedbackTriage=document.querySelector('#feedback-dialog details.panel');feedbackTriage.id='feedback-triage';
const feedbackFilterLabel=document.createElement('label');feedbackFilterLabel.textContent='Reports ';
const feedbackFilter=document.createElement('select');feedbackFilter.id='feedback-filter';
for(const [value,title] of [['pending','Pending review'],['all','All reports']]){const option=document.createElement('option');option.value=value;option.textContent=title;feedbackFilter.append(option);}
feedbackFilterLabel.append(feedbackFilter);feedbackEl('feedback-refresh').before(feedbackFilterLabel);
const feedbackPaging=document.createElement('div');feedbackPaging.className='row';
for(const [id,title] of [['feedback-previous','Previous'],['feedback-next','Next']]){const button=document.createElement('button');button.id=id;button.type='button';button.textContent=title;button.hidden=true;feedbackPaging.append(button);}
feedbackEl('feedback-list').after(feedbackPaging);

let feedbackMe,feedbackId=null,feedbackContext='unspecified',feedbackDraft=null,feedbackSelected=null,feedbackPublic=null,feedbackCursor=null,feedbackNextCursor=null,feedbackCursorHistory=[],feedbackVersion=0,feedbackBusy=false;
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
 feedbackEl('feedback-local-image').width=0;feedbackEl('feedback-local-image').height=0;feedbackEl('feedback-local-image').hidden=true;
}
function clearPublicPreview(){feedbackPublic=null;feedbackEl('feedback-public-panel').hidden=true;feedbackEl('feedback-publish-consent').checked=false;}
async function openFeedback(id){
 feedbackEl('feedback-dialog').showModal();
 const response=await fetch('/api/me');if(!response.ok)throw Error('Sign in to send feedback');feedbackMe=await response.json();
 const config=await feedbackRequest('/config');if(!config.enabled)throw Error('Feedback setup is pending. Your draft stays on this page.');
 feedbackId??=crypto.randomUUID();
 feedbackContext=document.querySelector('[data-view][aria-pressed="true"]')?.dataset.view||'unspecified';
 feedbackEl('feedback-status').textContent='Nothing is collected until you choose to submit. Reports stay private until Cyrus approves publication.';
 feedbackCursor=null;feedbackCursorHistory=[];feedbackEl('feedback-filter').value=feedbackMe.role==='owner'?'pending':'all';
 if(id)await showFeedbackReport(id);else await listFeedback();
}
async function prepareFeedback(){
 clearFeedbackPreview();const version=feedbackVersion;
 const title=feedbackEl('feedback-title').value.trim(),details=feedbackEl('feedback-details').value.trim();
 if(!title||title.length>120||!details||details.length>3000)throw Error('Enter a short title and feedback details');
 const includeContext=feedbackEl('feedback-context').checked,includeName=feedbackEl('feedback-name').checked,confirmScreenshot=feedbackEl('feedback-image-consent').checked,relatedRequestId=feedbackEl('feedback-reference').value.trim();
 const file=feedbackEl('feedback-file').files?.[0];let screenshot;
 if(file){
  if(!confirmScreenshot)throw Error('Allow the selected screenshot first');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>150000)throw Error('Choose a PNG, JPEG or WebP screenshot up to 150 KB');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  if(version!==feedbackVersion||!feedbackEl('feedback-image-consent').checked||feedbackEl('feedback-file').files?.[0]!==file)return;
  screenshot={type:file.type,data:btoa(binary)};
 }
 if(version!==feedbackVersion)return;
 feedbackDraft={id:feedbackId,title,details,includeContext,context:includeContext?feedbackContext:'unspecified',includeName,relatedRequestId,confirmScreenshot,screenshot,confirmPrivateFeedback:true};
 feedbackEl('feedback-review-text').textContent=[title,details,'Private reporter: '+feedbackMe.name,'Public name: '+(includeName?feedbackMe.name:'not included'),'Context: '+(includeContext?feedbackContext:'not included'),'Related request reference: '+(relatedRequestId||'not included'),'Screenshot: '+(screenshot?'private attachment, visible to you and Cyrus':'none')].join('\n\n');
 if(screenshot){
  if(typeof createImageBitmap!=='function')throw Error('Screenshot preview is not supported here. Submit without the attachment.');
  const bitmap=await createImageBitmap(file);
  try{if(version!==feedbackVersion||!feedbackEl('feedback-image-consent').checked){feedbackDraft=null;return;}
   if(bitmap.width*bitmap.height>16000000)throw Error('Choose a smaller screenshot');
   const canvas=feedbackEl('feedback-local-image');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);canvas.hidden=false;
  }finally{bitmap.close();}
 }
 feedbackEl('feedback-review-panel').hidden=false;
}
async function listFeedback(){
 const page=await feedbackRequest('?state='+feedbackEl('feedback-filter').value+(feedbackCursor?'&cursor='+encodeURIComponent(feedbackCursor):'')),rows=page.reports;feedbackNextCursor=page.nextCursor;feedbackEl('feedback-list').replaceChildren();
 feedbackEl('feedback-previous').hidden=!feedbackCursorHistory.length;feedbackEl('feedback-next').hidden=!feedbackNextCursor;
 for(const row of rows){const box=document.createElement('article'),button=document.createElement('button');button.type='button';button.textContent=row.reporter+' · '+row.state+' · '+row.created;button.onclick=()=>feedbackRun(()=>showFeedbackReport(row.id));box.append(button);feedbackEl('feedback-list').append(box);}
 if(!rows.length)feedbackEl('feedback-list').textContent='No reports yet.';
}
async function showFeedbackReport(id){
 const row=await feedbackRequest('/report?id='+encodeURIComponent(id));feedbackSelected=row;clearPublicPreview();
 feedbackEl('feedback-triage').open=true;feedbackEl('feedback-report').hidden=false;feedbackEl('feedback-report-title').textContent=row.title;
 const details=feedbackEl('feedback-report-details');details.textContent=[row.reporter+' · '+row.state,row.details,'Context: '+row.context,'Related request reference: '+(row.relatedRequestId||'none'),'Hub release: '+(row.release||'unknown'),'Public first-name permission: '+(row.includeName?'yes':'no')].join('\n\n');
 if(typeof row.issueUrl==='string'&&/^https:\/\/github\.com\/cyrusjamula\/family-hub\/issues\/[1-9]\d*$/.test(row.issueUrl)){const a=document.createElement('a');a.href=row.issueUrl;a.textContent='Open GitHub issue';a.target='_blank';a.rel='noopener noreferrer';details.append(document.createTextNode('\n'),a);}
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
 clearFeedbackPreview();feedbackId=crypto.randomUUID();feedbackEl('feedback-title').value='';feedbackEl('feedback-details').value='';feedbackEl('feedback-reference').value='';feedbackEl('feedback-context').checked=false;feedbackEl('feedback-name').checked=false;feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;
 feedbackEl('feedback-status').textContent='Report saved privately for Cyrus. No GitHub issue has been published yet.';await listFeedback();await showFeedbackReport(result.id);
});};
function resetFeedbackQueue(){feedbackCursor=null;feedbackCursorHistory=[];return listFeedback();}
feedbackEl('feedback-refresh').onclick=()=>feedbackRun(resetFeedbackQueue);
feedbackEl('feedback-filter').addEventListener('change',()=>feedbackRun(resetFeedbackQueue));
feedbackEl('feedback-next').onclick=()=>feedbackRun(async()=>{if(feedbackNextCursor){feedbackCursorHistory.push(feedbackCursor);feedbackCursor=feedbackNextCursor;await listFeedback();}});
feedbackEl('feedback-previous').onclick=()=>feedbackRun(async()=>{if(feedbackCursorHistory.length){feedbackCursor=feedbackCursorHistory.pop();await listFeedback();}});
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
 clearPublicPreview();feedbackEl('feedback-status').textContent='GitHub issue created. Screenshot remains restricted.';await resetFeedbackQueue();await showFeedbackReport(feedbackSelected.id);
});
feedbackEl('feedback-reject').onclick=()=>feedbackRun(async()=>{await feedbackRequest('/reject',{id:feedbackSelected.id});await resetFeedbackQueue();await showFeedbackReport(feedbackSelected.id);});
function feedbackFromLink(){const match=window.location.hash.match(/^#feedback=([a-f0-9-]{36})$/);if(match)feedbackRun(()=>openFeedback(match[1]));}
window.addEventListener('hashchange',feedbackFromLink);feedbackFromLink();
