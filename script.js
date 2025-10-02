/* -------------------------
   Utility & Chat functions
   ------------------------- */
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function mdSimpleToHtml(text) {
  if (text == null) return "";
  let s = escapeHtml(String(text));
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s>])_(.+?)_([\s.!?,;:]|$)/g, "$1<em>$2</em>$3");
  s = s.replace(/\r?\n/g, "<br>");
  return s;
}
function $id(id) { return document.getElementById(id); }

const messagesEl = $id('messages');
const chatInput = $id('chatInput');
const sendBtn = $id('sendBtn');
const suggestionsEl = $id('suggestions');

let isSending = false;
let lastLoadingRowId = null;
let datasetId = null;
let columns = [];
let selectedCol = null;
let lastSelectedType = null;

function setControlsDisabled(disabled) {
  try {
    const controls = [ sendBtn, chatInput, $id('selectBtn'), $id('colInput'), $id('uploadBtn') ];
    controls.forEach(c => { if (c) c.disabled = !!disabled; });
    document.querySelectorAll('.type-btn').forEach(b => { b.disabled = !!disabled; });
    document.querySelectorAll('.suggest-btn').forEach(b => { b.disabled = !!disabled; });
    if (disabled) document.body.classList.add('processing-ai');
    else document.body.classList.remove('processing-ai');
  } catch (e) { console.warn("setControlsDisabled error:", e); }
}

function _makeMessageRowElement(textHtml, who='bot', providedId=null){
  const row = document.createElement('div');
  row.className = 'message-row ' + (who === 'user' ? 'user' : 'bot');
  if (providedId) row.dataset.loadingId = providedId;
  const av = document.createElement('div'); av.className='avatar ' + (who === 'user' ? 'me' : 'ai');
  const bubble = document.createElement('div'); bubble.className=(who === 'user' ? 'bubble user' : 'bubble bot');
  bubble.innerHTML = textHtml;
  if (who === 'bot'){ row.appendChild(av); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(av); }
  return row;
}
function appendMessage(text, who='bot'){
  const html = mdSimpleToHtml(text);
  const row = _makeMessageRowElement(html, who);
  if (messagesEl) { messagesEl.appendChild(row); requestAnimationFrame(()=> { messagesEl.scrollTop = messagesEl.scrollHeight; }); }
}
function appendLoadingMessage() {
  const id = 'loading-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
  const html = 'Đang xử lý <span class="loading-dot"></span>';
  const row = _makeMessageRowElement(html, 'bot', id);
  const bubble = row.querySelector('.bubble');
  if (bubble) bubble.id = 'loading-bubble-' + id;
  if (messagesEl) { messagesEl.appendChild(row); messagesEl.scrollTop = messagesEl.scrollHeight; }
  lastLoadingRowId = id; return id;
}
function replaceLoadingWithReply(loadingId, replyText, isError=false){
  if (!loadingId) { appendMessage(replyText, 'bot'); return; }
  const row = Array.from(document.querySelectorAll('.message-row')).find(r => r.dataset.loadingId === loadingId);
  const html = mdSimpleToHtml(replyText);
  if (row){ const bubble = row.querySelector('.bubble'); if (bubble){ bubble.innerHTML = html; if (isError){ bubble.innerHTML = `<strong>Lỗi:</strong> ${html}`; } } delete row.dataset.loadingId; } else { appendMessage(replyText, 'bot'); }
  lastLoadingRowId = null;
}

