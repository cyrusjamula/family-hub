import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('small muted text meets 4.5:1 contrast on each surface that uses it',async()=>{
 const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
 const foreground=css.match(/--muted:(#[0-9a-f]{6})/i)[1];
 const backgrounds=[
  '#ffffff',
  css.match(/:root\{[^}]*background:(#[0-9a-f]{6})/i)[1],
  css.match(/\.room-nav\{[^}]*background:(#[0-9a-f]{6})/i)[1],
  css.match(/\.main-nav button\[aria-pressed=true\]\{[^}]*background:(#[0-9a-f]{6})/i)[1]
 ];
 function luminance(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];}
 for(const background of backgrounds){const [a,b]=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);const contrast=(a+0.05)/(b+0.05);assert.ok(contrast>=4.5,`${foreground} on ${background}: ${contrast.toFixed(2)}:1`);}
});
