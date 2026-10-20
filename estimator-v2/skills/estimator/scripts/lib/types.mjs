export const VIEWPORT_SIZES={desktop:{width:1440,height:900}};
export const ALL_VIEWPORTS=['desktop'];
export function compareViewport(viewports){if(JSON.stringify(viewports)!=='["desktop"]')throw new Error('Estimator 2.0.0 supports desktop only');return 'desktop';}
export const hasShot=state=>state?.shot!==false;