async function sendPrompt(prompt){
  if (!prompt) return;
  openChatPopup();
  appendMessage(prompt, 'user');
  const loadingId = appendLoadingMessage();
  setControlsDisabled(true);
  isSending = true; if (sendBtn) sendBtn.disabled = true;
  try{
    let imgEl = document.querySelector('#plotArea img');
    let imgData = null; if (imgEl && imgEl.src) imgData = imgEl.src;
    const payload = { prompt, image: imgData, selected_col: selectedCol, plot_type: lastSelectedType, dataset_id: datasetId };
    const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!res.ok){ const t = await res.text(); replaceLoadingWithReply(loadingId, 'HTTP ' + res.status + ' - ' + t, true); return; }
    const j = await res.json();
    if (j.error){ if (j.constructed){ const constructed = j.constructed.user || JSON.stringify(j.constructed); replaceLoadingWithReply(loadingId, "OpenAI not configured. Constructed prompt (for debug):\n\n" + constructed, true); } else { replaceLoadingWithReply(loadingId, 'Lỗi: ' + j.error, true); } return; }
    const reply = j.reply || JSON.stringify(j);
    replaceLoadingWithReply(loadingId, reply, false);
    if (j.image_url){ renderImages([j.image_url]); }
  }catch(err){ replaceLoadingWithReply(loadingId, 'Lỗi khi gọi API: ' + (err.message || err), true); }
  finally{ isSending = false; setControlsDisabled(false); if (sendBtn) sendBtn.disabled = false; }
}

if (sendBtn) { sendBtn.addEventListener('click', ()=>{ const v = chatInput ? chatInput.value.trim() : ''; if(!v || isSending) return; if (chatInput) chatInput.value = ''; sendPrompt(v); if (chatInput) chatInput.focus(); }); }
if (chatInput) { chatInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); const v = chatInput.value.trim(); if (v && !isSending) { chatInput.value = ''; sendPrompt(v); chatInput.focus(); } } }); }

/* -------------------------
   Columns dropdown / upload
   ------------------------- */
const inputEl = $id('colInput');
const dropdownEl = $id('colsDropdown');
let dropdownItems = []; let activeIndex = -1;

function renderDropdownList(list){
  if (!dropdownEl) return;
  dropdownEl.innerHTML = '';
  dropdownItems = [];
  if (!list || list.length === 0){
    const empty = document.createElement('div');
    empty.className = 'cols-empty';
    empty.textContent = 'Không có kết quả';
    dropdownEl.appendChild(empty);
    return;
  }
  list.forEach((val) => {
    const item = document.createElement('div');
    item.className = 'col-option';
    item.role = 'option';
    item.tabIndex = -1;
    item.dataset.value = val;
    item.textContent = val;
    item.addEventListener('click', (e)=> {
      e.stopPropagation();
      selectDropdownValue(val);
    });
    dropdownEl.appendChild(item);
    dropdownItems.push(item);
  });
}

function openDropdown(){
  if (!dropdownEl) return;
  if (dropdownEl.hidden) {
    dropdownEl.hidden = false;
    inputEl && inputEl.setAttribute('aria-expanded','true');
  }
}
function closeDropdown(){
  if (!dropdownEl) return;
  if (!dropdownEl.hidden) {
    dropdownEl.hidden = true;
    inputEl && inputEl.setAttribute('aria-expanded','false');
    clearActive();
  }
}
function clearActive(){ activeIndex = -1; dropdownItems.forEach(it => it.removeAttribute('aria-selected')); }
function setActive(i){
  if (dropdownItems.length === 0) return;
  if (i < 0) i = 0;
  if (i >= dropdownItems.length) i = dropdownItems.length - 1;
  clearActive();
  activeIndex = i;
  const el = dropdownItems[activeIndex];
  el.setAttribute('aria-selected','true');
  el.scrollIntoView({ block: 'nearest' });
}
function selectDropdownValue(val){
  if (inputEl) inputEl.value = val;
  setSelectedColumn(val);
  closeDropdown();
  inputEl && inputEl.focus();
}
function filterAndShow(q){
  const term = (q||'').trim().toLowerCase();
  const filtered = columns.filter(c => c.toLowerCase().includes(term));
  renderDropdownList(filtered);
  openDropdown();
}

if (inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    if (!dropdownEl || dropdownEl.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(activeIndex - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        const v = dropdownItems[activeIndex].dataset.value;
        selectDropdownValue(v);
      } else {
        const v = inputEl.value.trim();
        if (v) setSelectedColumn(v);
        closeDropdown();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeDropdown(); return; }
  });

  inputEl.addEventListener('focus', (e) => { filterAndShow(inputEl.value || ''); });
  inputEl.addEventListener('input', (e) => { filterAndShow(inputEl.value || ''); });
}

document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.input-wrap');
  if (!wrap) return;
  if (!wrap.contains(e.target)) closeDropdown();
});

