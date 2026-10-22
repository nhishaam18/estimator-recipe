import fs from 'node:fs/promises';
import path from 'node:path';

// Return only one bounded portion, even when the evidence is a single huge line.
export async function readEvidence(args){
 if(typeof args.file!=='string'||!path.isAbsolute(args.file))throw new Error('read-evidence requires an absolute --file');
 if(/conversation-history|conversation-[^/\\]*\.jsonl/i.test(args.file))throw new Error('Use the packet/checkpoint; conversation-history recovery is not supported');
 const offset=Number(args.offset??0),limit=Number(args.limit??4000);
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>4000)throw new Error('Use nonnegative --offset and --limit 1..4000');
 const handle=await fs.open(args.file,'r');let text;
 try{
  if((await handle.stat()).size>16*1024*1024)throw new Error('Evidence exceeds 16 MiB; use a script-produced compact checkpoint');
  text=await handle.readFile('utf8');
 }finally{await handle.close();}
 if(args.pointer!==undefined){
  if(typeof args.pointer!=='string'||!args.pointer.startsWith('/'))throw new Error('--pointer must be a JSON pointer such as /packets/0');
  let value=JSON.parse(text);
  for(const token of args.pointer.slice(1).split('/')){
   const key=token.replace(/~1/g,'/').replace(/~0/g,'~');
   if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('JSON pointer not found');
   value=value[key];
  }
  text=JSON.stringify(value);
 }
 return {status:'ok',offset,totalCharacters:text.length,text:text.slice(offset,offset+limit),nextOffset:offset+limit<text.length?offset+limit:null};
}
