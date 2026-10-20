/** One URL per line: punctuation belongs to the URL, not a CSV separator. */
export function parseUrlList(text){
 const urls=[],invalid=[],seen=new Set();
 for(const line of String(text).split(/\r?\n/)){
  const raw=line.trim();if(!raw||raw.startsWith('#'))continue;
  try{
   if(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)&&!/^https?:\/\//i.test(raw))throw new Error('Unsupported scheme');
   const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);
   if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid URL');
   if([...u.searchParams.keys()].some(k=>/^(?:token|access_token|api_?key|secret|password|signature|x-amz-credential|x-amz-signature)$/i.test(k)))throw new Error('Credential-bearing URL');
   if(!seen.has(u.href)){seen.add(u.href);urls.push(u.href);}
  }catch{invalid.push('Invalid or credential-bearing input line');}
 }
 return {urls,invalid};
}
