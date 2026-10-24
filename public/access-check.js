const accessEl=id=>document.getElementById(id);let checkingAccess=false;
async function accessRead(path){
 return fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
}
async function runAccessCheck(){
 if(checkingAccess)return;checkingAccess=true;accessEl('run-check').disabled=true;accessEl('check-results').replaceChildren();accessEl('check-identity').textContent='';accessEl('check-status').textContent='Checking your verified sign-in…';
 try{
  const response=await accessRead('/api/me');
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();throw Error('Sign in to the Hub, then reopen this page.');}
  const me=await response.json();if(!['owner','parent','child'].includes(me.role))throw Error('Unrecognized account role. Stop and contact Cyrus.');
  const names={cyrus:'Cyrus',anhaita:'Anhaita',iyanah:'Iyanah',aarish:'Aarish'};
  if(!Object.hasOwn(names,me.id)||me.role!==(me.id==='cyrus'?'owner':me.id==='anhaita'?'parent':'child'))throw Error('Account role does not match the family directory. Stop and contact Cyrus.');
  accessEl('check-identity').textContent=names[me.id]+' · '+me.role;
  const owner=me.role==='owner',adult=me.role!=='child';
  const probes=[['Family conversation','/api/messages?room=family',200],['Parents private conversation','/api/messages?room=parents',adult?200:403],['Owner Google controls','/api/google/status',owner?200:403],['Owner external actions','/api/actions',owner?200:403],['Owner reminders','/api/reminders',owner?200:403]];
  let passed=0;
  for(const [label,path,expected] of probes){
   const result=await accessRead(path),actual=result.status;await result.body?.cancel();
   const ok=actual===expected,row=document.createElement('tr');
   for(const value of [label,String(expected),String(actual),ok?'Pass':'FAIL']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
   accessEl('check-results').append(row);if(ok)passed++;
   // An unexpected successful private read is a stop condition, never content to show.
   if(!ok){accessEl('check-status').textContent='Stopped: '+label+' returned an unexpected status. Tell Cyrus the check name and status only.';return;}
  }
  accessEl('check-status').textContent=passed+' of '+probes.length+' checks passed. Confirm the displayed person is you. Nothing was submitted or saved.';
 }catch{accessEl('check-status').textContent='Check could not finish. Sign in again or retry when connected. No private response contents were displayed.';}
 finally{checkingAccess=false;accessEl('run-check').disabled=false;}
}
accessEl('run-check').onclick=runAccessCheck;