async function fetchCols(forDatasetId = null){
  try{
    const url = '/api/columns' + (forDatasetId ? '?dataset_id=' + encodeURIComponent(forDatasetId) : '');
    const res = await fetch(url);
    const j = await res.json();
    if (j.error){ console.error('Lỗi lấy cột:', j.error); columns = []; renderDropdownList([]); renderGroupedSelector(); return; }
    columns = j.columns || [];
    renderDropdownList(columns);
    renderGroupedSelector();
  }catch(err){ console.error('Lỗi lấy cột:', err); columns = []; renderDropdownList([]); renderGroupedSelector(); }
}

function renderTypeButtons(){ const wrap = $id('typeList'); if (!wrap) return; wrap.innerHTML = ''; const TYPES = [ { key: 'count', label: 'Số lượng' }, { key: 'percent', label: 'Phần trăm' }, { key: 'hist', label: 'Biểu đồ' }, { key: 'grouped', label: 'Biểu đồ ghép' } ]; TYPES.forEach(t=>{ const b = document.createElement('button'); b.className = 'type-btn'; b.dataset.type = t.key; b.textContent = t.label; b.addEventListener('click', ()=>onTypeClick(t.key, b)); wrap.appendChild(b); }); }

function setSelectedColumn(name){ selectedCol = name || null; const up = $id('uploadedInfo'); if (up) up.title = selectedCol ? `Cột đã chọn: ${selectedCol}` : ''; }

const datasetFileEl = $id('datasetFile');
const uploadBtn = $id('uploadBtn');
const uploadedInfo = $id('uploadedInfo');

if (uploadBtn) uploadBtn.addEventListener('click', ()=> datasetFileEl && datasetFileEl.click());

if (datasetFileEl) {
  datasetFileEl.addEventListener('change', async (e) => {
    const f = datasetFileEl.files && datasetFileEl.files[0];
    if (!f) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    try{
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok){ const txt = await res.text(); throw new Error('HTTP ' + res.status + ' - ' + txt); }
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      // If dataset uploaded, it returns dataset_id and columns
      if (j.dataset_id){
        datasetId = j.dataset_id;
        if (uploadedInfo) uploadedInfo.textContent = j.original_filename || ('Uploaded: ' + datasetId);
        columns = j.columns || [];
        renderDropdownList(columns);
        renderGroupedSelector();
        inputEl && inputEl.focus();
        setSelectedColumn(null);
      } else if (j.status && j.status === 'ok'){
        // docx or mapping uploaded
        if (uploadedInfo) uploadedInfo.textContent = j.filename || 'Uploaded mapping';
        // refetch columns from default dataset (if any)
        await fetchCols(datasetId);
        alert(j.message || 'Uploaded mapping file.');
      } else {
        // generic success
        if (uploadedInfo) uploadedInfo.textContent = j.original_filename || j.filename || 'Uploaded';
        columns = j.columns || columns;
        renderDropdownList(columns);
        renderGroupedSelector();
      }
    }catch(err){
      alert('Upload lỗi: ' + (err && err.message ? err.message : err));
      console.error('Upload error', err);
    }finally{
      if (uploadBtn) uploadBtn.disabled = false;
      if (uploadBtn) uploadBtn.textContent = 'Upload file';
      if (datasetFileEl) datasetFileEl.value = '';
    }
  });
}

const selectBtn = $id('selectBtn');
if (selectBtn) selectBtn.addEventListener('click', async ()=>{ const v = ($id('colInput') && $id('colInput').value) ? $id('colInput').value.trim() : ''; if (!v){ alert('Vui lòng nhập hoặc chọn tên cột.'); return; } if (columns.length && !columns.includes(v)){ if (!confirm('Cột không nằm trong danh sách — tiếp tục?')) return; } setSelectedColumn(v); if (lastSelectedType){ const btn = document.querySelector(`.type-btn[data-type="${lastSelectedType}"]`); if (btn){ await onTypeClick(lastSelectedType, btn, true); return; } } });

