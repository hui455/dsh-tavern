(() => {
  if (window.__localVoiceToolbar) return;
  window.__localVoiceToolbar = true;
  let cfg = { voice: '胡桃_ZH', voices: [{ id: '胡桃_ZH', name: '胡桃' }], maxChars: 500, toolbar: true, allowed: false };
  let selected = '', requestId = null, count = 0, state = 'idle';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;max-width:calc(100vw - 16px)';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;color-scheme:light dark;--voice-accent:#6556d9;--voice-bg:#fff;--voice-ink:#20243a;--voice-border:#e7e5f1;--voice-soft:#f3f1fb;--voice-muted:#827d98;--voice-error:#b42335}
      *{box-sizing:border-box}
      section{font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--voice-ink);background:var(--voice-bg);border:1px solid var(--voice-border);border-radius:12px;box-shadow:0 8px 24px #24203524,0 2px 5px #24203508;padding:4px;max-width:min(300px,calc(100vw - 16px))}
      nav{display:flex;align-items:center;gap:4px}
      button{font:inherit;border:0;border-radius:9px;height:36px;width:36px;min-width:36px;padding:0;background:var(--voice-accent);color:#fff;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;transition:filter .15s,transform .15s;flex:none}
      button:hover{filter:brightness(1.08)}button:active{transform:scale(.97)}button:disabled{opacity:.45;cursor:not-allowed;transform:none}
      button:focus-visible,select:focus-visible{outline:2px solid var(--voice-accent);outline-offset:3px}
      .play-icon{display:flex;width:14px;height:14px;align-items:center;justify-content:center;flex:none}
      .play-icon svg{width:14px;height:14px;fill:currentColor}
      button[data-state=checking] .play-icon,button[data-state=generating] .play-icon{border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
      button[data-state=checking] svg,button[data-state=generating] svg{display:none}
      .voice{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;flex:none;border-radius:9px;color:var(--voice-accent)}.voice:hover{background:var(--voice-soft)}.voice:focus-within{outline:2px solid var(--voice-accent);outline-offset:2px}
      select{appearance:none;font:inherit;line-height:1.5;color:var(--voice-ink);background:transparent;border:0;border-radius:10px;position:absolute;inset:0;opacity:0;height:36px;width:36px;padding:0;text-overflow:ellipsis;cursor:pointer}
      select:hover{background:var(--voice-soft)}option{background:var(--voice-bg);color:var(--voice-ink)}
      .voice-icon{width:18px;height:18px;pointer-events:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
      .message{margin:8px 6px 4px;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}
      .message.error{color:var(--voice-error)}
      .message:not(.visible){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){button{transition:none}button .play-icon{animation:none!important}}
      @media(prefers-color-scheme:dark){:host{--voice-bg:#242330;--voice-ink:#f0eef8;--voice-border:#403c54;--voice-soft:#353147;--voice-muted:#b2aacb;--voice-error:#ffacb6;--voice-accent:#7867e6}}
    </style>
    <section aria-label="本地角色朗读">
      <nav aria-label="朗读操作">
        <button id="play" type="button" aria-label="朗读选中文字"><span class="play-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2.5 13 8 4 13.5Z"/></svg></span></button>
        <label class="voice"><select aria-label="朗读角色"></select><svg class="voice-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 7a5 5 0 0 1 0 8M20 4a9 9 0 0 1 0 14"/></svg></label>
      </nav>
      <p class="message" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>`;
  const $ = s => shadow.querySelector(s), voice = $('select'), status = $('.message'), play = $('#play');
  function setStatus(message = '', nextState = 'idle', visible = false) {
    state = nextState;
    status.textContent = message;
    status.className = 'message' + (visible ? ' visible' : '') + (state === 'error' ? ' error' : '');
    play.dataset.state = state;
    play.title = `${count} / ${cfg.maxChars} 字 · 点击按顺序朗读` + (message ? '\n' + message : '');
  }
  function validateSelection() {
    count = [...selected].length;
    play.disabled = !count || count > cfg.maxChars;
    if (count > cfg.maxChars) setStatus(`${count} / ${cfg.maxChars} 字，超过上限，请缩短选区。`, 'error', true);
    else setStatus(`${count} / ${cfg.maxChars} 字`);
  }
  function fill() {
    const previous = voice.value;
    voice.replaceChildren(...cfg.voices.map(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; return o; }));
    voice.value = cfg.voices.some(v => v.id === previous) ? previous : cfg.voice;
    voice.title = '声音：' + (voice.selectedOptions[0]?.textContent || '未选择') + '（点击切换）';
  }
  fill();
  function refreshSettings(){cfg.allowed=false;host.style.display='none';return chrome.runtime.sendMessage({type:'public-settings'}).then(r=>{cfg={...cfg,...r};fill();validateSelection();if(cfg.allowed)show();}).catch(()=>{cfg.allowed=false;});}
  void refreshSettings();
  voice.addEventListener('change', () => { voice.title = '声音：' + (voice.selectedOptions[0]?.textContent || '未选择') + '（点击切换）'; });
  function show() {
    if (!cfg.toolbar || !cfg.allowed) return;
    const active = document.activeElement;
    if (active === host) return;
    if (active?.tagName === 'INPUT' && ['password', 'email'].includes(active.type)) return;
    const selection = window.getSelection();
    const input = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' && ['text', 'search', 'url', 'tel'].includes(active.type));
    const inputText = input && Number.isInteger(active.selectionStart) && active.selectionStart !== active.selectionEnd ? active.value.slice(active.selectionStart, active.selectionEnd) : '';
    if (!inputText && (!selection?.rangeCount || selection.isCollapsed)) return;
    const text = (inputText || selection.toString()).trim();
    if (!text) return;
    if (text !== selected) { selected = text; requestId = null; validateSelection(); }
    if (!host.isConnected) document.documentElement.append(host);
    host.style.display = 'block';
    const rect = inputText ? active.getBoundingClientRect() : selection.getRangeAt(0).getBoundingClientRect();
    host.style.left = Math.max(8, Math.min(rect.left, innerWidth - host.offsetWidth - 8)) + 'px';
    const below = rect.bottom + 8;
    host.style.top = Math.max(8, below + host.offsetHeight <= innerHeight - 8 ? below : rect.top - host.offsetHeight - 8) + 'px';
  }
  let showTimer;
  function schedule(e) { if (e?.composedPath().includes(host)) return; clearTimeout(showTimer); showTimer = setTimeout(show, 30); }
  document.addEventListener('mouseup', schedule, true);
  document.addEventListener('pointerup', schedule, true);
  document.addEventListener('selectionchange', () => schedule(), true);
  document.addEventListener('keyup', e => { if (e.key === 'Shift') show(); if (e.key === 'Escape') host.style.display = 'none'; });
  document.addEventListener('mousedown', e => { if (!e.composedPath().includes(host)) host.style.display = 'none'; });
  play.onclick = async () => {
    if (play.disabled || !cfg.allowed) return;
    const id = crypto.randomUUID(); requestId = id;
    setStatus('准备朗读…', 'checking');
    try {
      const r = await chrome.runtime.sendMessage({ type: 'speak', text: selected, voice: voice.value, requestId: id });
      if (requestId === id && !r?.ok) setStatus(r?.error || '无法连接扩展', 'error', true);
    } catch { if (requestId === id) setStatus('扩展已更新，请刷新网页。', 'error', true); }
  };
  chrome.runtime.onMessage.addListener(m => {
    if(m.type==='settings-changed'){void refreshSettings();return;}
    if(!cfg.allowed)return;
    if (m.type === 'voice-start') { requestId = m.requestId; setStatus('准备朗读…', 'checking'); return; }
    if (m.type !== 'audio-status' || !requestId || m.requestId !== requestId) return;
    const fuzzy = m.cacheHit && m.score < 1;
    setStatus(m.message + (fuzzy ? '\n实际朗读：' + m.actualText : '') + (m.warning ? '\n' + m.warning : ''), m.state, m.state === 'error' || fuzzy || !!m.warning);
  });
})();
