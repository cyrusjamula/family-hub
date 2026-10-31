// Read-only provider reconciliation: this module never creates or retries an issue.
const repo='cyrusjamula/family-hub';
const issueURL=n=>'https://github.com/'+repo+'/issues/'+n;
export async function verifyPublishedFeedback(number,payload,token,send=fetch){
 if(!Number.isSafeInteger(number)||number<1||!token||typeof payload?.title!=='string'||typeof payload?.body!=='string')throw Error('Existing issue could not be verified');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await send('https://api.github.com/repos/'+repo+'/issues/'+number,{method:'GET',redirect:'manual',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Jamula-Family-Hub','X-GitHub-Api-Version':'2022-11-28'}});
  if(response.status!==200||!response.body)throw Error();
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const issue=JSON.parse(text);
  if(issue.number!==number||issue.html_url!==issueURL(number)||issue.pull_request||issue.title!==payload.title||issue.body!==payload.body)throw Error();
  return issueURL(number);
 }catch{throw Error('Existing issue could not be verified');}finally{clearTimeout(timer);}
}
