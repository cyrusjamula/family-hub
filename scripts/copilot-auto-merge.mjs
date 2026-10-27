export const COPILOT_REVIEW_CHECK='copilot-review';
const reviewer='copilot-pull-request-reviewer[bot]';

export async function reconcilePullRequests({github,context,core,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const repo=context.repo;
 const pulls=context.eventName==='pull_request_target'
  ?[context.payload.pull_request]
  :await github.paginate(github.rest.pulls.list,{...repo,state:'open',per_page:100});
 for(const pull of pulls){
  const {data:pr}=await github.rest.pulls.get({...repo,pull_number:pull.number});
  if(pr.state!=='open')continue;
  const reviews=await github.paginate(github.rest.pulls.listReviews,{...repo,pull_number:pr.number,per_page:100});
  const review=reviews.filter(r=>r.user?.login===reviewer&&r.user?.type==='Bot'&&r.commit_id===pr.head.sha)
   .sort((a,b)=>b.id-a.id)[0];
  const reviewed=!pr.draft&&['APPROVED','COMMENTED'].includes(review?.state);
  const checks=await github.paginate(github.rest.checks.listForRef,{...repo,ref:pr.head.sha,check_name:COPILOT_REVIEW_CHECK,per_page:100});
  const existing=checks.find(c=>c.name===COPILOT_REVIEW_CHECK&&c.app?.slug==='github-actions');
  const check={
   ...repo,
   name:COPILOT_REVIEW_CHECK,
   status:reviewed?'completed':'in_progress',
   output:{
    title:reviewed?'Copilot reviewed the current commit':'Waiting for Copilot review',
    summary:pr.draft?'Draft pull requests cannot auto-merge.'
     :reviewed?'Copilot reviewed this exact head commit. All other merge requirements still apply.'
      :'A non-dismissed Copilot review of the current head commit is required before merging.'
   }
  };
  if(reviewed)check.conclusion='success';
  if(existing)await github.rest.checks.update({...check,check_run_id:existing.id});
  else await github.rest.checks.create({...check,head_sha:pr.head.sha});
  if(!reviewed){
   core.info(`PR #${pr.number}: waiting for a current Copilot review.`);
   continue;
  }
  const {data:latest}=await github.rest.pulls.get({...repo,pull_number:pr.number});
  if(latest.state!=='open'||latest.draft||latest.head.sha!==pr.head.sha){
   core.info(`PR #${pr.number}: changed during reconciliation; not enabling auto-merge.`);
   continue;
  }
  const {node}=await github.graphql(`query($id: ID!) {
   node(id: $id) { ... on PullRequest { autoMergeRequest { enabledAt } } }
  }`,{id:pr.node_id});
  if(!node)throw Error(`PR #${pr.number}: could not read auto-merge state.`);
  let changedWhileWaiting=false;
  if(!node.autoMergeRequest){
   for(let attempt=0;attempt<3;attempt++){
    try{
     await github.graphql(`mutation($id: ID!) {
   enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) {
    pullRequest { number }
   }
  }`,{id:pr.node_id});
     break;
    }catch(error){
     // GitHub can temporarily reject a PR while checks change status. Only
     // retry this specific response, and fail visibly if it never settles.
     const unstable=Array.isArray(error?.errors)&&error.errors.length===1&&
      error.errors[0]?.type==='UNPROCESSABLE'&&error.errors[0]?.message==='Pull request Pull request is in unstable status';
     if(!unstable||attempt===2)throw error;
     await wait(2000);
     const {data:current}=await github.rest.pulls.get({...repo,pull_number:pr.number});
     if(current.state!=='open'||current.draft||current.head.sha!==pr.head.sha){
      core.info(`PR #${pr.number}: changed while waiting for mergeability.`);changedWhileWaiting=true;break;
     }
     const status=await github.graphql(`query($id: ID!) {
      node(id: $id) { ... on PullRequest { autoMergeRequest { enabledAt } } }
     }`,{id:pr.node_id});
     if(!status.node)throw Error(`PR #${pr.number}: could not read auto-merge state.`);
     if(status.node.autoMergeRequest)break;
    }
   }
  }
  if(changedWhileWaiting)continue;
  core.info(`PR #${pr.number}: squash auto-merge enabled after Copilot review.`);
 }
}
