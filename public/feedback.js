import {captureFeedbackPage} from './feedback-capture.js';
const feedbackEl=id=>document.getElementById(id);
const feedbackReferenceUUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// Upgrade the existing feedback markup without embedding selected files in URLs.
const feedbackReferenceLabel=document.createElement('label');feedbackReferenceLabel.textContent='Related request reference (optional; copy the UUID shown with a Hub error)';
const feedbackReference=document.createElement('input');feedbackReference.id='feedback-reference';feedbackReference.maxLength=36;feedbackReference.autocomplete='off';feedbackReference.spellcheck=false;feedbackReferenceLabel.append(feedbackReference);feedbackEl('feedback-review').before(feedbackReferenceLabel);
const oldFeedbackImage=feedbackEl('feedback-local-image');
const feedbackCanvas=document.createElement('canvas');feedbackCanvas.id='feedback-local-image';feedbackCanvas.hidden=true;
feedbackCanvas.setAttribute('role','img');feedbackCanvas.setAttribute('aria-label','Selected screenshot preview');oldFeedbackImage.replaceWith(feedbackCanvas);
const feedbackSourceLabel=document.createElement('label');feedbackSourceLabel.textContent='Screenshot (optional)';
const feedbackSource=document.createElement('select');feedbackSource.id='feedback-screenshot-source';
for(const [value,title] of [['none','No screenshot'],['page','Page before feedback opened'],['upload','Upload an image']]){const option=document.createElement('option');option.value=value;option.textContent=title;feedbackSource.append(option);}
feedbackSource.value='none';feedbackSourceLabel.append(feedbackSource);
const feedbackPageStatus=document.createElement('p');feedbackPageStatus.id='feedback-page-status';feedbackPageStatus.setAttribute('role','status');
const feedbackPagePreview=document.createElement('canvas');feedbackPagePreview.id='feedback-page-preview';feedbackPagePreview.hidden=true;feedbackPagePreview.setAttribute('role','img');feedbackPagePreview.setAttribute('aria-label','Local page preview before feedback opened');
(feedbackEl('feedback-image-consent').parentElement||feedbackEl('feedback-review')).before(feedbackSourceLabel,feedbackPageStatus,feedbackPagePreview);
feedbackEl('feedback-open').title='Prepare feedback and a local page preview. Nothing is uploaded unless you choose to attach it.';
const feedbackTriage=document.querySelector('#feedback-dialog details.panel');feedbackTriage.id='feedback-triage';
const feedbackFilterLabel=document.createElement('label');feedbackFilterLabel.textContent='Reports ';
const feedbackFilter=document.createElement('select');feedbackFilter.id='feedback-filter';
for(const [value,title] of [['pending','Pending review'],['all','All reports']]){const option=document.createElement('option');option.value=value;option.textContent=title;feedbackFilter.append(option);}
feedbackFilterLabel.append(feedbackFilter);feedbackEl('feedback-refresh').before(feedbackFilterLabel);
const feedbackPaging=document.createElement('div');feedbackPaging.className='row';
for(const [id,title] of [['feedback-previous','Previous'],['feedback-next','Next']]){const button=document.createElement('button');button.id=id;button.type='button';button.textContent=title;button.hidden=true;feedbackPaging.append(button);}
feedbackEl('feedback-list').after(feedbackPaging);
const feedbackRecovery=document.createElement('section');feedbackRecovery.id='feedback-recovery';feedbackRecovery.hidden=true;
const feedbackRecoveryHelp=document.createElement('p');feedbackRecoveryHelp.textContent='Publication was uncertain. Check GitHub for this report’s Feedback ID, then verify the existing issue below. This never creates or resends an issue.';
const feedbackIssueLabel=document.createElement('label');feedbackIssueLabel.textContent='Existing GitHub issue number ';
const feedbackIssueNumber=document.createElement('input');feedbackIssueNumber.id='feedback-existing-issue';feedbackIssueNumber.type='number';feedbackIssueNumber.min='1';feedbackIssueNumber.step='1';feedbackIssueLabel.append(feedbackIssueNumber);
const feedbackRecover=document.createElement('button');feedbackRecover.id='feedback-reconcile';feedbackRecover.type='button';feedbackRecover.textContent='Verify and link existing issue';
feedbackRecovery.append(feedbackRecoveryHelp,feedbackIssueLabel,feedbackRecover);feedbackEl('feedback-report').append(feedbackRecovery);

