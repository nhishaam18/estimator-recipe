// Only reject visibility established by saved evidence. Missing styles/rectangles
// do not prove invisibility; unsampled elements remain explicit evidence gaps.
export function hiddenInSavedDom(node, {styleNodes = new Map(), rectNodes = new Map(), styles = {}} = {}) {
    if (rectNodes.get(node)?.paintedVisible === false) return true;
    let visibility;
    for (let p=node;p?.type==='tag';p=p.parent) {
        const inline=Object.fromEntries(String(p.attribs?.style??'').split(';').map(s=>{const i=s.indexOf(':');return i<0?[]:[s.slice(0,i).trim().toLowerCase(),s.slice(i+1).trim().replace(/\s*!important\s*$/i,'')];}).filter(p=>p.length===2));
        const saved=styles[styleNodes.get(p)?.styleId]??{};
        const s={...inline,...saved};
        if(p.attribs?.hidden!==undefined||s.display==='none'||Number.parseFloat(s.opacity)===0||s['content-visibility']==='hidden')return true;
        if(visibility===undefined&&s.visibility!==undefined)visibility=s.visibility;
    }
    return ['hidden','collapse'].includes(visibility);
}
