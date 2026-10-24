export async function reserveAI(env){
 const day=new Date().toISOString().slice(0,10);
 return !!await env.DB.prepare('INSERT INTO usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1 WHERE calls<80 RETURNING calls').bind(day).first();
}
