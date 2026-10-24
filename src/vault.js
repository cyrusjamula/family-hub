const enc=new TextEncoder(),dec=new TextDecoder();
export function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export function unbase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function key(env){const bytes=unbase64(env.GOOGLE_VAULT_KEY||'');if(bytes.length!==32)throw Error('Vault not configured');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,value,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},await key(env),enc.encode(JSON.stringify(value)));return JSON.stringify({iv:base64(iv),data:base64(new Uint8Array(ciphertext))});}
export async function open(env,value,aad){const v=JSON.parse(value);return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(v.iv),additionalData:enc.encode(aad)},await key(env),unbase64(v.data))));}