let feedbackMe,feedbackId=null,feedbackContext='unspecified',feedbackDraft=null,feedbackSelected=null,feedbackPublic=null,feedbackCursor=null,feedbackNextCursor=null,feedbackCursorHistory=[],feedbackVersion=0,feedbackBusy=false,feedbackAvailable=false,feedbackPage=null,feedbackOpening=0; 
async function feedbackRequest(route,body){
 let response;try{response=await fetch('/api/feedback'+route,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Feedback could not be confirmed. Keep your draft and retry the same report after checking your connection or sign-in.');}
 if(response.status===401||response.status===403||response.redirected||response.headers.get('content-type')?.includes('text/html'))throw Error('Sign in to the Hub again, then retry this same report. Your draft has not been cleared.');
 let data;try{data=await response.json();}catch{throw Error('Feedback could not be confirmed. Keep your draft and retry the same report.');}
 if(!response.ok)throw Error(data.error||'Feedback request failed. Your draft has not been cleared.');return data;
}
function feedbackScreenshotControls(){
 const file=feedbackEl('feedback-file'),consent=feedbackEl('feedback-image-consent');if(!file||!consent)return;
 file.disabled=feedbackBusy||feedbackSource.value!=='upload'||!consent.checked;
 if(file.parentElement)file.parentElement.hidden=feedbackSource.value!=='upload';
 consent.disabled=feedbackBusy||feedbackSource.value==='none';
}
function discardFeedbackPage(){feedbackPage=null;feedbackPagePreview.width=0;feedbackPagePreview.height=0;feedbackPagePreview.hidden=true;feedbackPageStatus.textContent='No page preview is retained. You can still upload an image.';}
async function feedbackRun(fn){
 const dialog=feedbackEl('feedback-dialog');if(feedbackBusy||!dialog||dialog.isConnected===false)return;feedbackBusy=true;feedbackEl('feedback-status').textContent='';
 dialog.querySelectorAll('button,input,textarea,select').forEach(button=>button.disabled=true);
 try{await fn();}catch(error){if(feedbackEl('feedback-status'))feedbackEl('feedback-status').textContent=error.message;}
 finally{feedbackBusy=false;dialog.querySelectorAll('button,input,textarea,select').forEach(button=>button.disabled=false);feedbackScreenshotControls();if(feedbackEl('feedback-review'))feedbackEl('feedback-review').disabled=!feedbackAvailable;if(feedbackEl('feedback-submit'))feedbackEl('feedback-submit').disabled=!feedbackAvailable;}
}
function clearFeedbackPreview(){
 ++feedbackVersion;feedbackDraft=null;feedbackEl('feedback-review-panel').hidden=true;feedbackEl('feedback-submit-consent').checked=false;
 feedbackEl('feedback-local-image').width=0;feedbackEl('feedback-local-image').height=0;feedbackEl('feedback-local-image').hidden=true;
}
function clearPublicPreview(){feedbackPublic=null;feedbackEl('feedback-public-panel').hidden=true;feedbackEl('feedback-publish-consent').checked=false;}
async function openFeedback(id){
 const ticket=++feedbackOpening,dialog=feedbackEl('feedback-dialog');feedbackAvailable=false;
 try{
  const response=await fetch('/api/me',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.redirected||!response.headers.get('content-type')?.includes('application/json'))throw Error('Sign in to the Hub to save feedback. Your draft stays here.');
  feedbackMe=await response.json();
  const shown=feedbackEl('identity')?.textContent;
  if(shown&&shown!=='Welcome, '+feedbackMe.name+' · '+feedbackMe.role)throw Error('Reload the Hub to verify your account before capturing a page or submitting feedback.');
  if(id){discardFeedbackPage();feedbackSource.value='none';feedbackEl('feedback-image-consent').checked=false;}
  if(!id){const captured=await captureFeedbackPage().catch(()=>null);if(ticket!==feedbackOpening||dialog.isConnected===false)return;discardFeedbackPage();feedbackPage=captured;feedbackSource.value='none';feedbackPageStatus.textContent=captured?'Local page preview ready. Choose it to review, then allow attachment. It may differ from your screen.':'Page capture was unavailable. Text feedback and image upload still work.';}
 }catch(error){if(ticket===feedbackOpening&&dialog.isConnected!==false)dialog.showModal();discardFeedbackPage();throw error;}
 if(ticket!==feedbackOpening||dialog.isConnected===false)return;
 dialog.showModal();
 const config=await feedbackRequest('/config');if(ticket!==feedbackOpening||!dialog.open)return;
 if(!config.enabled)throw Error('Feedback is not enabled on the server yet. Nothing has been saved. Keep this page open or copy your draft.');
 feedbackAvailable=true;feedbackId??=crypto.randomUUID();
 feedbackContext=document.querySelector('[data-view][aria-pressed="true"]')?.dataset.view||'unspecified';
 feedbackEl('feedback-status').textContent='Nothing is uploaded until you choose to submit. Reports stay private until Cyrus approves publication.';
 feedbackCursor=null;feedbackCursorHistory=[];feedbackEl('feedback-filter').value=feedbackMe.role==='owner'?'pending':'all';
 try{if(id)await showFeedbackReport(id);else await listFeedback();}catch{feedbackEl('feedback-status').textContent='Your report list is unavailable. You can still submit a new private report.';}
}
async function prepareFeedback(){
 if(!feedbackAvailable)throw Error('Feedback is not enabled on the server yet. Nothing has been saved.');
 clearFeedbackPreview();const version=feedbackVersion;
 const title=feedbackEl('feedback-title').value.trim(),details=feedbackEl('feedback-details').value.trim();
 if(!title||title.length>120||!details||details.length>3000)throw Error('Enter a short title and feedback details');
 const includeContext=feedbackEl('feedback-context').checked,includeName=feedbackEl('feedback-name').checked,confirmScreenshot=feedbackEl('feedback-image-consent').checked,relatedRequestId=feedbackEl('feedback-reference').value.trim();
 if(relatedRequestId&&!feedbackReferenceUUID.test(relatedRequestId))throw Error('Enter a valid request reference UUID or leave it blank');
 const file=feedbackSource.value==='page'?feedbackPage:feedbackSource.value==='upload'?feedbackEl('feedback-file').files?.[0]:undefined;let screenshot;
 if(feedbackSource.value==='page'&&!file)throw Error('The page preview is unavailable. Choose no screenshot or upload an image.');
 if(file){
  if(!confirmScreenshot)throw Error('Allow the selected screenshot first');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>150000)throw Error('Choose a PNG, JPEG or WebP screenshot up to 150 KB');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  if(version!==feedbackVersion||!feedbackEl('feedback-image-consent').checked||(feedbackSource.value==='page'?feedbackPage:feedbackSource.value==='upload'?feedbackEl('feedback-file').files?.[0]:undefined)!==file)return;
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
 const details=feedbackEl('feedback-report-details');details.textContent=['Feedback ID: '+row.id,row.reporter+' · '+row.state,row.details,'Context: '+row.context,'Related request reference: '+(row.relatedRequestId||'none'),'Hub release: '+(row.release||'unknown'),'Public first-name permission: '+(row.includeName?'yes':'no')].join('\n\n');
 if(typeof row.issueUrl==='string'&&/^https:\/\/github\.com\/cyrusjamula\/family-hub\/issues\/[1-9]\d*$/.test(row.issueUrl)){const a=document.createElement('a');a.href=row.issueUrl;a.textContent='Open GitHub issue';a.target='_blank';a.rel='noopener noreferrer';details.append(document.createTextNode('\n'),a);}
 feedbackEl('feedback-report-image').hidden=!row.hasScreenshot;feedbackEl('feedback-report-image').removeAttribute('src');
 if(row.hasScreenshot)feedbackEl('feedback-report-image').src='/api/feedback/image?id='+encodeURIComponent(id);
 feedbackEl('feedback-owner-review').hidden=feedbackMe.role!=='owner'||row.state!=='pending';
 feedbackRecovery.hidden=feedbackMe.role!=='owner'||row.state!=='uncertain';feedbackIssueNumber.value='';
 feedbackEl('feedback-public-title').value=row.title;feedbackEl('feedback-public-details').value=row.details;
}
feedbackEl('feedback-open').onclick=()=>feedbackRun(()=>openFeedback());
feedbackEl('feedback-new').onclick=()=>{++feedbackOpening;discardFeedbackPage();feedbackSource.value='none';clearFeedbackPreview();clearPublicPreview();feedbackId=crypto.randomUUID();feedbackEl('feedback-form').reset();feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-status').textContent='New private report. Nothing has been submitted.';};
feedbackEl('feedback-close').onclick=()=>{++feedbackOpening;discardFeedbackPage();feedbackSource.value='none';clearFeedbackPreview();clearPublicPreview();feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-report-image').removeAttribute('src');feedbackEl('feedback-dialog').close();};
feedbackEl('feedback-dialog').addEventListener('cancel',()=>{++feedbackOpening;discardFeedbackPage();feedbackSource.value='none';clearFeedbackPreview();clearPublicPreview();feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;feedbackEl('feedback-report-image').removeAttribute('src');});
feedbackEl('feedback-form').addEventListener('input',event=>{if(event.target.id!=='feedback-submit-consent')clearFeedbackPreview();});
feedbackEl('feedback-image-consent').addEventListener('change',()=>{clearFeedbackPreview();if(!feedbackEl('feedback-image-consent').checked){discardFeedbackPage();feedbackSource.value='none';feedbackEl('feedback-file').value='';}feedbackScreenshotControls();});
feedbackSource.addEventListener('change',()=>{clearFeedbackPreview();feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackPagePreview.width=0;feedbackPagePreview.height=0;feedbackPagePreview.hidden=true;feedbackScreenshotControls();
 if(feedbackSource.value==='page'&&feedbackPage){const page=feedbackPage,version=feedbackVersion;void (async()=>{try{const bitmap=await createImageBitmap(page);try{if(version!==feedbackVersion||feedbackSource.value!=='page'||feedbackPage!==page)return;feedbackPagePreview.width=bitmap.width;feedbackPagePreview.height=bitmap.height;feedbackPagePreview.getContext('2d').drawImage(bitmap,0,0);feedbackPagePreview.hidden=false;}finally{bitmap.close();}}catch{feedbackPageStatus.textContent='Page preview could not be displayed. Choose no screenshot or upload an image.';discardFeedbackPage();}})();}
});
feedbackEl('feedback-review').onclick=()=>feedbackRun(prepareFeedback);
feedbackEl('feedback-form').onsubmit=event=>{event.preventDefault();feedbackRun(async()=>{
 if(!feedbackAvailable)throw Error('Feedback is not enabled on the server yet. Nothing has been saved.');
 if(!feedbackDraft||!feedbackEl('feedback-submit-consent').checked)throw Error('Preview and confirm this report first');
 const submitted=feedbackDraft,result=await feedbackRequest('/submit',submitted);
 if(result?.id!==submitted.id||!['pending','published','publishing','uncertain','rejected'].includes(result.state))throw Error('The server did not confirm this report. Keep your draft and retry with the same reference.');
 clearFeedbackPreview();discardFeedbackPage();feedbackSource.value='none';feedbackId=crypto.randomUUID();feedbackEl('feedback-title').value='';feedbackEl('feedback-details').value='';feedbackEl('feedback-reference').value='';feedbackEl('feedback-context').checked=false;feedbackEl('feedback-name').checked=false;feedbackEl('feedback-image-consent').checked=false;feedbackEl('feedback-file').value='';feedbackEl('feedback-file').disabled=true;
 const receipt='Report saved privately for Cyrus. Reference: '+result.id+'. No new GitHub issue was published by this submission.';feedbackEl('feedback-status').textContent=receipt;
 const followup=await Promise.allSettled([listFeedback(),showFeedbackReport(result.id)]);if(followup.some(r=>r.status==='rejected'))feedbackEl('feedback-status').textContent=receipt+' The report view could not refresh; reopen it later. Do not submit a duplicate.';
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
feedbackRecover.onclick=()=>feedbackRun(async()=>{
 const id=feedbackSelected?.id,issueNumber=Number(feedbackIssueNumber.value);
 if(!id||!Number.isSafeInteger(issueNumber)||issueNumber<1)throw Error('Enter the existing issue number from GitHub');
 const result=await feedbackRequest('/reconcile',{id,issueNumber,confirmExistingIssue:true});
 if(result?.state!=='published'||result.issueUrl!=='https://github.com/cyrusjamula/family-hub/issues/'+issueNumber)throw Error('Verification acknowledgement is invalid. Check the saved report before trying again.');
 feedbackEl('feedback-status').textContent='Existing GitHub issue verified and linked. No issue was created or resent.';
 await resetFeedbackQueue();if(feedbackSelected?.id===id)await showFeedbackReport(id);
});
function feedbackFromLink(){const match=window.location.hash.match(/^#feedback=([a-f0-9-]{36})$/);if(match)feedbackRun(()=>openFeedback(match[1]));}
window.addEventListener('hashchange',feedbackFromLink);feedbackFromLink();

feedbackScreenshotControls();
