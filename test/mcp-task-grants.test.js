import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createMcpTaskGrants} from '../src/integrations/mcp-task-grants.js';
const task='12345678-1234-4123-8123-123456789abc';
const schema=readFileSync(new URL('../scripts/mcp-task-grant-schema.sql',import.meta.url),'utf8');
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,version INTEGER,assignee_id TEXT,room TEXT,title TEXT,details TEXT,provenance TEXT,status TEXT,approval TEXT,private_extra TEXT)');
 sql.exec(schema);
 sql.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)').run(task,1,'child','family','Synthetic task','Synthetic detail','Synthetic source','todo','requested','never-return');
 const roles={owner:'owner',child:'child',parent:'parent'};let clock=1000,client=true;
 const db={async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}},prepare(q){return {bind(...args){return {async run(){let result=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(result.changes)}};},async first(){return sql.prepare(q).get(...args)||null;}};}};}};
 const grants=createMcpTaskGrants({db,resolveOwner:async s=>s==='verified-owner'?{id:'owner',role:'owner'}:null,
  resolveMember:async id=>roles[id]?{id,role:roles[id]}:null,resolveClient:async (memberId,clientId)=>client&&memberId==='child'&&['client-a','client-b'].includes(clientId),verifyApproval:async (_session,_owner,details,evidence)=>evidence===JSON.stringify(details),now:()=>clock});
 const consent={grantId:'grant-1',task,version:1,memberId:'child',clientId:'client-a',expiresAt:1100};
 consent.confirmation=JSON.stringify(consent);
 return {sql,grants,roles,consent,principal:{memberId:'child',clientId:'client-a'},tick:n=>{clock=n;},disconnect:()=>{client=false;}};
}
test('exact owner-approved client and task version can read only projected task fields',async t=>{
 const f=fixture(t);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 assert.equal(await f.grants.approve('verified-owner',f.consent),true);
 const result=await f.grants.read(f.principal,task);assert.equal(result.ok,true);
 assert.deepEqual({...result.task},{id:task,title:'Synthetic task',details:'Synthetic detail',provenance:'Synthetic source',status:'todo',approval:'requested',version:1});
 assert.equal((await f.grants.read({...f.principal,clientId:'client-b'},task)).ok,false);
 assert.equal((await f.grants.read({...f.principal,memberId:'parent'},task)).ok,false);
 assert.equal(await f.grants.approve('verified-owner',{...f.consent,grantId:'grant-2'}),false);
 assert.equal(await f.grants.revoke('verified-owner','grant-1'),true);
 assert.equal((await f.grants.read(f.principal,task)).ok,false);
});
test('requires a current owner and explicit bounded version-specific consent',async t=>{
 const f=fixture(t);
 for(const c of [{confirmation:'invalid'},{version:2},{expiresAt:1000},{expiresAt:1000+7*86400+1},{clientId:'client-b'},{memberId:'parent'}])assert.equal(await f.grants.approve('verified-owner',{...f.consent,...c}),false);
 assert.equal(await f.grants.approve({id:'owner',role:'owner'},f.consent),false);
 f.roles.owner='parent';assert.equal(await f.grants.approve('verified-owner',f.consent),false);
 f.roles.owner='owner';assert.equal(await f.grants.approve('verified-owner',f.consent),true);
 assert.equal(await f.grants.revoke('unverified','grant-1'),false);
});
test('task edits, current access, expiration and client disconnect invalidate a grant',async t=>{
 const f=fixture(t);assert.equal(await f.grants.approve('verified-owner',f.consent),true);
 f.sql.prepare('UPDATE tasks SET version=2 WHERE id=?').run(task);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 f.sql.prepare('UPDATE tasks SET version=1,room=\'parents\' WHERE id=?').run(task);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 f.sql.prepare('UPDATE tasks SET room=\'family\',assignee_id=\'parent\' WHERE id=?').run(task);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 f.sql.prepare('UPDATE tasks SET assignee_id=\'child\' WHERE id=?').run(task);delete f.roles.child;assert.equal((await f.grants.read(f.principal,task)).ok,false);
 f.roles.child='child';f.tick(1100);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 f.tick(1050);f.disconnect();assert.equal((await f.grants.read(f.principal,task)).ok,false);
});
test('children cannot obtain a grant for a parents-only task and database errors fail closed',async t=>{
 const f=fixture(t);f.sql.prepare('UPDATE tasks SET room=\'parents\' WHERE id=?').run(task);
 assert.equal(await f.grants.approve('verified-owner',f.consent),false);
 const broken=createMcpTaskGrants({db:{batch(){throw Error('sensitive fixture');},prepare(){throw Error('sensitive fixture');}},resolveOwner:async()=>({id:'owner',role:'owner'}),resolveMember:async id=>({id,role:id==='owner'?'owner':'child'}),resolveClient:async()=>true,verifyApproval:async()=>true,now:()=>1000});
 assert.equal(await broken.approve('x',f.consent),false);assert.deepEqual(await broken.read(f.principal,task),{ok:false,error:'Task unavailable'});
});

test('fresh consent renews expired grants atomically while historical IDs cannot replay',async t=>{
 const f=fixture(t);assert.equal(await f.grants.approve('verified-owner',f.consent),true);
 f.tick(1100);assert.equal((await f.grants.read(f.principal,task)).ok,false);
 const replacement={...f.consent,grantId:'grant-2',expiresAt:1200};delete replacement.confirmation;replacement.confirmation=JSON.stringify(replacement);
 assert.equal(await f.grants.approve('verified-owner',replacement),true);
 assert.equal((await f.grants.read(f.principal,task)).ok,true);
 assert.equal(f.sql.prepare('SELECT revoked FROM mcp_task_read_grants WHERE id=?').get('grant-1').revoked,1);
 f.tick(1200);
 const replay={...f.consent,expiresAt:1300};delete replay.confirmation;replay.confirmation=JSON.stringify(replay);
 assert.equal(await f.grants.approve('verified-owner',replay),false);
 assert.equal(f.sql.prepare('SELECT revoked FROM mcp_task_read_grants WHERE id=?').get('grant-2').revoked,0);
 const third={...replacement,grantId:'grant-3',expiresAt:1300};delete third.confirmation;third.confirmation=JSON.stringify(third);
 assert.equal(await f.grants.approve('verified-owner',third),true);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM mcp_task_read_grants WHERE revoked=0').get().n,1);
});
test('failed renewal rolls retirement back and fresh consent cannot replace an active grant',async t=>{
 const f=fixture(t);assert.equal(await f.grants.approve('verified-owner',f.consent),true);
 const replacement={...f.consent,grantId:'grant-2',expiresAt:1200};delete replacement.confirmation;replacement.confirmation=JSON.stringify(replacement);
 assert.equal(await f.grants.approve('verified-owner',replacement),false);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM mcp_task_read_grants').get().n,1);
 f.tick(1100);
 f.sql.exec("CREATE TRIGGER reject_renewal BEFORE INSERT ON mcp_task_read_grants WHEN NEW.id='grant-2' BEGIN SELECT RAISE(ABORT,'synthetic insert failure'); END");
 assert.equal(await f.grants.approve('verified-owner',replacement),false);
 assert.equal(f.sql.prepare('SELECT revoked FROM mcp_task_read_grants WHERE id=?').get('grant-1').revoked,0);
 f.sql.exec('DROP TRIGGER reject_renewal');
 assert.equal(await f.grants.approve('verified-owner',replacement),true);
});
