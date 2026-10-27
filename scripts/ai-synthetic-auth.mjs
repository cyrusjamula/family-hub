import {jwtVerify} from 'jose';

// Offline authorization experiment only. This is not an OAuth authorization
// server, an MCP endpoint, production identity, or a real family data source.
// Callers inject a local verification key; never use a production key here.
export const syntheticIssuer='https://issuer.example.test';
export const syntheticAudience='https://resource.example.test/mcp';
const members=Object.freeze({'synthetic-owner':'owner','synthetic-parent':'parent','synthetic-child':'child'});
const policies=Object.freeze({
 family_read:{scope:'synthetic:read',roles:['owner','parent','child']},
 family_write:{scope:'synthetic:write',roles:['owner','parent','child']},
 parents_read:{scope:'synthetic:read',roles:['owner','parent']},
 owner_read:{scope:'synthetic:read',roles:['owner']}
});

export function createSyntheticResource({verificationKey}={}){
 if(!verificationKey)throw Error('Synthetic verification key required');
 let version=0;let option=null;
 return Object.freeze({
  async call({authorization,operation,choice}={}){
   // Generic denial prevents raw token, claims or verifier errors from leaking.
   const denied=()=>({ok:false,error:'unauthorized'});
   if(typeof authorization!=='string'||authorization.length>4096||!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))return denied();
   let claims;
   try{
    ({payload:claims}=await jwtVerify(authorization.slice(7),verificationKey,{algorithms:['ES256'],
     issuer:syntheticIssuer,audience:syntheticAudience,requiredClaims:['sub','exp','iat']}));
   }catch{return denied();}
   const role=Object.hasOwn(members,claims.sub)?members[claims.sub]:undefined;
   const policy=typeof operation==='string'&&Object.hasOwn(policies,operation)?policies[operation]:undefined;
   if(!role||!policy||typeof claims.scope!=='string'||!claims.scope.split(' ').includes(policy.scope)||!policy.roles.includes(role))return denied();
   if(operation==='family_write'){
    if(!['park-a','park-b'].includes(choice))return {ok:false,error:'invalid-synthetic-choice'};
    version++;option=choice;
    return {ok:true,synthetic:true,version,option,author:claims.sub};
   }
   if(choice!==undefined)return {ok:false,error:'invalid-synthetic-choice'};
   if(operation==='family_read')return {ok:true,synthetic:true,version,option};
   return {ok:true,synthetic:true,room:operation==='parents_read'?'fictional-parents':'fictional-owner'};
  }
 });
}