function showLoadingPlot(on){ const area = $id('plotArea'); if (!area) return; if (getComputedStyle(area).position === 'static') { area.style.position = 'relative'; } const existing = $id('plotSpinner'); if (!on) { if (existing) existing.remove(); return; } if (existing) return; const d = document.createElement('div'); d.id = 'plotSpinner'; d.style.position = 'absolute'; d.style.left = '50%'; d.style.top = '50%'; d.style.transform = 'translate(-50%, -50%)'; d.style.zIndex = '999'; d.style.display = 'flex'; d.style.flexDirection = 'column'; d.style.alignItems = 'center'; d.style.justifyContent = 'center'; d.style.pointerEvents = 'none'; d.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--muted)">Đang vẽ...</div>' + '<div style="width:36px;height:36px;border-radius:50%;border:4px solid rgba(0,0,0,0.06);border-top-color:var(--accent);animation:spin 1s linear infinite"></div>'; area.appendChild(d); }

function renderImages(imgs){ const area = $id('plotArea'); if (!area) return; area.innerHTML = ''; if (!imgs || imgs.length === 0){ area.innerHTML = '<div style="color:var(--muted)">Không có hình trả về</div>'; hideSuggestions(); return; } imgs.forEach(src=>{ if (typeof src === 'string' && !src.startsWith('data:image') && !src.startsWith('http')) { src = 'data:image/png;base64,' + src; } const img = document.createElement('img'); img.src = src; img.alt = 'plot'; area.appendChild(img); }); const input = $id('colInput'); if (input) { input.value = ''; input.focus(); } if (selectedCol) showSuggestions(); else hideSuggestions(); }

function renderSuggestionsButtons(){ if (!suggestionsEl) return; suggestionsEl.innerHTML = ''; const items = [ { id: 'sol', label: 'tạo giải pháp', cls:'', prompt: (col,type)=> `**Yêu cầu**: Dựa trên biểu đồ cột \"${col}\" (loại: ${type}), hãy đưa ra *3 giải pháp* cụ thể để cải thiện kết quả/hiển thị. Mỗi giải pháp kèm 1 bước thực hiện ngắn.` }, { id: 'crit', label: 'tiêu chí đồ thị', cls:'', prompt: (col,type)=> `Liệt kê *3 tiêu chí* để đánh giá trực quan cho biểu đồ của cột \"${col}\" (loại: ${type}). Mỗi tiêu chí kèm 1 gợi ý cải thiện.` }, { id: 'more', label: 'gợi ý khác', cls:'', prompt: (col,type)=> `Đề xuất *3 cách* phân tích sâu hơn cho biểu đồ cột \"${col}\" (loại: ${type}) — ví dụ phân nhóm, kiểm định thống kê, hay biểu đồ thay thế.` } ]; items.forEach(it=>{ const b = document.createElement('button'); b.className = 'suggest-btn' + (it.cls? ' ' + it.cls : ''); b.textContent = it.label; b.type = 'button'; b.addEventListener('click', ()=>{ if (isSending) { alert('Hệ thống đang xử lý yêu cầu trước. Vui lòng chờ.'); return; } const col = selectedCol || ($id('colInput') && $id('colInput').value.trim()) || 'chưa chọn cột'; const ptype = lastSelectedType || 'unknown'; const p = it.prompt(col, ptype); if (chatInput) chatInput.value = ''; sendPrompt(p); b.disabled = true; setTimeout(()=> { b.disabled = false; }, 1200); }); suggestionsEl.appendChild(b); }); }
function showSuggestions(){ if (!suggestionsEl) return; suggestionsEl.style.display = 'flex'; suggestionsEl.setAttribute('aria-hidden','false'); renderSuggestionsButtons(); }
function hideSuggestions(){ if (!suggestionsEl) return; suggestionsEl.style.display = 'none'; suggestionsEl.setAttribute('aria-hidden','true'); }

/* -------------------------
   Grouped selector UI
   ------------------------- */
