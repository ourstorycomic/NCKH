const messagesEl = document.getElementById('messages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
let isSending = false;

function appendMessage(text, who='bot'){
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'user' ? 'user' : 'bot');
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendLoading(){
  const d = document.createElement('div');
  d.className = 'msg bot';
  d.id = 'loadingDot';
  d.innerHTML = 'Đang xử lý <span class="loading-dot"></span>';
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeLoading(){ const el = document.getElementById('loadingDot'); if(el) el.remove(); }

async function sendPrompt(prompt){
  if (!prompt) return;
  appendMessage(prompt, 'user');
  chatInput.value = '';
  appendLoading(); isSending = true; sendBtn.disabled = true;

  try{
    let imgEl = document.querySelector('#plotArea img');
    let imgData = null;
    if (imgEl && imgEl.src) {
      imgData = imgEl.src;
    }

    const payload = {
      prompt,
      image: imgData,
      selected_col: selectedCol,
      plot_type: lastSelectedType
    };

    const res = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if (!res.ok){
      const t = await res.text();
      throw new Error('HTTP ' + res.status + ' - ' + t);
    }
    const j = await res.json();
    removeLoading(); isSending = false; sendBtn.disabled = false;
    if (j.error){
      if (j.constructed){
        appendMessage("OpenAI not configured. Constructed prompt (for debug):\n\n" + (j.constructed.user || JSON.stringify(j.constructed)), 'bot');
      } else {
        appendMessage('Lỗi: ' + j.error, 'bot');
      }
      return;
    }
    const reply = j.reply || JSON.stringify(j);
    appendMessage(reply, 'bot');

    if (j.image_url){
      renderImages([j.image_url]);
    }
  }catch(err){ removeLoading(); isSending = false; sendBtn.disabled = false; appendMessage('Lỗi khi gọi API: ' + (err.message || err)); }
}

sendBtn.addEventListener('click', ()=>{ const v = chatInput.value.trim(); if(!v || isSending) return; sendPrompt(v); });
chatInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendBtn.click(); } });

const TYPES = [
  { key: 'count',  label: 'Số lượng' },
  { key: 'percent', label: 'Phần trăm' },
  { key: 'hist',   label: 'Biểu đồ' },
  { key: 'grouped', label: 'Biểu đồ ghép' }
];

let columns = [];
let selectedCol = null;
let lastSelectedType = null;
let lastSecondCol = null;

async function fetchCols(){ try{ const res = await fetch('/api/columns'); const j = await res.json(); if (j.error){ console.error('Lỗi lấy cột:', j.error); columns = []; return; } columns = j.columns || []; const datalist = document.getElementById('colsList'); datalist.innerHTML = ''; columns.forEach(c=>{ const op = document.createElement('option'); op.value = c; datalist.appendChild(op); }); }catch(err){ console.error('Lỗi lấy cột:', err); columns = []; } }

function renderTypeButtons(){ const wrap = document.getElementById('typeList'); wrap.innerHTML = ''; TYPES.forEach(t=>{ const b = document.createElement('button'); b.className = 'type-btn'; b.dataset.type = t.key; b.textContent = t.label; b.addEventListener('click', ()=>onTypeClick(t.key, b)); wrap.appendChild(b); }); }

function setSelectedColumn(name){ selectedCol = name || null; const badge = document.getElementById('selectedColBadge'); badge.textContent = selectedCol ? selectedCol : 'Chưa chọn cột'; }

document.getElementById('selectBtn').addEventListener('click', async ()=>{ const v = document.getElementById('colInput').value.trim(); if (!v){ alert('Vui lòng nhập hoặc chọn tên cột.'); return; } if (!columns.includes(v)){ if (!confirm('Cột không nằm trong danh sách — tiếp tục?')) return; } setSelectedColumn(v);
  if (lastSelectedType){ const btn = document.querySelector(`.type-btn[data-type="${lastSelectedType}"]`); if (btn){ await onTypeClick(lastSelectedType, btn, true); return; } } });

