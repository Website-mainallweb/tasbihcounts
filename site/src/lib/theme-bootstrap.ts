/** Inlined in the document head so the theme never flashes (section 112). */
export const THEME_BOOTSTRAP = `(function(){try{
var s=localStorage.getItem('tc.settings');
var t=s?JSON.parse(s).theme:'system';
if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t);
var bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
var m=document.querySelector('meta[name="theme-color"]');
if(m&&bg)m.setAttribute('content',bg);
}catch(e){}})();`;