function renderGroupedSelector(){ const list = $id('groupedColsList'); if (!list) return; list.innerHTML = ''; if (!columns || columns.length === 0){ list.textContent = 'Không có cột'; return; } columns.forEach((c)=>{ const id = 'gcol-' + c.replace(/[^a-z0-9]/gi, '_'); const label = document.createElement('label'); label.htmlFor = id; const chk = document.createElement('input'); chk.type = 'checkbox'; chk.id = id; chk.dataset.col = c; chk.value = c; if (selectedCol && selectedCol === c) chk.checked = true; const span = document.createElement('span'); span.textContent = c; label.appendChild(chk); label.appendChild(span); list.appendChild(label); }); }
function openGroupedSelector(){ const back = $id('groupedModalBackdrop'); if (!back) return; back.style.display = 'flex'; back.setAttribute('aria-hidden','false'); }
function closeGroupedSelector(){ const back = $id('groupedModalBackdrop'); if (!back) return; back.style.display = 'none'; back.setAttribute('aria-hidden','true'); }
function groupedSelectAll(){ const list = $id('groupedColsList'); if (!list) return; list.querySelectorAll('input[type=checkbox]').forEach(i => i.checked = true); }
function groupedClearAll(){ const list = $id('groupedColsList'); if (!list) return; list.querySelectorAll('input[type=checkbox]').forEach(i => i.checked = false); }

