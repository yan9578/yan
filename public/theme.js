export const preferenceKey = 'cc-preview-display';

export function applyTheme(theme) {
  document.documentElement.dataset.theme=theme==='dark'?'dark':'light';
}

function syncTheme() {
  try {
    applyTheme(JSON.parse(localStorage.getItem(preferenceKey)||'{}')?.theme);
  } catch {
    applyTheme('light');
  }
}

syncTheme();
window.addEventListener('storage',event=>{
  if(event.key===preferenceKey||event.key===null)syncTheme();
});