function showLoadingPlot(on){
  const area = document.getElementById('plotArea');
  if (getComputedStyle(area).position === 'static') {
    area.style.position = 'relative';
  }

  const existing = document.getElementById('plotSpinner');
  if (!on) {
    if (existing) existing.remove();
    return;
  }

  if (existing) return;

  const d = document.createElement('div');
  d.id = 'plotSpinner';
  d.style.position = 'absolute';
  d.style.left = '50%';
  d.style.top = '50%';
  d.style.transform = 'translate(-50%, -50%)';
  d.style.zIndex = '999';
  d.style.display = 'flex';
  d.style.flexDirection = 'column';
  d.style.alignItems = 'center';
  d.style.justifyContent = 'center';
  d.style.pointerEvents = 'none'; // allow clicks pass through if needed
  d.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--muted)">Đang vẽ...</div>'
              + '<div style="width:36px;height:36px;border-radius:50%;border:4px solid rgba(0,0,0,0.06);border-top-color:var(--accent);animation:spin 1s linear infinite"></div>';
  area.appendChild(d);
}

function renderImages(imgs){ const area = document.getElementById('plotArea'); area.innerHTML = ''; if (!imgs || imgs.length === 0){ area.innerHTML = '<div style="color:var(--muted)">Không có hình trả về</div>'; return; } imgs.forEach(src=>{ if (typeof src === 'string' && !src.startsWith('data:image') && !src.startsWith('http')) { src = 'data:image/png;base64,' + src; } const img = document.createElement('img'); img.src = src; img.alt = 'plot'; area.appendChild(img); }); const input = document.getElementById('colInput'); input.value = ''; input.focus(); }

async function onTypeClick(type, btn, calledBySelect=false){
  document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  lastSelectedType = type;
  if (!selectedCol){
    const v = document.getElementById('colInput').value.trim();
    if (!v){
      if (!calledBySelect) alert('Chưa chọn cột ở trên.');
      return;
    }
    setSelectedColumn(v);
  }

  let payload = { plots: [ { col: selectedCol, type: type } ] };
  if (type === 'grouped'){
    let second = lastSecondCol;
    if (!second){
      second = prompt('Nhập tên cột thứ 2 để nhóm theo (ví dụ: Giới tính):');
      if (!second){ alert('Grouped cần cột thứ 2. Hủy.'); return; }
      lastSecondCol = second;
    }
    payload = { plots: [ { col: selectedCol, type: type, second_col: lastSecondCol } ] };
  } else {
    lastSecondCol = null;
  }

  showLoadingPlot(true);
  try{
    const resp = await fetch('/api/plot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!resp.ok){ const txt = await resp.text(); throw new Error('HTTP ' + resp.status + ' - ' + txt); }
    const j = await resp.json();
    if (j.error){
      const area = document.getElementById('plotArea');
      area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">' + (j.error||'Lỗi') + '</div>';
      showLoadingPlot(false);
      return;
    }
    renderImages(j.images || []);

    try {
      const autoCheckbox = document.getElementById('autoAnalyze');
      const autoOn = autoCheckbox ? autoCheckbox.checked : false;
      if (autoOn) {
        const col = selectedCol || document.getElementById('colInput').value.trim() || 'chưa chọn cột';
        const ptype = lastSelectedType || type || 'unknown';
        const autoPrompt = `Hãy phân tích biểu đồ vừa tạo cho cột "${col}" (loại: ${ptype}). Nêu 3 ý chính, 1 gợi ý cải thiện hiển thị, và các quan sát số liệu quan trọng. Viết bằng tiếng Việt.`;
        setTimeout(()=>{ sendPrompt(autoPrompt); }, 300);
      }
    } catch(eAuto) {
      console.error('Auto-analyze error:', eAuto);
    }

    showLoadingPlot(false);
  }catch(err){
    const area = document.getElementById('plotArea');
    area.innerHTML = '<div style="color:#b00020;padding:16px;text-align:center">Lỗi khi gọi API: ' + (err && err.message ? err.message : err) + '</div>';
    showLoadingPlot(false);
  }
}

(async ()=>{ await fetchCols(); renderTypeButtons(); })();