async function applyGroupedSelection(){ if (isSending) { alert('Hệ thống đang xử lý. Vui lòng chờ.'); return; } const includeSelected = !!$id('groupedIncludeSelected') && $id('groupedIncludeSelected').checked; const list = $id('groupedColsList'); if (!list) return; const checked = Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value); let cols = checked.slice(); if (includeSelected && selectedCol){ if (!cols.includes(selectedCol)) cols.unshift(selectedCol); } cols = cols.map(s => s.trim()).filter(Boolean).filter((v,i,a)=> a.indexOf(v) === i); if (cols.length === 0){ alert('Vui lòng chọn ít nhất một cột.'); return; } closeGroupedSelector(); lastSelectedType = 'grouped'; const showValuesFlag = !!($id('showValues') && $id('showValues').checked); const payload = { plots: [ { cols: cols, type: 'grouped', show_values: showValuesFlag } ], dataset_id: datasetId }; showLoadingPlot(true); try{ const resp = await fetch('/api/plot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); if (!resp.ok){ const txt = await resp.text(); throw new Error('HTTP ' + resp.status + ' - ' + txt); } const j = await resp.json(); if (j.error){ const area = $id('plotArea'); if (area) area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">' + (j.error||'Lỗi') + '</div>'; showLoadingPlot(false); hideSuggestions(); return; } renderImages(j.images || []); try { const autoCheckbox = $id('autoAnalyze'); const autoOn = autoCheckbox ? autoCheckbox.checked : false; if (autoOn) { const col = cols.join(', '); const ptype = 'grouped'; const autoPrompt = `Hãy phân tích biểu đồ vừa tạo cho các cột "${col}" (loại: ${ptype}). Nêu 3 ý chính, 1 gợi ý cải thiện hiển thị, và các quan sát số liệu quan trọng. Viết bằng tiếng Việt.`; setTimeout(()=>{ sendPrompt(autoPrompt); }, 300); } } catch(eAuto) { console.error('Auto-analyze error:', eAuto); } showLoadingPlot(false); }catch(err){ const area = $id('plotArea'); if (area) area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">Lỗi khi gọi API: ' + (err && err.message ? err.message : err) + '</div>'; showLoadingPlot(false); hideSuggestions(); } }

async function onTypeClick(type, btn, calledBySelect=false){
  if (isSending) {
    alert('Hệ thống đang xử lý. Vui lòng chờ hoàn tất trước khi tạo biểu đồ mới.');
    return;
  }
  document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  lastSelectedType = type;
  if (!selectedCol){
    const v = ($id('colInput') && $id('colInput').value) ? $id('colInput').value.trim() : '';
    if (!v){
      if (!calledBySelect) alert('Chưa chọn cột ở trên.');
      return;
    }
    setSelectedColumn(v);
  }
  if (type === 'grouped'){
    renderGroupedSelector();
    openGroupedSelector();
    return;
  }
  const showValuesFlag = !!($id('showValues') && $id('showValues').checked);
  let payload = { plots: [ { col: selectedCol, type: type, show_values: showValuesFlag } ], dataset_id: datasetId };
  showLoadingPlot(true);
  try{
    const resp = await fetch('/api/plot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!resp.ok){ const txt = await resp.text(); throw new Error('HTTP ' + resp.status + ' - ' + txt); }
    const j = await resp.json();
    if (j.error){ const area = $id('plotArea'); if (area) area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">' + (j.error||'Lỗi') + '</div>'; showLoadingPlot(false); hideSuggestions(); return; }
    renderImages(j.images || []);
    try {
      const autoCheckbox = $id('autoAnalyze');
      const autoOn = autoCheckbox ? autoCheckbox.checked : false;
      if (autoOn) {
        const col = selectedCol || ($id('colInput') && $id('colInput').value.trim()) || 'chưa chọn cột';
        const ptype = lastSelectedType || type || 'unknown';
        const autoPrompt = `Hãy phân tích biểu đồ vừa tạo cho cột "${col}" (loại: ${ptype}). Nêu 3 ý chính, 1 gợi ý cải thiện hiển thị, và các quan sát số liệu quan trọng. Viết bằng tiếng Việt.`;
        setTimeout(()=>{ sendPrompt(autoPrompt); }, 300);
      }
    } catch(eAuto) { console.error('Auto-analyze error:', eAuto); }
    showLoadingPlot(false);
  }catch(err){ const area = $id('plotArea'); if (area) area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">Lỗi khi gọi API: ' + (err && err.message ? err.message : err) + '</div>'; showLoadingPlot(false); hideSuggestions(); }
}

// grouped modal controls wiring
const groupedApplyBtn = $id('groupedApplyBtn');
const groupedCancelBtn = $id('groupedCancelBtn');
const groupedBackdrop = $id('groupedModalBackdrop');
const groupedSelectAllBtn = $id('groupedSelectAllBtn');
const groupedClearBtn = $id('groupedClearBtn');
if (groupedApplyBtn) groupedApplyBtn.addEventListener('click', applyGroupedSelection);
if (groupedCancelBtn) groupedCancelBtn.addEventListener('click', closeGroupedSelector);
if (groupedBackdrop) groupedBackdrop.addEventListener('click', (e)=>{ if (e.target === groupedBackdrop) closeGroupedSelector(); });
if (groupedSelectAllBtn) groupedSelectAllBtn.addEventListener('click', groupedSelectAll);
if (groupedClearBtn) groupedClearBtn.addEventListener('click', groupedClearAll);

const aiFabBtn = $id('aiFab');
const chatOverlay = $id('chatOverlay');
const closePopupBtn = $id('closePopup');
let popupOpen = false;
const ANIM_DUR = 240;
function openChatPopup(){ if (!chatOverlay) return; if (chatOverlay.hidden){ chatOverlay.hidden=false; chatOverlay.setAttribute('aria-hidden','false'); requestAnimationFrame(()=>{ chatOverlay.classList.add('open'); popupOpen=true; setTimeout(()=>{ const input = $id('chatInput'); if (input) input.focus(); },90); }); } }
function closeChatPopup(){ if (!chatOverlay || chatOverlay.hidden) return; chatOverlay.classList.remove('open'); popupOpen=false; setTimeout(()=>{ try{ chatOverlay.hidden=true; chatOverlay.setAttribute('aria-hidden','true'); }catch(e){} }, ANIM_DUR+20); }
function toggleChatPopup(){ if (!chatOverlay) return; if (chatOverlay.hidden) openChatPopup(); else closeChatPopup(); }
if (aiFabBtn) aiFabBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleChatPopup(); });
if (chatOverlay) chatOverlay.addEventListener('click', (e)=>{ if (e.target === chatOverlay) closeChatPopup(); });
if (closePopupBtn) closePopupBtn.addEventListener('click', (e)=>{ e.stopPropagation(); closeChatPopup(); });
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){
  const gb = $id('groupedModalBackdrop'); if (gb && gb.style.display === 'flex') { closeGroupedSelector(); return; }
  if (chatOverlay && !chatOverlay.hidden) closeChatPopup(); } });

(async ()=>{ await fetchCols(); renderTypeButtons(); hideSuggestions(); })();
