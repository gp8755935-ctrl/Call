// ============================================================
// HELPERS
// ============================================================

function avatarHTML(usuario, classe = '', onclick = null) {
  if (!usuario) return '';
  const cls = 'avatar ' + classe;
  const attr = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : '';

  if (usuario.avatar) {
    return `<div class="${cls} com-imagem"${attr}><img src="${usuario.avatar}" alt=""></div>`;
  }

  const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
  const cores = ['#0284c7', '#0891b2', '#16a34a', '#7c3aed', '#db2777', '#ea580c'];
  const cor = cores[(usuario.nome || '').charCodeAt(0) % cores.length];
  const estiloExtra = onclick ? '; cursor:pointer' : '';
  return `<div class="${cls}"${attr} style="background: linear-gradient(180deg, ${cor}99, ${cor})${estiloExtra}">${inicial}</div>`;
}

const EMOJIS = {
  'Carinhas': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
  'Gestos': ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','👃','🧠','🦷','👀','👁️','👅','👄'],
  'Corações': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋'],
  'Objetos': ['🔥','✨','⭐','🌟','💫','💥','💢','💤','💨','🕳️','💣','💬','🗨️','🗯️','💭','🎉','🎊','🎈','🎁','🎂','🍕','🍔','🍟','🍿','☕','🍺','🍻','🥂','🍷','🍸','🍹','🍾','🎮','🎯','🎲','🎰','🎸','🎺','🎻','🥁','🎤','🎧','🎬','📷','📸','📹','📺','📻'],
  'Símbolos': ['✅','❌','❗','❓','⚠️','🚫','💯','🔞','📛','♻️','🆗','🆕','🆒','🆓','🔝','🔙','🔚','🔛','🔜','🔎','🔍','➕','➖','➗','✖️','💲','💱','©️','®️','™️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻'],
};

const EMOJIS_RAPIDOS = ['👍','❤️','😂','😮','😢','🔥','🎉','👏'];

let socket = null;
let meuUsuario = null;
let onlineIds = new Set();

let servidores = [];
let servidorAtivo = null;
let canalAtivo = null;
let conversaAtual = null;
let timeoutBusca = null;
let naoLidasTotal = 0;
let tituloOriginal = 'Void — Conecte-se';

let telaAtual = 'home';
let replyAtual = { canal: null, dm: null };
let pickerReacaoEstado = { msgId: null, contexto: null };
let notificacoesAbertas = new Set();
let digitandoTimeout = { canal: null, dm: null };
let ultimoEnvioDigitando = { canal: 0, dm: 0 };
let timeoutAlguemDigitando = { canal: null, dm: null };
let anexoContexto = null;
let anexoTipo = null;
let longPressTimer = null;
let menuContextoAberto = null;
let painelMembrosAberto = false;
let perfilVisitadoAtual = null;

const CONFIG_PADRAO = { somMsg: true, somReacao: true, notifVisual: true, notifSistema: true, digitando: true };
let config = { ...CONFIG_PADRAO };

function carregarConfig() {
  try {
    const salvo = localStorage.getItem('void-config');
    if (salvo) config = { ...CONFIG_PADRAO, ...JSON.parse(salvo) };
  } catch (e) { config = { ...CONFIG_PADRAO }; }
  aplicarConfigNaUI();
}

function salvarConfig() {
  try { localStorage.setItem('void-config', JSON.stringify(config)); } catch (e) {}
}

function aplicarConfigNaUI() {
  const ids = { somMsg: 'cfg-som-msg', somReacao: 'cfg-som-reacao', notifVisual: 'cfg-notif-visual', notifSistema: 'cfg-notif-sistema', digitando: 'cfg-digitando' };
  for (const [chave, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!config[chave];
  }
}

function abrirConfig() {
  aplicarConfigNaUI();
  document.getElementById('modal-config').classList.add('ativo');
}

function fecharConfig() {
  document.getElementById('modal-config').classList.remove('ativo');
}

function bindConfig() {
  const ids = { somMsg: 'cfg-som-msg', somReacao: 'cfg-som-reacao', notifVisual: 'cfg-notif-visual', notifSistema: 'cfg-notif-sistema', digitando: 'cfg-digitando' };
  for (const [chave, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      config[chave] = el.checked;
      salvarConfig();
      if (chave === 'notifSistema' && el.checked) pedirPermissaoNotificacoes();
    });
  }
}

// ============================================================
// NOTIFICAÇÕES DO SISTEMA
// ============================================================

async function pedirPermissaoNotificacoes() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) {}
  }
}

function mostrarNotificacaoSistema(titulo, corpo, icone) {
  if (!config.notifSistema) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification(titulo, { body: corpo, icon: icone || undefined, tag: 'void-msg', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 5000);
  } catch (e) {}
}

// ============================================================
// NOTIFICAÇÕES VISUAIS
// ============================================================

let idNotifCounter = 0;

function mostrarNotificacaoVisual({
  tipo, deNome, deAvatar, deId, ondeTexto, texto, aoClicar,
  acoes = null, silencioso = false,
}) {
  if (!config.notifVisual) return;
  if (!silencioso) tocarSomNotificacao();

  const stack = document.getElementById('notif-stack');
  if (!stack) return;

  const id = 'notif-' + (++idNotifCounter);
  notificacoesAbertas.add(id);

  const el = document.createElement('div');
  el.className = 'notif entrando ' + (tipo === 'dm' ? 'dm' : (tipo === 'amizade' ? 'amizade' : 'canal'));
  el.id = id;

  const avatarInner = deAvatar
    ? `<img src="${deAvatar}" alt="">`
    : (deNome || '?').charAt(0).toUpperCase();

  const temAcoes = Array.isArray(acoes) && acoes.length > 0;

  el.innerHTML = `
    <div class="notif-avatar">${avatarInner}</div>
    <div class="notif-corpo">
      <div class="notif-titulo">${escapeHtml(deNome || 'Alguém')}</div>
      <div class="notif-onde">${escapeHtml(ondeTexto || '')}</div>
      <div class="notif-texto">${escapeHtml(texto || '')}</div>
      ${temAcoes ? `<div class="notif-acoes">${acoes.map((a, i) => `<button class="${a.classe || ''}" data-acao-idx="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>
    <button class="notif-close" title="Fechar">✕</button>
  `;

  let arrastando = false;
  let startX = 0, startY = 0;
  let moveu = false;

  const iniciar = (x, y) => { arrastando = true; startX = x; startY = y; moveu = false; el.style.transition = 'none'; };
  const mover = (x, y) => {
    if (!arrastando) return;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moveu = true;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 15) return;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = Math.max(0.2, 1 - Math.abs(dx) / 200);
  };
  const terminar = () => {
    if (!arrastando) return;
    arrastando = false;
    el.style.transition = '';
    const match = (el.style.transform || '').match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
    const dx = match ? parseFloat(match[1]) : 0;
    if (Math.abs(dx) > 80) fecharNotif();
    else { el.style.transform = 'translateX(0)'; el.style.opacity = '1'; }
  };

  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.notif-close') || e.target.closest('.notif-acoes button')) return;
    iniciar(e.clientX, e.clientY);
  });
  el.addEventListener('mousemove', (e) => mover(e.clientX, e.clientY));
  el.addEventListener('mouseup', terminar);
  el.addEventListener('mouseleave', terminar);

  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.notif-close') || e.target.closest('.notif-acoes button')) return;
    if (e.touches.length === 1) iniciar(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) mover(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchend', terminar);

  el.addEventListener('click', (e) => {
    if (e.target.closest('.notif-close') || e.target.closest('.notif-acoes button')) return;
    if (moveu) return;
    if (typeof aoClicar === 'function') aoClicar();
    fecharNotif();
  });

  if (temAcoes) {
    el.querySelectorAll('.notif-acoes button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-acao-idx'));
        const acao = acoes[idx];
        if (acao && typeof acao.onClick === 'function') {
          try { acao.onClick(); } catch (err) {}
        }
        fecharNotif();
      });
    });
  }

  el.querySelector('.notif-close').addEventListener('click', (e) => { e.stopPropagation(); fecharNotif(); });

  const fecharNotif = () => {
    el.classList.add('fechando');
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(() => { el.remove(); notificacoesAbertas.delete(id); }, 220);
  };

  stack.appendChild(el);
  setTimeout(() => { if (document.body.contains(el)) fecharNotif(); }, temAcoes ? 8000 : 5000);
}

// ============================================================
// SONS
// ============================================================

const audioCtx = window.AudioContext ? new AudioContext() : null;

function tocarSom() {
  if (!config.somReacao) return;
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
}

function tocarSomNotificacao() {
  if (!config.somMsg) return;
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(); osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) {}
}

// ============================================================
// ANEXOS — helpers
// ============================================================

function formatarBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function iconeArquivo(nome, tipo) {
  const ext = (nome || '').split('.').pop().toLowerCase();
  if (tipo && tipo.startsWith('image/')) return '🖼️';
  if (tipo && tipo.startsWith('audio/')) return '🎵';
  if (tipo === 'application/pdf') return '📕';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['mp3','wav','ogg','m4a','aac','flac','opus'].includes(ext)) return '🎵';
  if (['mp4','webm','mov','avi'].includes(ext)) return '🎬';
  if (['doc','docx','odt'].includes(ext)) return '📄';
  if (['xls','xlsx','ods','csv'].includes(ext)) return '📊';
  if (['ppt','pptx','odp'].includes(ext)) return '📽️';
  if (['txt','md','json','js','html','css'].includes(ext)) return '📃';
  return '📎';
}

function ehArquivoDeAudio(anexo) {
  if (!anexo) return false;
  if ((anexo.mime || '').startsWith('audio/')) return true;
  const ext = (anexo.nome || '').split('.').pop().toLowerCase();
  return ['mp3','wav','ogg','m4a','aac','flac','opus','weba'].includes(ext);
}

function abrirModalImagem(src) {
  const modal = document.getElementById('modal-imagem');
  const img = document.getElementById('imagem-grande');
  if (!modal || !img) return;
  img.src = src;
  modal.classList.add('ativo');
}

function fecharImagem() {
  const modal = document.getElementById('modal-imagem');
  if (modal) modal.classList.remove('ativo');
}

// ============================================================
// MENU CONTEXTUAL
// ============================================================

function abrirMenuContexto(event, opcoes) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const menu = document.getElementById('menu-contexto');
  if (!menu) return;

  menu.innerHTML = '';
  if (opcoes.titulo) {
    const t = document.createElement('div');
    t.className = 'menu-titulo';
    t.textContent = opcoes.titulo;
    menu.appendChild(t);
  }
  opcoes.acoes.forEach((acao) => {
    const btn = document.createElement('button');
    if (acao.perigo) btn.className = 'perigo';
    btn.innerHTML = `<span class="menu-emoji">${acao.emoji || ''}</span><span>${escapeHtml(acao.label)}</span>`;
    btn.onclick = () => {
      fecharMenuContexto();
      if (typeof acao.onClick === 'function') acao.onClick();
    };
    menu.appendChild(btn);
  });

  menu.classList.add('ativo');

  const x = event?.clientX || event?.touches?.[0]?.clientX || 100;
  const y = event?.clientY || event?.touches?.[0]?.clientY || 100;

  requestAnimationFrame(() => {
    const mRect = menu.getBoundingClientRect();
    const mW = mRect.width || 220;
    const mH = mRect.height || 200;
    let top = y;
    let left = x;
    if (left + mW > window.innerWidth - 10) left = window.innerWidth - mW - 10;
    if (left < 10) left = 10;
    if (top + mH > window.innerHeight - 10) top = y - mH;
    if (top < 10) top = 10;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  });

  menuContextoAberto = menu;
}

function fecharMenuContexto() {
  const menu = document.getElementById('menu-contexto');
  if (menu) menu.classList.remove('ativo');
  menuContextoAberto = null;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#menu-contexto')) return;
  fecharMenuContexto();
});

// ============================================================
// ANEXOS — menu popover
// ============================================================

function abrirMenuAnexo(event, btn, contexto) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const menu = document.getElementById('menu-anexo');
  if (!menu || !btn) return;
  if (menu.classList.contains('ativo') && anexoContexto === contexto) { fecharMenuAnexo(); return; }
  anexoContexto = contexto;
  menu.classList.add('ativo');

  requestAnimationFrame(() => {
    const rect = btn.getBoundingClientRect();
    const mRect = menu.getBoundingClientRect();
    const mW = mRect.width || 240;
    const mH = mRect.height || 320;
    let top = rect.top - mH - 8;
    let left = rect.left;
    if (left + mW > window.innerWidth - 10) left = window.innerWidth - mW - 10;
    if (left < 10) left = 10;
    if (top < 10) top = rect.bottom + 8;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  });
}

function fecharMenuAnexo() {
  const menu = document.getElementById('menu-anexo');
  if (menu) menu.classList.remove('ativo');
}

function escolherTipoAnexo(tipo) {
  anexoTipo = tipo;
  fecharMenuAnexo();
  const input = document.getElementById('input-anexo');
  if (!input) return;
  input.value = '';
  input.accept = tipo === 'foto' ? 'image/*' : tipo === 'video' ? 'video/*' : '';
  input.click();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#menu-anexo')) return;
  if (e.target.closest('.anexo-btn')) return;
  fecharMenuAnexo();
});

document.addEventListener('scroll', (e) => {
  if (e.target && e.target.closest && e.target.closest('.chat-area')) fecharMenuAnexo();
}, true);

// ============================================================
// ANEXOS — upload
// ============================================================

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'input-anexo') return;
  const file = e.target.files[0];
  if (!file) return;
  const contexto = anexoContexto;
  const tipo = anexoTipo;
  anexoContexto = null;
  anexoTipo = null;
  if (!contexto || !tipo) return;
  await enviarComUpload(file, tipo, contexto);
});

function criarBarraUpload(nomeArquivo) {
  const el = document.createElement('div');
  el.className = 'upload-barra';
  el.innerHTML = `
    <div class="upload-label">
      <span>📤 ${escapeHtml(nomeArquivo)}</span>
      <span class="upload-pct">0%</span>
    </div>
    <div class="upload-track"><div class="upload-fill"></div></div>
  `;
  return el;
}

function enviarComUpload(file, tipo, contexto) {
  return new Promise((resolve) => {
    const chatId = contexto === 'canal' ? 'chat-canal' : 'chat-dm';
    const chatEl = document.getElementById(chatId);
    const barra = criarBarraUpload(file.name);
    if (chatEl) { chatEl.appendChild(barra); chatEl.scrollTop = chatEl.scrollHeight; }

    const fill = barra.querySelector('.upload-fill');
    const pct = barra.querySelector('.upload-pct');

    const formData = new FormData();
    formData.append('arquivo', file);
    formData.append('tipo', tipo);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const p = Math.round((ev.loaded / ev.total) * 100);
        fill.style.width = p + '%';
        pct.textContent = p + '%';
      }
    };
    xhr.onload = async () => {
      if (xhr.status !== 200) {
        let msg = 'Erro no upload';
        try { const data = JSON.parse(xhr.responseText); if (data.erro) msg = data.erro; } catch (e2) {}
        barra.classList.add('erro');
        pct.textContent = '❌ ' + msg;
        setTimeout(() => barra.remove(), 4000);
        resolve(null); return;
      }
      let anexo;
      try { const data = JSON.parse(xhr.responseText); anexo = data.anexo; }
      catch (e2) {
        barra.classList.add('erro');
        pct.textContent = '❌ Resposta inválida';
        setTimeout(() => barra.remove(), 4000);
        resolve(null); return;
      }
      barra.remove();
      await enviarMensagemComAnexo(contexto, anexo);
      resolve(anexo);
    };
    xhr.onerror = () => {
      barra.classList.add('erro');
      pct.textContent = '❌ Erro de conexão';
      setTimeout(() => barra.remove(), 4000);
      resolve(null);
    };
    xhr.send(formData);
  });
}

async function enviarMensagemComAnexo(contexto, anexo) {
  const inputId = contexto === 'canal' ? 'input-canal' : 'input-dm';
  const input = document.getElementById(inputId);
  const texto = (input && input.value.trim()) || '';
  if (input) input.value = '';

  if (contexto === 'canal') {
    if (!canalAtivo) return;
    const r = await fetch(`/api/canais/${canalAtivo.id}/mensagens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, anexo }),
    });
    if (!r.ok) { alert('Erro ao enviar anexo'); return; }
    const el = document.getElementById('chat-canal');
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 100);
  } else if (contexto === 'dm') {
    if (!conversaAtual) return;
    const r = await fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, anexo }),
    });
    const data = await r.json();
    if (!r.ok) { alert(data.erro || 'Erro'); return; }
    adicionarMsgDM(data.mensagem);
  }
}

// ============================================================
// ANEXOS — render
// ============================================================

function renderAnexoHTML(anexo) {
  if (!anexo) return '';
  try {
    const a = typeof anexo === 'string' ? JSON.parse(anexo) : anexo;
    if (!a || !a.url) return '';

    if (a.tipo === 'foto') {
      return `<div class="msg-anexo">
        <img class="msg-anexo-imagem" src="${a.url}" alt="${escapeHtml(a.nome || 'foto')}">
      </div>`;
    }

    if (a.tipo === 'video') {
      const idUnico = 'video-' + Math.random().toString(36).slice(2, 10);
      return `<div class="msg-anexo">
        <div class="media-player-video-wrap">
          <video class="media-video-elemento" src="${a.url}" preload="metadata"></video>
          <div class="media-player" data-media-id="${idUnico}" data-media-tipo="video">
            <button class="media-play" type="button" title="Play/Pause">
              <span class="media-play-icone">▶</span>
            </button>
            <div class="media-progresso-wrap">
              <div class="media-progresso-track">
                <div class="media-progresso-fill"></div>
                <div class="media-progresso-bolinha"></div>
              </div>
            </div>
            <span class="media-tempo">0:00 / 0:00</span>
            <button class="media-volume-btn" type="button" title="Volume">
              <span class="media-volume-icone">🔊</span>
            </button>
            <div class="media-volume-wrap">
              <div class="media-volume-track"><div class="media-volume-fill"></div></div>
            </div>
            <button class="media-fullscreen-btn" type="button" title="Tela cheia">⛶</button>
          </div>
        </div>
        <a class="msg-anexo-media-download" href="${a.url}" download="${escapeHtml(a.nome || 'video')}">
          <span class="media-dl-icone">📥</span>
          <span class="media-dl-nome">${escapeHtml(a.nome || 'video')}</span>
          <span class="media-dl-tam">(${formatarBytes(a.tamanho || 0)})</span>
        </a>
      </div>`;
    }

    if (a.tipo === 'arquivo' && ehArquivoDeAudio(a)) {
      const idUnico = 'audio-' + Math.random().toString(36).slice(2, 10);
      return `<div class="msg-anexo">
        <div class="media-player" data-media-id="${idUnico}" data-media-tipo="audio">
          <button class="media-play" type="button" title="Play/Pause">
            <span class="media-play-icone">▶</span>
          </button>
          <div class="media-progresso-wrap">
            <div class="media-progresso-track">
              <div class="media-progresso-fill"></div>
              <div class="media-progresso-bolinha"></div>
            </div>
          </div>
          <span class="media-tempo">0:00 / 0:00</span>
          <button class="media-volume-btn" type="button" title="Volume">
            <span class="media-volume-icone">🔊</span>
          </button>
          <div class="media-volume-wrap">
            <div class="media-volume-track"><div class="media-volume-fill"></div></div>
          </div>
          <audio class="media-audio-elemento" src="${a.url}" preload="metadata"></audio>
        </div>
        <a class="msg-anexo-media-download" href="${a.url}" download="${escapeHtml(a.nome || 'audio')}">
          <span class="media-dl-icone">📥</span>
          <span class="media-dl-nome">${escapeHtml(a.nome || 'audio')}</span>
          <span class="media-dl-tam">(${formatarBytes(a.tamanho || 0)})</span>
        </a>
      </div>`;
    }

    if (a.tipo === 'arquivo') {
      return `<div class="msg-anexo">
        <a class="msg-anexo-arquivo" href="${a.url}" download="${escapeHtml(a.nome || 'arquivo')}">
          <span class="arquivo-icone">${iconeArquivo(a.nome, a.mime)}</span>
          <span class="arquivo-info">
            <span class="arquivo-nome">${escapeHtml(a.nome || 'arquivo')}</span>
            <span class="arquivo-tam">${formatarBytes(a.tamanho || 0)}</span>
          </span>
        </a>
      </div>`;
    }
  } catch (e) { return ''; }
  return '';
}

// ============================================================
// MEDIA PLAYER
// ============================================================

let mediaAtual = null;

function inicializarMediaPlayers(container) {
  if (!container) return;

  container.querySelectorAll('.media-player').forEach((player) => {
    if (player.dataset.inicializado === '1') return;
    player.dataset.inicializado = '1';

    const tipo = player.dataset.mediaTipo || 'audio';
    const mediaEl = tipo === 'video'
      ? player.parentElement.querySelector('.media-video-elemento')
      : player.querySelector('.media-audio-elemento');
    if (!mediaEl) return;

    const btnPlay = player.querySelector('.media-play');
    const iconePlay = player.querySelector('.media-play-icone');
    const track = player.querySelector('.media-progresso-track');
    const fill = player.querySelector('.media-progresso-fill');
    const bolinha = player.querySelector('.media-progresso-bolinha');
    const tempoEl = player.querySelector('.media-tempo');
    const btnVolume = player.querySelector('.media-volume-btn');
    const iconeVolume = player.querySelector('.media-volume-icone');
    const volTrack = player.querySelector('.media-volume-track');
    const volFill = player.querySelector('.media-volume-fill');
    const btnFullscreen = player.querySelector('.media-fullscreen-btn');

    const volumeSalvo = parseFloat(localStorage.getItem('void-media-volume') || '1');
    mediaEl.volume = isNaN(volumeSalvo) ? 1 : Math.max(0, Math.min(1, volumeSalvo));
    atualizarVisualVolume();

    const formatarTempo = (s) => {
      if (!isFinite(s) || s < 0) return '0:00';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const seg = Math.floor(s % 60);
      if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${seg.toString().padStart(2, '0')}`;
      return `${m}:${seg.toString().padStart(2, '0')}`;
    };

    const atualizarProgresso = () => {
      if (!mediaEl.duration || !isFinite(mediaEl.duration)) {
        tempoEl.textContent = '0:00 / 0:00';
        return;
      }
      const pct = (mediaEl.currentTime / mediaEl.duration) * 100;
      fill.style.width = pct + '%';
      bolinha.style.left = pct + '%';
      tempoEl.textContent = `${formatarTempo(mediaEl.currentTime)} / ${formatarTempo(mediaEl.duration)}`;
    };

    btnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaEl.paused) {
        if (mediaAtual && mediaAtual !== mediaEl) mediaAtual.pause();
        mediaEl.play().catch(() => {});
        mediaAtual = mediaEl;
      } else {
        mediaEl.pause();
      }
    });

    mediaEl.addEventListener('play', () => {
      iconePlay.textContent = '⏸';
      player.classList.add('tocando');
      document.querySelectorAll('audio, video').forEach((outro) => {
        if (outro !== mediaEl && !outro.paused && !outro.dataset.naoPausar) outro.pause();
      });
      mediaAtual = mediaEl;
    });

    mediaEl.addEventListener('pause', () => {
      iconePlay.textContent = '▶';
      player.classList.remove('tocando');
    });

    mediaEl.addEventListener('ended', () => {
      iconePlay.textContent = '▶';
      player.classList.remove('tocando');
      mediaEl.currentTime = 0;
      atualizarProgresso();
    });

    mediaEl.addEventListener('timeupdate', atualizarProgresso);
    mediaEl.addEventListener('loadedmetadata', atualizarProgresso);
    mediaEl.addEventListener('durationchange', atualizarProgresso);

    let arrastandoProgresso = false;

    const calcularPct = (clientX) => {
      const rect = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const aplicarProgresso = (clientX) => {
      if (!mediaEl.duration || !isFinite(mediaEl.duration)) return;
      const pct = calcularPct(clientX);
      mediaEl.currentTime = pct * mediaEl.duration;
      fill.style.width = (pct * 100) + '%';
      bolinha.style.left = (pct * 100) + '%';
    };

    track.addEventListener('mousedown', (e) => { e.preventDefault(); arrastandoProgresso = true; aplicarProgresso(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (arrastandoProgresso) aplicarProgresso(e.clientX); });
    window.addEventListener('mouseup', () => { arrastandoProgresso = false; });

    track.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) { arrastandoProgresso = true; aplicarProgresso(e.touches[0].clientX); }
    }, { passive: true });
    track.addEventListener('touchmove', (e) => {
      if (arrastandoProgresso && e.touches.length === 1) aplicarProgresso(e.touches[0].clientX);
    }, { passive: true });
    track.addEventListener('touchend', () => { arrastandoProgresso = false; });

    function atualizarVisualVolume() {
      const v = mediaEl.volume;
      volFill.style.width = (v * 100) + '%';
      if (v === 0) iconeVolume.textContent = '🔇';
      else if (v < 0.4) iconeVolume.textContent = '🔈';
      else if (v < 0.8) iconeVolume.textContent = '🔉';
      else iconeVolume.textContent = '🔊';
    }

    btnVolume.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaEl.volume > 0) {
        mediaEl.dataset.volumeAnterior = String(mediaEl.volume);
        mediaEl.volume = 0;
      } else {
        mediaEl.volume = parseFloat(mediaEl.dataset.volumeAnterior || '1');
      }
      localStorage.setItem('void-media-volume', String(mediaEl.volume));
      atualizarVisualVolume();
    });

    let arrastandoVolume = false;

    const calcVolPct = (clientX) => {
      const rect = volTrack.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const aplicarVolume = (clientX) => {
      const v = calcVolPct(clientX);
      mediaEl.volume = v;
      localStorage.setItem('void-media-volume', String(v));
      atualizarVisualVolume();
    };

    volTrack.addEventListener('mousedown', (e) => { e.preventDefault(); arrastandoVolume = true; aplicarVolume(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (arrastandoVolume) aplicarVolume(e.clientX); });
    window.addEventListener('mouseup', () => { arrastandoVolume = false; });

    volTrack.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) { arrastandoVolume = true; aplicarVolume(e.touches[0].clientX); }
    }, { passive: true });
    volTrack.addEventListener('touchmove', (e) => {
      if (arrastandoVolume && e.touches.length === 1) aplicarVolume(e.touches[0].clientX);
    }, { passive: true });
    volTrack.addEventListener('touchend', () => { arrastandoVolume = false; });

    if (btnFullscreen && tipo === 'video') {
      btnFullscreen.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mediaEl.requestFullscreen) mediaEl.requestFullscreen().catch(() => {});
        else if (mediaEl.webkitEnterFullscreen) mediaEl.webkitEnterFullscreen();
      });
    }
  });
}

document.addEventListener('click', (e) => {
  const img = e.target.closest('.msg-anexo-imagem');
  if (!img) return;
  if (img.src) abrirModalImagem(img.src);
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-imagem') fecharImagem();
});

// ============================================================
// AUTH
// ============================================================

function mudarAbaAuth(qual) {
  document.getElementById('aba-login').classList.toggle('ativa', qual === 'login');
  document.getElementById('aba-cadastro').classList.toggle('ativa', qual === 'cadastro');
  document.getElementById('form-login').style.display = qual === 'login' ? 'block' : 'none';
  document.getElementById('form-cadastro').style.display = qual === 'cadastro' ? 'block' : 'none';
  document.getElementById('login-erro').textContent = '';
  document.getElementById('cad-erro').textContent = '';
}

async function fazerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.textContent = '';
  if (!email || !senha) { erroEl.textContent = 'Preencha tudo'; return; }
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
    entrarNoApp(data.usuario);
  } catch (e) { erroEl.textContent = 'Erro de conexão'; }
}

async function fazerCadastro() {
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim();
  const senha = document.getElementById('cad-senha').value;
  const erroEl = document.getElementById('cad-erro');
  erroEl.textContent = '';
  if (!nome || !email || !senha) { erroEl.textContent = 'Preencha tudo'; return; }
  try {
    const r = await fetch('/api/cadastro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
    entrarNoApp(data.usuario);
  } catch (e) { erroEl.textContent = 'Erro de conexão'; }
}

async function fazerLogout() {
  if (!confirm('Sair?')) return;
  try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
  try { localStorage.setItem('void-logout', Date.now()); } catch (e) {}
  if (socket) { socket.disconnect(); socket = null; }
  location.reload();
}

function entrarNoApp(usuario) {
  if (!usuario || !usuario.id) {
    document.getElementById('tela-auth').style.display = 'flex';
    document.getElementById('app').classList.remove('ativo');
    return;
  }
  meuUsuario = usuario;
  document.getElementById('tela-auth').style.display = 'none';
  document.getElementById('app').classList.add('ativo');
  atualizarAvataresNaUI();
  conectarSocket();
  carregarServidores();
  carregarAmizades();
  pedirPermissaoNotificacoes();
}

// ============================================================
// SOCKET
// ============================================================

function estouNoCanal(canalId) {
  return telaAtual === 'canal' && canalAtivo && canalAtivo.id === canalId && !document.hidden;
}

function estouNaConversa(conversaId) {
  return telaAtual === 'conversa' && conversaAtual && conversaAtual.conversa_id === conversaId && !document.hidden;
}

function conectarSocket() {
  if (socket) return;

  socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 10000,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('Conectado como', meuUsuario.nome, '— socket', socket.id);
    if (servidorAtivo) socket.emit('entrar-servidores');
    if (canalAtivo) socket.emit('entrar-canal', { canalId: canalAtivo.id });
  });

  socket.on('disconnect', (motivo) => {
    console.log('Desconectado:', motivo);
  });

  socket.io.on('reconnect', (tentativa) => {
    console.log('Reconectado após', tentativa, 'tentativas');
  });

  socket.on('connect_error', (err) => {
    console.error('Erro de conexão socket:', err.message);
  });

  socket.on('lista-online', (users) => {
    onlineIds = new Set(users.map((u) => u.id));
    atualizarMembrosOnline();
    carregarAmizades();
  });

  // ============ AMIZADE ============
  socket.on('amizade-nova', (payload) => {
    const paraId = payload?.paraId;
    const pedido = payload?.pedido;
    if (!pedido || paraId !== meuUsuario?.id) return;

    mostrarNotificacaoVisual({
      tipo: 'amizade',
      deNome: pedido.nome,
      deAvatar: pedido.avatar,
      deId: pedido.id,
      ondeTexto: '👥 Pedido de amizade',
      texto: pedido.email || 'quer ser seu amigo',
      acoes: [
        { label: '✅ Aceitar', classe: 'btn-aceitar', onClick: async () => {
          await fetch('/api/amizades/aceitar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amizadeId: pedido.amizade_id }),
          });
          carregarAmizades();
        }},
        { label: '❌ Recusar', classe: 'btn-recusar', onClick: async () => {
          await fetch('/api/amizades/recusar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amizadeId: pedido.amizade_id }),
          });
          carregarAmizades();
        }},
      ],
      aoClicar: () => abrirAmigos(),
    });

    carregarAmizades();
  });

  socket.on('amizade-aceita', ({ por }) => {
    carregarAmizades();
    mostrarNotificacaoVisual({
      tipo: 'amizade',
      deNome: por.nome,
      deAvatar: por.avatar,
      deId: por.id,
      ondeTexto: '👥 Nova amizade',
      texto: `${por.nome} aceitou seu pedido!`,
      aoClicar: () => abrirAmigos(),
    });
  });

  // ============ PERFIL ============
  socket.on('perfil-atualizado', ({ usuario_id, avatar, banner, bio }) => {
    if (usuario_id === meuUsuario.id) {
      if (avatar !== undefined) meuUsuario.avatar = avatar;
      if (banner !== undefined) meuUsuario.banner = banner;
      if (bio !== undefined) meuUsuario.bio = bio;
      atualizarAvataresNaUI();
    }
    if (conversaAtual && conversaAtual.amigo.id === usuario_id) {
      if (avatar !== undefined) conversaAtual.amigo.avatar = avatar;
    }
    if (servidorAtivo) {
      fetch('/api/servidores/' + servidorAtivo.servidor.id).then(async (r) => {
        if (r.ok) { servidorAtivo = await r.json(); renderizarMembros(); }
      });
    }
    carregarConversas();
    carregarAmizades();
  });

  // ============ DM ============
  socket.on('dm-nova', ({ conversa_id, mensagem }) => {
    if (estaBloqueadoLocal(mensagem.de_id)) return;
    const silenciado = estaSilenciadoLocal('usuario', mensagem.de_id);

    if (estouNaConversa(conversa_id)) {
      adicionarMsgDM(mensagem);
      fetch(`/api/conversas/${conversa_id}/mensagens`);
      return;
    }

    naoLidasTotal++;
    atualizarTitulo();

    const nomeAmigo = mensagem.de_nome;
    const avatarAmigo = mensagem.de_avatar;
    const amigoId = mensagem.de_id;

    const temAnexo = !!mensagem.anexo;
    let previewTexto = mensagem.texto || '';
    if (!previewTexto && temAnexo) {
      const t = mensagem.anexo.tipo;
      previewTexto = t === 'foto' ? '📷 Foto' :
                     t === 'video' ? '🎬 Vídeo' :
                     ehArquivoDeAudio(mensagem.anexo) ? '🎵 Áudio' : '📎 Arquivo';
    }

    mostrarNotificacaoVisual({
      tipo: 'dm',
      deNome: nomeAmigo, deAvatar: avatarAmigo, deId: amigoId,
      ondeTexto: 'Mensagem direta',
      texto: previewTexto, silencioso: silenciado,
      aoClicar: async () => {
        const amigo = { id: amigoId, nome: nomeAmigo, avatar: avatarAmigo };
        await abrirConversa(amigo);
        setTimeout(() => { fetch(`/api/conversas/${conversa_id}/mensagens`); }, 100);
      },
    });

    if (!silenciado) mostrarNotificacaoSistema(`💬 ${nomeAmigo}`, previewTexto, avatarAmigo || undefined);
    carregarConversas();
  });

  socket.on('dm-editada', ({ conversa_id, mensagem }) => {
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      atualizarMsgNaTela('chat-dm', mensagem.id, mensagem.texto, true);
    }
  });

  socket.on('dm-deletada', ({ conversa_id, mensagem_id }) => {
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      removerMsgDaTela('chat-dm', mensagem_id);
    }
  });

  socket.on('dm-historico-limpo', ({ conversa_id }) => {
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      document.getElementById('chat-dm').innerHTML = '';
    }
  });

  // ============ CANAL ============
  socket.on('canal-nova-msg', ({ canal_id, mensagem }) => {
    let silenciado = estaSilenciadoLocal('usuario', mensagem.de_id);
    if (!silenciado && servidorAtivo) {
      const c = servidorAtivo.canais.find((x) => x.id === canal_id);
      if (c && estaSilenciadoLocal('servidor', c.servidor_id)) silenciado = true;
    }

    if (estouNoCanal(canal_id)) { adicionarMsgCanal(mensagem); return; }

    let nomeCanal = 'canal';
    if (servidorAtivo) {
      const c = servidorAtivo.canais.find((x) => x.id === canal_id);
      if (c) nomeCanal = '#' + c.nome;
    }

    const temAnexo = !!mensagem.anexo;
    let previewTexto = mensagem.texto || '';
    if (!previewTexto && temAnexo) {
      const t = mensagem.anexo.tipo;
      previewTexto = t === 'foto' ? '📷 Foto' :
                     t === 'video' ? '🎬 Vídeo' :
                     ehArquivoDeAudio(mensagem.anexo) ? '🎵 Áudio' : '📎 Arquivo';
    }

    mostrarNotificacaoVisual({
      tipo: 'canal',
      deNome: mensagem.de_nome, deAvatar: mensagem.de_avatar, deId: mensagem.de_id,
      ondeTexto: nomeCanal,
      texto: previewTexto, silencioso: silenciado,
      aoClicar: async () => {
        if (servidorAtivo) {
          const c = servidorAtivo.canais.find((x) => x.id === canal_id);
          if (c) await abrirCanal(c);
        }
      },
    });

    if (!silenciado) mostrarNotificacaoSistema(`💬 ${mensagem.de_nome} em ${nomeCanal}`, previewTexto, mensagem.de_avatar || undefined);
  });

  socket.on('canal-msg-editada', ({ canal_id, mensagem }) => {
    if (canalAtivo && canalAtivo.id === canal_id) {
      atualizarMsgNaTela('chat-canal', mensagem.id, mensagem.texto, true);
    }
  });

  socket.on('canal-msg-deletada', ({ canal_id, mensagem_id }) => {
    if (canalAtivo && canalAtivo.id === canal_id) removerMsgDaTela('chat-canal', mensagem_id);
  });

  socket.on('reacao-atualizada', ({ tipo, alvoId, reacoes }) => {
    const chatId = tipo === 'canal' ? 'chat-canal' : 'chat-dm';
    atualizarReacoesNaTela(chatId, alvoId, reacoes);
  });

  // ============ CANAL/SERVIDOR ============
  socket.on('canal-criado', ({ canal }) => {
    if (servidorAtivo && servidorAtivo.servidor.id === canal.servidor_id) {
      servidorAtivo.canais.push(canal);
      renderizarCanais();
    }
  });

  socket.on('canal-deletado', ({ canal_id }) => {
    if (servidorAtivo) {
      servidorAtivo.canais = servidorAtivo.canais.filter((c) => c.id !== canal_id);
      if (canalAtivo && canalAtivo.id === canal_id) {
        canalAtivo = servidorAtivo.canais[0] || null;
        if (canalAtivo && telaAtual === 'canal') abrirCanal(canalAtivo);
      }
      renderizarCanais();
    }
  });

  socket.on('servidor-atualizado', ({ servidor }) => {
    if (servidorAtivo && servidorAtivo.servidor.id === servidor.id) {
      servidorAtivo.servidor = servidor;
      document.getElementById('nome-servidor').textContent = servidor.nome;
    }
    const idx = servidores.findIndex((s) => s.id === servidor.id);
    if (idx >= 0) servidores[idx] = servidor;
    renderizarServidores();
  });

  socket.on('servidor-deletado', ({ servidor_id }) => {
    servidores = servidores.filter((s) => s.id !== servidor_id);
    if (servidorAtivo && servidorAtivo.servidor.id === servidor_id) {
      servidorAtivo = null;
      document.getElementById('sidebar-canais').style.display = 'none';
    }
    renderizarServidores();
  });

  socket.on('membro-entrou', ({ servidor_id, membro }) => {
    if (servidorAtivo && servidorAtivo.servidor.id === servidor_id) {
      if (!servidorAtivo.membros.some((m) => m.id === membro.id)) {
        servidorAtivo.membros.push(membro);
        servidorAtivo.membros.sort((a, b) => a.nome.localeCompare(b.nome));
        renderizarMembros();
      }
    }
  });

  socket.on('membro-removido', ({ servidor_id, usuario_id }) => {
    if (servidorAtivo && servidorAtivo.servidor.id === servidor_id) {
      servidorAtivo.membros = servidorAtivo.membros.filter((m) => m.id !== usuario_id);
      renderizarMembros();
    }
  });

  socket.on('voce-foi-removido', ({ servidor_id, servidor_nome }) => {
    servidores = servidores.filter((s) => s.id !== servidor_id);
    if (servidorAtivo && servidorAtivo.servidor.id === servidor_id) {
      servidorAtivo = null;
      document.getElementById('sidebar-canais').style.display = 'none';
    }
    renderizarServidores();
    mostrarNotificacaoVisual({
      tipo: 'amizade',
      deNome: 'Sistema',
      ondeTexto: '⚠️ Removido',
      texto: `Você foi removido de "${servidor_nome}"`,
      silencioso: false,
    });
  });

  // ============ DIGITANDO ============
  socket.on('alguem-digitando-canal', ({ canalId, nome, usuarioId }) => {
    if (!config.digitando) return;
    if (!estouNoCanal(canalId)) return;
    if (usuarioId === meuUsuario.id) return;
    mostrarDigitando('canal', nome);
  });

  socket.on('alguem-parou-digitando-canal', ({ canalId, usuarioId }) => {
    if (!canalAtivo || canalAtivo.id !== canalId) return;
    if (usuarioId === meuUsuario.id) return;
    esconderDigitando('canal');
  });

  socket.on('alguem-digitando-dm', ({ conversaId, nome, usuarioId }) => {
    if (!config.digitando) return;
    if (!estouNaConversa(conversaId)) return;
    if (usuarioId === meuUsuario.id) return;
    mostrarDigitando('dm', nome);
  });

  socket.on('alguem-parou-digitando-dm', ({ conversaId, usuarioId }) => {
    if (!conversaAtual || conversaAtual.conversa_id !== conversaId) return;
    if (usuarioId === meuUsuario.id) return;
    esconderDigitando('dm');
  });
}

// ============================================================
// BLOQUEIOS E SILENCIADOS (estado local)
// ============================================================

let bloqueadosLocal = new Set();
let silenciadosUsuarioLocal = new Set();
let silenciadosServidorLocal = new Set();

function estaBloqueadoLocal(id) { return bloqueadosLocal.has(id); }
function estaSilenciadoLocal(tipo, id) {
  if (tipo === 'usuario') return silenciadosUsuarioLocal.has(id);
  if (tipo === 'servidor') return silenciadosServidorLocal.has(id);
  return false;
}

async function carregarBloqueiosESilenciados() {
  try {
    const r1 = await fetch('/api/bloqueados');
    if (r1.ok) {
      const d1 = await r1.json();
      bloqueadosLocal = new Set((d1.bloqueados || []).map((b) => b.id));
    }
  } catch (e) {}
}

// ============================================================
// DIGITANDO
// ============================================================

function emitirDigitando(contexto) {
  if (!config.digitando) return;
  if (!socket) return;
  const agora = Date.now();
  if (agora - ultimoEnvioDigitando[contexto] < 800) return;
  ultimoEnvioDigitando[contexto] = agora;

  if (contexto === 'canal') {
    if (!canalAtivo) return;
    socket.emit('digitando-canal', { canalId: canalAtivo.id, nome: meuUsuario.nome });
  } else {
    if (!conversaAtual) return;
    socket.emit('digitando-dm', {
      conversaId: conversaAtual.conversa_id,
      paraUsuarioId: conversaAtual.amigo.id,
      nome: meuUsuario.nome,
    });
  }

  clearTimeout(digitandoTimeout[contexto]);
  digitandoTimeout[contexto] = setTimeout(() => { pararDigitando(contexto); }, 1500);
}

function pararDigitando(contexto) {
  if (!socket) return;
  clearTimeout(digitandoTimeout[contexto]);
  digitandoTimeout[contexto] = null;

  if (contexto === 'canal') {
    if (!canalAtivo) return;
    socket.emit('parou-digitando-canal', { canalId: canalAtivo.id });
  } else {
    if (!conversaAtual) return;
    socket.emit('parou-digitando-dm', {
      conversaId: conversaAtual.conversa_id,
      paraUsuarioId: conversaAtual.amigo.id,
    });
  }
}

function mostrarDigitando(contexto, nome) {
  const barId = contexto === 'canal' ? 'digitando-canal' : 'digitando-dm';
  const textoId = contexto === 'canal' ? 'digitando-canal-texto' : 'digitando-dm-texto';
  const bar = document.getElementById(barId);
  const texto = document.getElementById(textoId);
  if (!bar || !texto) return;
  texto.textContent = `${nome} está digitando`;
  bar.classList.add('ativo');
  clearTimeout(timeoutAlguemDigitando[contexto]);
  timeoutAlguemDigitando[contexto] = setTimeout(() => { esconderDigitando(contexto); }, 3000);
}

function esconderDigitando(contexto) {
  const barId = contexto === 'canal' ? 'digitando-canal' : 'digitando-dm';
  const bar = document.getElementById(barId);
  if (bar) bar.classList.remove('ativo');
  clearTimeout(timeoutAlguemDigitando[contexto]);
}

// ============================================================
// EMOJI PICKER
// ============================================================

function montarEmojiPicker() {
  ['emoji-picker-canal', 'emoji-picker-dm'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    let html = '';
    for (const [categoria, emojis] of Object.entries(EMOJIS)) {
      html += `<div class="emoji-categoria">${categoria}</div><div class="emoji-grid">`;
      emojis.forEach((e) => { html += `<span data-emoji="${e}">${e}</span>`; });
      html += `</div>`;
    }
    el.innerHTML = html;

    el.addEventListener('click', (e) => {
      const span = e.target.closest('span[data-emoji]');
      if (!span) return;
      e.stopPropagation();
      inserirEmoji(id, span.getAttribute('data-emoji'));
    });
  });
}

function inserirEmoji(pickerId, emoji) {
  const inputId = pickerId === 'emoji-picker-canal' ? 'input-canal' : 'input-dm';
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value += emoji;
  input.focus();
  document.getElementById(pickerId).classList.remove('ativo');
}

function toggleEmojiPicker(contexto) {
  const id = contexto === 'canal' ? 'emoji-picker-canal' : 'emoji-picker-dm';
  const inputId = contexto === 'canal' ? 'input-canal' : 'input-dm';
  const el = document.getElementById(id);
  const input = document.getElementById(inputId);
  if (!el || !input) return;

  const outros = ['emoji-picker-canal', 'emoji-picker-dm'].filter((x) => x !== id);
  outros.forEach((x) => document.getElementById(x)?.classList.remove('ativo'));

  if (el.classList.contains('ativo')) { el.classList.remove('ativo'); return; }
  el.classList.add('ativo');

  const windowWidth = window.innerWidth;
  const isMobile = windowWidth <= 768;
  const margem = 12;
  const larguraMax = isMobile ? (windowWidth - margem * 2) : 340;
  el.style.width = larguraMax + 'px';
  el.style.maxWidth = larguraMax + 'px';

  const altura = Math.min(320, el.scrollHeight || 320);
  const rect = input.getBoundingClientRect();
  const espacoAcima = rect.top;
  const espacoAbaixo = window.innerHeight - rect.bottom;

  let top;
  if (espacoAcima >= altura + 20) top = rect.top - altura - 8;
  else if (espacoAbaixo >= altura + 20) top = rect.bottom + 8;
  else top = espacoAcima > espacoAbaixo ? 10 : window.innerHeight - altura - 10;

  let left;
  if (isMobile) left = margem;
  else {
    left = rect.left;
    if (left + larguraMax > windowWidth - 10) left = windowWidth - larguraMax - 10;
    if (left < 10) left = 10;
  }

  el.style.top = top + 'px';
  el.style.left = left + 'px';
  el.style.bottom = 'auto';
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.emoji-picker')) return;
  if (e.target.closest('.emoji-btn')) return;
  document.querySelectorAll('.emoji-picker.ativo').forEach((el) => el.classList.remove('ativo'));
});

document.addEventListener('scroll', (e) => {
  if (e.target && e.target.closest && e.target.closest('.chat-area')) {
    document.querySelectorAll('.emoji-picker.ativo').forEach((el) => el.classList.remove('ativo'));
  }
}, true);

window.addEventListener('resize', () => {
  document.querySelectorAll('.emoji-picker.ativo').forEach((el) => el.classList.remove('ativo'));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.emoji-picker.ativo').forEach((el) => el.classList.remove('ativo'));
    fecharPickerReacao();
    fecharImagem();
    fecharMenuAnexo();
    fecharMenuContexto();
    const modalCamera = document.getElementById('modal-camera');
    if (modalCamera && modalCamera.classList.contains('ativo')) fecharCamera();
    if (gravacaoEstado.ativo) cancelarGravacao();
  }
});

// ============================================================
// REAÇÕES — PICKER GLOBAL
// ============================================================

function montarPickerReacao() {
  const el = document.getElementById('reacao-picker-global');
  if (!el) return;
  let html = '';
  EMOJIS_RAPIDOS.forEach((e) => { html += `<span data-emoji="${e}">${e}</span>`; });
  el.innerHTML = html;

  el.addEventListener('click', (ev) => {
    const span = ev.target.closest('span[data-emoji]');
    if (!span) return;
    ev.stopPropagation();
    ev.preventDefault();
    const emoji = span.getAttribute('data-emoji');
    const { msgId, contexto } = pickerReacaoEstado;
    if (msgId != null && contexto) toggleReacao(contexto, msgId, emoji);
    fecharPickerReacao();
  });
}

function abrirPickerReacao(event, btn, contexto, msgId) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const picker = document.getElementById('reacao-picker-global');
  if (!picker || !btn) return;
  if (picker.classList.contains('ativo') && pickerReacaoEstado.msgId === msgId && pickerReacaoEstado.contexto === contexto) {
    fecharPickerReacao(); return;
  }
  pickerReacaoEstado = { msgId, contexto };
  picker.classList.add('ativo');

  requestAnimationFrame(() => {
    const rect = btn.getBoundingClientRect();
    const pRect = picker.getBoundingClientRect();
    const pW = pRect.width || 300;
    const pH = pRect.height || 44;
    let top = rect.top - pH - 8;
    let left = rect.left;
    if (left + pW > window.innerWidth - 10) left = window.innerWidth - pW - 10;
    if (left < 10) left = 10;
    if (top < 10) top = rect.bottom + 8;
    picker.style.top = top + 'px';
    picker.style.left = left + 'px';
  });
}

function fecharPickerReacao() {
  const picker = document.getElementById('reacao-picker-global');
  if (picker) picker.classList.remove('ativo');
  pickerReacaoEstado = { msgId: null, contexto: null };
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#reacao-picker-global')) return;
  if (e.target.closest('.btn-reagir')) return;
  fecharPickerReacao();
}, true);

document.addEventListener('scroll', (e) => {
  if (e.target && e.target.closest && e.target.closest('.chat-area')) fecharPickerReacao();
}, true);

// ============================================================
// LONG PRESS (mensagens)
// ============================================================

function iniciarLongPress(e, msgEl) {
  if (e.target.closest('button')) return;
  if (e.target.closest('.msg-anexo-imagem')) return;
  if (e.target.closest('.media-video-elemento')) return;
  if (e.target.closest('.media-player')) return;
  if (e.target.closest('.msg-anexo-media-download')) return;

  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    document.querySelectorAll('.msg-com-avatar.mostrar-acoes').forEach((el) => el.classList.remove('mostrar-acoes'));
    msgEl.classList.add('mostrar-acoes');
    if (navigator.vibrate) navigator.vibrate(20);
  }, 450);
}

function cancelarLongPress() { clearTimeout(longPressTimer); }

document.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg-com-avatar');
  if (!msgEl) return;
  iniciarLongPress(e, msgEl);
}, { passive: true });
document.addEventListener('touchend', cancelarLongPress);
document.addEventListener('touchmove', cancelarLongPress);
document.addEventListener('touchcancel', cancelarLongPress);

document.addEventListener('click', (e) => {
  if (e.target.closest('.msg-com-avatar')) return;
  if (e.target.closest('.msg-acoes')) return;
  document.querySelectorAll('.msg-com-avatar.mostrar-acoes').forEach((el) => el.classList.remove('mostrar-acoes'));
});

// ============================================================
// REPLY
// ============================================================

function ativarReply(contexto, msgId, autor, texto) {
  replyAtual[contexto] = { msgId, autor, texto };
  const barraId = contexto === 'canal' ? 'barra-reply-canal' : 'barra-reply-dm';
  const infoId = contexto === 'canal' ? 'reply-info-canal' : 'reply-info-dm';
  const inputId = contexto === 'canal' ? 'input-canal' : 'input-dm';
  const barra = document.getElementById(barraId);
  const info = document.getElementById(infoId);
  const trecho = texto.length > 50 ? texto.slice(0, 50) + '...' : texto;
  info.innerHTML = `Respondendo a <strong>${escapeHtml(autor)}</strong>: ${escapeHtml(trecho)}`;
  barra.classList.add('ativo');
  document.getElementById(inputId).focus();
}

function cancelarReply(contexto) {
  replyAtual[contexto] = null;
  const barraId = contexto === 'canal' ? 'barra-reply-canal' : 'barra-reply-dm';
  document.getElementById(barraId).classList.remove('ativo');
}

// ============================================================
// SWIPE TO REPLY
// ============================================================

let swipeEstado = { ativo: false, x: 0, y: 0, msgEl: null, startX: 0, startY: 0, tipo: null };

function ativarSwipe(msgEl) {
  const chatId = msgEl.parentElement.id;
  const contexto = chatId === 'chat-canal' ? 'canal' : 'dm';
  const msgId = Number(msgEl.dataset.msgId);
  const autor = msgEl.querySelector('.msg-autor')?.textContent || '?';
  const texto = msgEl.querySelector('.msg-texto')?.textContent || '';
  ativarReply(contexto, msgId, autor, texto);
}

function iniciarSwipe(e, msgEl) {
  if (swipeEstado.ativo) return;
  if (e.target.closest('button')) return;
  if (e.target.closest('.msg-anexo-imagem')) return;
  if (e.target.closest('.media-video-elemento')) return;
  if (e.target.closest('.media-player')) return;
  if (e.target.closest('.msg-anexo-media-download')) return;

  const isTouch = e.type.startsWith('touch');
  const clientX = isTouch ? e.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.touches[0].clientY : e.clientY;
  swipeEstado = { ativo: true, x: clientX, y: clientY, msgEl, startX: clientX, startY: clientY, tipo: isTouch ? 'touch' : 'mouse' };
  msgEl.classList.add('arrastando');
}

function moverSwipe(e) {
  if (!swipeEstado.ativo || !swipeEstado.msgEl) return;
  const isTouch = e.type.startsWith('touch');
  const clientX = isTouch ? e.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.touches[0].clientY : e.clientY;
  const dx = clientX - swipeEstado.startX;
  const dy = clientY - swipeEstado.startY;

  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { cancelarSwipe(); return; }
  if (dx < 0) {
    swipeEstado.msgEl.style.transform = '';
    swipeEstado.msgEl.classList.remove('arrastando-ativo');
    return;
  }
  const deslocamento = Math.min(dx, 100);
  swipeEstado.msgEl.style.transform = `translateX(${deslocamento}px)`;
  if (deslocamento >= 60) swipeEstado.msgEl.classList.add('arrastando-ativo');
  else swipeEstado.msgEl.classList.remove('arrastando-ativo');
  if (isTouch && Math.abs(dx) > 10 && e.cancelable) e.preventDefault();
}

function terminarSwipe() {
  if (!swipeEstado.ativo || !swipeEstado.msgEl) return;
  const msgEl = swipeEstado.msgEl;
  const transform = msgEl.style.transform;
  const match = transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
  const deslocamento = match ? parseFloat(match[1]) : 0;
  msgEl.classList.remove('arrastando');
  if (deslocamento >= 60) {
    ativarSwipe(msgEl);
    msgEl.classList.remove('arrastando-ativo');
  }
  msgEl.style.transform = '';
  setTimeout(() => msgEl.classList.remove('arrastando-ativo'), 200);
  swipeEstado = { ativo: false, x: 0, y: 0, msgEl: null, startX: 0, startY: 0, tipo: null };
}

function cancelarSwipe() {
  if (swipeEstado.msgEl) {
    swipeEstado.msgEl.style.transform = '';
    swipeEstado.msgEl.classList.remove('arrastando', 'arrastando-ativo');
  }
  swipeEstado = { ativo: false, x: 0, y: 0, msgEl: null, startX: 0, startY: 0, tipo: null };
}

document.addEventListener('mousedown', (e) => {
  const msgEl = e.target.closest('.msg-com-avatar');
  if (!msgEl) return;
  iniciarSwipe(e, msgEl);
});
document.addEventListener('mousemove', (e) => moverSwipe(e));
document.addEventListener('mouseup', terminarSwipe);

document.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg-com-avatar');
  if (!msgEl) return;
  iniciarSwipe(e, msgEl);
}, { passive: true });
document.addEventListener('touchmove', (e) => moverSwipe(e), { passive: false });
document.addEventListener('touchend', terminarSwipe);

// ============================================================
// SERVIDORES
// ============================================================

async function carregarServidores() {
  try {
    const r = await fetch('/api/servidores');
    const data = await r.json();
    servidores = data.servidores || [];
    renderizarServidores();
    if (servidores.length > 0 && !servidorAtivo) abrirServidor(servidores[0].id);
  } catch (e) { console.warn(e); }
}

function renderizarServidores() {
  const el = document.getElementById('lista-servidores');
  el.innerHTML = '';

  servidores.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'servidor-icon';
    if (servidorAtivo && servidorAtivo.servidor.id === s.id) d.classList.add('ativo');
    if (s.silenciado) d.classList.add('silenciado');
    d.textContent = s.nome.charAt(0).toUpperCase();
    d.title = s.nome;

    d.onclick = () => abrirServidor(s.id);
    d.oncontextmenu = (e) => { e.preventDefault(); abrirMenuServidor(e, s); };

    let timer;
    d.addEventListener('touchstart', (e) => {
      timer = setTimeout(() => {
        e.preventDefault();
        const t = e.touches[0];
        abrirMenuServidor({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {}, stopPropagation: () => {} }, s);
      }, 500);
    }, { passive: true });
    d.addEventListener('touchend', () => clearTimeout(timer));
    d.addEventListener('touchmove', () => clearTimeout(timer));

    el.appendChild(d);
  });

  const add = document.createElement('div');
  add.className = 'servidor-icon add';
  add.textContent = '+';
  add.title = 'Criar ou entrar em servidor';
  add.onclick = abrirModalServidor;
  el.appendChild(add);
}

function abrirMenuServidor(event, s) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const ehDono = servidorAtivo && servidorAtivo.servidor.id === s.id && servidorAtivo.ehDono;
  const silenciado = !!s.silenciado;

  abrirMenuContexto(event, {
    titulo: s.nome,
    acoes: [
      {
        emoji: silenciado ? '🔊' : '🔇',
        label: silenciado ? 'Dessilenciar servidor' : 'Silenciar servidor',
        onClick: async () => {
          const endpoint = silenciado ? '/api/dessilenciar' : '/api/silenciar';
          await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'servidor', alvoId: s.id }),
          });
          if (silenciado) silenciadosServidorLocal.delete(s.id);
          else silenciadosServidorLocal.add(s.id);
          await carregarServidores();
          if (servidorAtivo && servidorAtivo.servidor.id === s.id) {
            servidorAtivo.silenciado = !silenciado;
          }
        },
      },
      ...(ehDono ? [{
        emoji: '🗑️',
        label: 'Excluir servidor',
        perigo: true,
        onClick: async () => {
          if (!confirm(`EXCLUIR "${s.nome}"? Todos os canais e mensagens serão apagados pra sempre.`)) return;
          const r = await fetch('/api/servidores/' + s.id, { method: 'DELETE' });
          if (!r.ok) { alert('Erro ao excluir'); return; }
          servidores = servidores.filter((x) => x.id !== s.id);
          if (servidorAtivo && servidorAtivo.servidor.id === s.id) {
            servidorAtivo = null;
            document.getElementById('sidebar-canais').style.display = 'none';
          }
          renderizarServidores();
        },
      }] : [{
        emoji: '🚪',
        label: 'Sair do servidor',
        perigo: true,
        onClick: async () => {
          if (!confirm(`Realmente deseja sair de "${s.nome}"?`)) return;
          const r = await fetch(`/api/servidores/${s.id}/sair`, { method: 'POST' });
          if (!r.ok) { alert('Erro ao sair'); return; }
          servidores = servidores.filter((x) => x.id !== s.id);
          if (servidorAtivo && servidorAtivo.servidor.id === s.id) {
            servidorAtivo = null;
            document.getElementById('sidebar-canais').style.display = 'none';
          }
          renderizarServidores();
        },
      }]),
    ],
  });
}

async function abrirServidor(id) {
  try {
    const r = await fetch('/api/servidores/' + id);
    if (!r.ok) { alert('Erro ao abrir servidor'); return; }
    const data = await r.json();

    servidorAtivo = data;
    document.getElementById('sidebar-canais').style.display = 'flex';
    document.getElementById('nome-servidor').textContent = data.servidor.nome;
    document.getElementById('codigo-servidor').textContent = 'convite: ' + data.servidor.codigo_convite;

    if (data.silenciado) silenciadosServidorLocal.add(data.servidor.id);
    else silenciadosServidorLocal.delete(data.servidor.id);

    renderizarServidores();
    socket.emit('entrar-servidores');
    renderizarCanais();
    renderizarMembros();

    if (data.canais.length > 0) {
      if (telaAtual === 'canal') abrirCanal(data.canais[0]);
      else { canalAtivo = data.canais[0]; renderizarCanais(); }
    } else {
      canalAtivo = null;
      document.getElementById('chat-canal').innerHTML = '<div class="vazio">Sem canais neste servidor.</div>';
    }
  } catch (e) { console.warn(e); }
}

function renderizarCanais() {
  const el = document.getElementById('lista-canais');
  el.innerHTML = '';
  if (!servidorAtivo) return;

  servidorAtivo.canais.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'canal-item';
    if (canalAtivo && canalAtivo.id === c.id) d.classList.add('ativo');

    const span = document.createElement('span');
    span.textContent = '# ' + c.nome;
    d.appendChild(span);

    if (servidorAtivo.ehDono) {
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '🗑️';
      del.title = 'Deletar canal';
      del.onclick = (e) => { e.stopPropagation(); deletarCanal(c.id, c.nome); };
      d.appendChild(del);
    }

    d.onclick = () => abrirCanal(c);
    el.appendChild(d);
  });
}

function renderizarMembros() {
  const lista = document.getElementById('painel-membros-lista');
  const num = document.getElementById('painel-num-membros');
  if (!lista || !servidorAtivo) return;
  num.textContent = servidorAtivo.membros.length;

  lista.innerHTML = '';
  servidorAtivo.membros.forEach((m) => {
    const d = document.createElement('div');
    d.className = 'membro-item';
    const estaOnline = onlineIds.has(m.id);
    const dono = servidorAtivo.servidor.dono_id === m.id;

    d.innerHTML = `
      ${avatarHTML(m, 'mini')}
      <span class="dot ${estaOnline ? 'online' : 'offline'}"></span>
      <span>${escapeHtml(m.nome)}</span>
      ${dono ? '<span class="dono">dono</span>' : ''}
    `;

    d.onclick = (e) => {
      if (e.target.closest('.dono')) return;
      abrirPerfilVisitado(m);
    };
    lista.appendChild(d);
  });
}

function atualizarMembrosOnline() {
  if (servidorAtivo) renderizarMembros();
}

// ============================================================
// PAINEL DE MEMBROS
// ============================================================

function togglePainelMembros() {
  const painel = document.getElementById('painel-membros');
  painel.classList.toggle('aberto');
  painelMembrosAberto = painel.classList.contains('aberto');
  if (painelMembrosAberto) renderizarMembros();
}

function abrirPainelMembros() {
  document.getElementById('painel-membros').classList.add('aberto');
  painelMembrosAberto = true;
  renderizarMembros();
}

function fecharPainelMembros() {
  document.getElementById('painel-membros').classList.remove('aberto');
  painelMembrosAberto = false;
}

document.addEventListener('click', (e) => {
  const painel = document.getElementById('painel-membros');
  if (!painel.classList.contains('aberto')) return;
  if (e.target.closest('#painel-membros')) return;
  if (e.target.closest('.btn-membros-servidor')) return;
  fecharPainelMembros();
});

// ============================================================
// CANAIS E MENSAGENS
// ============================================================

async function abrirCanal(canal) {
  pararDigitando('canal');
  esconderDigitando('canal');

  canalAtivo = canal;
  socket.emit('entrar-canal', { canalId: canal.id });
  renderizarCanais();

  cancelarReply('canal');
  fecharPickerReacao();

  const r = await fetch(`/api/canais/${canal.id}/mensagens`);
  const data = await r.json();

  const el = document.getElementById('chat-canal');
  el.innerHTML = '';
  (data.mensagens || []).forEach(adicionarMsgCanal);

  telaAtual = 'canal';
  const telaCanal = document.getElementById('tela-canal');
  telaCanal.classList.add('tem-canal');
  document.getElementById('app').classList.add('canal-ativo');
  document.getElementById('titulo-main').textContent = '# ' + canal.nome;
  document.getElementById('input-canal').focus();

  esconderTelasMain();
  telaCanal.classList.add('ativa');

  if (window.innerWidth <= 768) fecharSidebarMobile();
}

async function criarCanalPrompt() {
  const nome = prompt('Nome do canal (ex: memes):');
  if (!nome || !nome.trim()) return;
  const r = await fetch(`/api/servidores/${servidorAtivo.servidor.id}/canais`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: nome.trim() }),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }
}

async function deletarCanal(id, nome) {
  if (!confirm(`Deletar canal #${nome}?`)) return;
  const r = await fetch('/api/canais/' + id, { method: 'DELETE' });
  if (!r.ok) { alert('Erro'); return; }
}

function enviarMsgCanal() {
  const input = document.getElementById('input-canal');
  const texto = input.value.trim();
  if (!texto || !canalAtivo) return;

  const reply = replyAtual.canal;
  const body = { texto };
  if (reply) {
    body.replyId = reply.msgId;
    body.replyAutor = reply.autor;
    body.replyTexto = reply.texto;
  }

  input.value = '';
  cancelarReply('canal');
  pararDigitando('canal');

  fetch(`/api/canais/${canalAtivo.id}/mensagens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) { alert('Erro ao enviar'); return; }
    const el = document.getElementById('chat-canal');
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 100);
  });
}

// ============================================================
// RENDER DE MENSAGENS
// ============================================================

function reacoesHTML(msgId, reacoes, contexto) {
  if (!reacoes || Object.keys(reacoes).length === 0) return '';
  let html = '<div class="msg-reacoes">';
  for (const [emoji, usuarios] of Object.entries(reacoes)) {
    const ehMinha = usuarios.includes(meuUsuario.id);
    html += `<div class="reacao-pill ${ehMinha ? 'minha' : ''}"
      onclick="toggleReacao('${contexto}', ${msgId}, '${emoji}')"
      title="${usuarios.length} pessoa(s)">
      <span>${emoji}</span>
      <span class="reacao-count">${usuarios.length}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

function replyHTML(msg) {
  if (!msg.reply_id || !msg.reply_autor) return '';
  const trecho = (msg.reply_texto || '').length > 80
    ? msg.reply_texto.slice(0, 80) + '...' : (msg.reply_texto || '');
  return `<div class="msg-reply-citacao">
    <span class="reply-autor">${escapeHtml(msg.reply_autor)}</span>
    ${escapeHtml(trecho)}
  </div>`;
}

function criarElMsg(m, chatId, contexto) {
  const ehMinha = m.de_id === meuUsuario.id;
  const div = document.createElement('div');
  div.className = 'msg-com-avatar' + (ehMinha ? ' minha' : '');
  div.dataset.msgId = m.id;

  const editadoTag = m.editado ? '<span class="msg-editada">(editado)</span>' : '';
  const reacoes = m.reacoes || {};
  const reply = replyHTML(m);
  const anexoHTML = renderAnexoHTML(m.anexo);

  const usuarioMsg = { nome: m.de_nome, avatar: m.de_avatar, id: m.de_id };
  const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(usuarioMsg).replace(/"/g, '&quot;')})`;
  const textoHTML = m.texto ? `<div class="msg-texto">${escapeHtml(m.texto)}</div>` : '';

  div.innerHTML = `
    <div class="msg-reply-hint">↩️</div>
    ${avatarHTML(usuarioMsg, '', onclickAttr)}
    <div class="msg-conteudo">
      <div class="msg-linha">
        <span class="msg-autor">${escapeHtml(m.de_nome || (ehMinha ? 'Você' : '?'))}</span>
        <span class="msg-hora">${formatarHora(m.hora)}</span>
        ${editadoTag}
      </div>
      ${reply}
      ${textoHTML}
      ${anexoHTML}
      ${reacoesHTML(m.id, reacoes, contexto)}
    </div>
    <div class="msg-acoes">
      <button class="btn-reagir" onclick="abrirPickerReacao(event, this, '${contexto}', ${m.id})" title="Reagir">😀</button>
      ${ehMinha ? `
        <button onclick="iniciarEdicao('${chatId}', ${m.id}, '${contexto}')" title="Editar">✏️</button>
        <button class="perigo" onclick="deletarMsg('${chatId}', ${m.id}, '${contexto}')" title="Deletar">🗑️</button>
      ` : ''}
    </div>
  `;

  return div;
}

function adicionarMsgCanal(m) {
  const el = document.getElementById('chat-canal');
  const div = criarElMsg(m, 'chat-canal', 'canal');
  el.appendChild(div);
  inicializarMediaPlayers(div);
  el.scrollTop = el.scrollHeight;
}

function adicionarMsgDM(m) {
  const el = document.getElementById('chat-dm');
  const div = criarElMsg(m, 'chat-dm', 'dm');
  el.appendChild(div);
  inicializarMediaPlayers(div);
  el.scrollTop = el.scrollHeight;
}

function atualizarMsgNaTela(chatId, msgId, novoTexto, editado) {
  const el = document.getElementById(chatId);
  const msgEl = el.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  const textoEl = msgEl.querySelector('.msg-texto');
  if (textoEl) textoEl.textContent = novoTexto;
  if (editado) {
    const linha = msgEl.querySelector('.msg-linha');
    if (linha && !linha.querySelector('.msg-editada')) {
      const tag = document.createElement('span');
      tag.className = 'msg-editada';
      tag.textContent = '(editado)';
      linha.appendChild(tag);
    }
  }
}

function removerMsgDaTela(chatId, msgId) {
  const el = document.getElementById(chatId);
  const msgEl = el.querySelector(`[data-msg-id="${msgId}"]`);
  if (msgEl) {
    msgEl.style.opacity = '0';
    msgEl.style.transform = 'scale(0.9)';
    msgEl.style.transition = 'all 0.2s';
    setTimeout(() => msgEl.remove(), 200);
  }
}

// ============================================================
// REAÇÕES
// ============================================================

async function toggleReacao(contexto, msgId, emoji) {
  fecharPickerReacao();
  try {
    const r = await fetch('/api/reacoes/toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: contexto, alvoId: msgId, emoji }),
    });
    if (!r.ok) { alert('Erro ao reagir'); return; }
    const data = await r.json();
    const chatId = contexto === 'canal' ? 'chat-canal' : 'chat-dm';
    atualizarReacoesNaTela(chatId, msgId, data.reacoes);
    tocarSom();
  } catch (e) { alert('Erro de conexão'); }
}

function atualizarReacoesNaTela(chatId, msgId, reacoes) {
  const el = document.getElementById(chatId);
  const msgEl = el.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  const antigo = msgEl.querySelector('.msg-reacoes');
  if (antigo) antigo.remove();
  const contexto = chatId === 'chat-canal' ? 'canal' : 'dm';
  const html = reacoesHTML(msgId, reacoes, contexto);
  if (html) {
    const conteudo = msgEl.querySelector('.msg-conteudo');
    conteudo.insertAdjacentHTML('beforeend', html);
  }
}

// ============================================================
// EDITAR / DELETAR MENSAGEM
// ============================================================

function iniciarEdicao(chatId, msgId, contexto) {
  const el = document.getElementById(chatId);
  const msgEl = el.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  const textoEl = msgEl.querySelector('.msg-texto');
  if (!textoEl) return;
  const textoAtual = textoEl.textContent;

  textoEl.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'msg-editando';
  wrap.innerHTML = `
    <input type="text" value="${escapeHtml(textoAtual)}" maxlength="2000">
    <button class="mini verde" title="Salvar">✅</button>
    <button class="secundario mini" title="Cancelar">❌</button>
  `;
  textoEl.parentElement.insertBefore(wrap, textoEl);

  const input = wrap.querySelector('input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const salvar = async () => {
    const novoTexto = input.value.trim();
    if (!novoTexto || novoTexto === textoAtual) return cancelar();
    let url;
    if (contexto === 'canal') url = `/api/canais/${canalAtivo.id}/mensagens/${msgId}`;
    else url = `/api/conversas/${conversaAtual.conversa_id}/mensagens/${msgId}`;
    const r = await fetch(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: novoTexto }),
    });
    if (!r.ok) { alert('Erro ao editar'); return cancelar(); }
    atualizarMsgNaTela(chatId, msgId, novoTexto, true);
    cancelar();
  };

  const cancelar = () => { wrap.remove(); textoEl.style.display = ''; };
  wrap.querySelector('button.verde').onclick = salvar;
  wrap.querySelector('button.secundario').onclick = cancelar;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
  });
}

async function deletarMsg(chatId, msgId, contexto) {
  if (!confirm('Deletar esta mensagem?')) return;
  let url;
  if (contexto === 'canal') url = `/api/canais/${canalAtivo.id}/mensagens/${msgId}`;
  else url = `/api/conversas/${conversaAtual.conversa_id}/mensagens/${msgId}`;
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) { alert('Erro ao deletar'); return; }
  removerMsgDaTela(chatId, msgId);
}

// ============================================================
// MODAIS SERVIDOR
// ============================================================

function abrirModalServidor() {
  document.getElementById('modal-servidor-erro').textContent = '';
  document.getElementById('modal-nome-servidor').value = '';
  document.getElementById('modal-desc-servidor').value = '';
  document.getElementById('modal-codigo-servidor').value = '';
  document.getElementById('modal-servidor').classList.add('ativo');
}

function fecharModalServidor() {
  document.getElementById('modal-servidor').classList.remove('ativo');
}

async function criarServidor() {
  const nome = document.getElementById('modal-nome-servidor').value.trim();
  const descricao = document.getElementById('modal-desc-servidor').value.trim();
  const erroEl = document.getElementById('modal-servidor-erro');
  erroEl.textContent = '';
  if (!nome) { erroEl.textContent = 'Informe o nome'; return; }
  const r = await fetch('/api/servidores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, descricao }),
  });
  const data = await r.json();
  if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
  fecharModalServidor();
  await carregarServidores();
  telaAtual = 'canal';
  abrirServidor(data.servidor.id);
}

async function entrarServidor() {
  const codigo = document.getElementById('modal-codigo-servidor').value.trim().toUpperCase();
  const erroEl = document.getElementById('modal-servidor-erro');
  erroEl.textContent = '';
  if (!codigo) { erroEl.textContent = 'Informe o código'; return; }
  const r = await fetch('/api/servidores/entrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  });
  const data = await r.json();
  if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
  fecharModalServidor();
  await carregarServidores();
  telaAtual = 'canal';
  abrirServidor(data.servidor.id);
}

function abrirModalEditarServidor() {
  if (!servidorAtivo || !servidorAtivo.ehDono) { alert('Só o dono pode editar'); return; }
  document.getElementById('edit-servidor-erro').textContent = '';
  document.getElementById('edit-servidor-nome').value = servidorAtivo.servidor.nome;
  document.getElementById('edit-servidor-desc').value = servidorAtivo.servidor.descricao || '';
  document.getElementById('modal-editar-servidor').classList.add('ativo');
}

function fecharModalEditarServidor() {
  document.getElementById('modal-editar-servidor').classList.remove('ativo');
}

async function salvarServidor() {
  const nome = document.getElementById('edit-servidor-nome').value.trim();
  const descricao = document.getElementById('edit-servidor-desc').value.trim();
  const erroEl = document.getElementById('edit-servidor-erro');
  erroEl.textContent = '';
  if (!nome) { erroEl.textContent = 'Informe o nome'; return; }
  const r = await fetch('/api/servidores/' + servidorAtivo.servidor.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, descricao }),
  });
  const data = await r.json();
  if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
  tocarSom();
  fecharModalEditarServidor();
}

// ============================================================
// TELAS
// ============================================================

function esconderTelasMain() {
  document.querySelectorAll('.tela-main').forEach((el) => el.classList.remove('ativa'));
}

function mostrarTelaHome() {
  telaAtual = 'home';
  canalAtivo = null;
  esconderTelasMain();
  const telaCanal = document.getElementById('tela-canal');
  telaCanal.classList.add('ativa');
  telaCanal.classList.remove('tem-canal');
  document.getElementById('app').classList.remove('canal-ativo');
  document.getElementById('titulo-main').textContent = 'Selecione um canal';
  document.getElementById('chat-canal').innerHTML = '<div class="vazio">Selecione um canal na barra lateral pra começar.</div>';
  renderizarCanais();
}

function abrirDM() {
  telaAtual = 'dm';
  document.getElementById('app').classList.remove('canal-ativo');
  esconderTelasMain();
  document.getElementById('tela-dm').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '💬 Mensagens diretas';
  carregarConversas();
}

function abrirAmigos() {
  telaAtual = 'amigos';
  document.getElementById('app').classList.remove('canal-ativo');
  esconderTelasMain();
  document.getElementById('tela-amigos').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '👥 Amigos';
  carregarAmizades();
}

function abrirBuscar() {
  telaAtual = 'buscar';
  document.getElementById('app').classList.remove('canal-ativo');
  esconderTelasMain();
  document.getElementById('tela-buscar').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '🔍 Buscar usuários';
  setTimeout(() => document.getElementById('busca-input').focus(), 50);
}

function voltarParaServidor() { mostrarTelaHome(); }

function voltarDMs() {
  conversaAtual = null;
  document.getElementById('chat-dm').innerHTML = '';
  cancelarReply('dm');
  fecharPickerReacao();
  esconderDigitando('dm');
  abrirDM();
}

// ============================================================
// AMIZADES
// ============================================================

async function carregarAmizades() {
  try {
    const r = await fetch('/api/amizades');
    if (!r.ok) return;
    const data = await r.json();
    renderizarPedidos(data.pedidosRecebidos);
    renderizarAmigos(data.amigos);
    renderizarEnviados(data.pedidosEnviados);
  } catch (e) { console.warn(e); }
}

function renderizarPedidos(pedidos) {
  const ul = document.getElementById('lista-pedidos');
  ul.innerHTML = '';
  if (pedidos.length === 0) { ul.innerHTML = '<div class="vazio">Sem pedidos</div>'; return; }
  pedidos.forEach((p) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(p).replace(/"/g, '&quot;')})`;
    info.innerHTML = `
      <span class="nome">${avatarHTML(p, 'mini', onclickAttr)} ${p.nome}</span>
      <span class="email">${p.email}</span>`;
    const acoes = document.createElement('div');
    const btnA = document.createElement('button');
    btnA.className = 'mini verde';
    btnA.textContent = '✅ Aceitar';
    btnA.onclick = () => aceitarPedido(p.amizade_id);
    const btnR = document.createElement('button');
    btnR.className = 'secundario mini';
    btnR.textContent = '❌ Recusar';
    btnR.onclick = () => recusarPedido(p.amizade_id);
    acoes.appendChild(btnA);
    acoes.appendChild(btnR);
    li.appendChild(info);
    li.appendChild(acoes);
    ul.appendChild(li);
  });
}

function renderizarAmigos(amigos) {
  const ul = document.getElementById('lista-amigos');
  ul.innerHTML = '';
  if (amigos.length === 0) { ul.innerHTML = '<div class="vazio">Sem amigos ainda</div>'; return; }
  amigos.forEach((a) => {
    const estaOnline = onlineIds.has(a.id);
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(a).replace(/"/g, '&quot;')})`;
    info.innerHTML = `
      <span class="nome">
        ${avatarHTML(a, 'mini', onclickAttr)}
        <span class="status-dot ${estaOnline ? 'online' : 'offline'}"></span>
        ${a.nome}
      </span>
      <span class="email">${estaOnline ? '🟢 online' : '⚫ offline'}</span>`;
    const acoes = document.createElement('div');
    const btnConv = document.createElement('button');
    btnConv.className = 'mini';
    btnConv.textContent = '💬 Conversar';
    btnConv.onclick = () => abrirConversa(a);
    const btnRem = document.createElement('button');
    btnRem.className = 'secundario mini';
    btnRem.textContent = '🗑️';
    btnRem.onclick = () => removerAmigo(a.amizade_id, a.nome);
    acoes.appendChild(btnConv);
    acoes.appendChild(btnRem);
    li.appendChild(info);
    li.appendChild(acoes);
    ul.appendChild(li);
  });
}

function renderizarEnviados(enviados) {
  const ul = document.getElementById('lista-enviados');
  ul.innerHTML = '';
  if (enviados.length === 0) { ul.innerHTML = '<div class="vazio">Sem pedidos enviados</div>'; return; }
  enviados.forEach((p) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(p).replace(/"/g, '&quot;')})`;
    info.innerHTML = `
      <span class="nome">${avatarHTML(p, 'mini', onclickAttr)} ${p.nome}</span>
      <span class="email">${p.email}</span>`;
    const s = document.createElement('span');
    s.className = 'email';
    s.textContent = '⏳ Pendente';
    li.appendChild(info);
    li.appendChild(s);
    ul.appendChild(li);
  });
}

async function aceitarPedido(id) {
  await fetch('/api/amizades/aceitar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amizadeId: id }),
  });
  carregarAmizades();
}

async function recusarPedido(id) {
  await fetch('/api/amizades/recusar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amizadeId: id }),
  });
  carregarAmizades();
}

async function removerAmigo(id, nome) {
  if (!confirm(`Remover ${nome}?`)) return;
  await fetch('/api/amizades/' + id, { method: 'DELETE' });
  carregarAmizades();
}

function buscarUsuarios() {
  clearTimeout(timeoutBusca);
  timeoutBusca = setTimeout(async () => {
    const q = document.getElementById('busca-input').value.trim();
    const ul = document.getElementById('lista-busca');
    if (q.length < 1) { ul.innerHTML = '<div class="vazio">Digite pra buscar</div>'; return; }
    const r = await fetch('/api/usuarios/buscar?q=' + encodeURIComponent(q));
    const data = await r.json();
    ul.innerHTML = '';
    if (!data.usuarios || data.usuarios.length === 0) {
      ul.innerHTML = '<div class="vazio">Ninguém encontrado</div>';
      return;
    }

    const amz = await fetch('/api/amizades').then((r) => r.json());
    const amigosIds = new Set(amz.amigos.map((a) => a.id));
    const enviadosIds = new Set(amz.pedidosEnviados.map((p) => p.id));
    const recebidosIds = new Set(amz.pedidosRecebidos.map((p) => p.id));

    data.usuarios.forEach((u) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'info';
      const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(u).replace(/"/g, '&quot;')})`;
      info.innerHTML = `
        <span class="nome">${avatarHTML(u, 'mini', onclickAttr)} ${u.nome}</span>
        <span class="email">${u.email}</span>`;
      const acoes = document.createElement('div');
      if (amigosIds.has(u.id)) acoes.innerHTML = '<span class="email">✅ Já é amigo</span>';
      else if (enviadosIds.has(u.id)) acoes.innerHTML = '<span class="email">⏳ Enviado</span>';
      else if (recebidosIds.has(u.id)) acoes.innerHTML = '<span class="email">📩 Te mandou pedido</span>';
      else {
        const b = document.createElement('button');
        b.className = 'mini verde';
        b.textContent = '+ Adicionar';
        b.onclick = () => pedirAmizade(u.id);
        acoes.appendChild(b);
      }
      li.appendChild(info);
      li.appendChild(acoes);
      ul.appendChild(li);
    });
  }, 300);
}

async function pedirAmizade(paraId) {
  const r = await fetch('/api/amizades/pedir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paraId }),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }
  buscarUsuarios();
  carregarAmizades();
}

// ============================================================
// DMs
// ============================================================

async function carregarConversas() {
  const r = await fetch('/api/conversas');
  const data = await r.json();
  const ul = document.getElementById('lista-conversas');
  ul.innerHTML = '';
  if (!data.conversas || data.conversas.length === 0) {
    ul.innerHTML = '<div class="vazio">Nenhuma conversa. Vá em Amigos e clique em Conversar.</div>';
    return;
  }

  data.conversas.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'clicavel';
    const info = document.createElement('div');
    info.className = 'info';
    const estaOnline = onlineIds.has(c.amigo.id);
    let preview;
    if (c.ultima) {
      const textoBase = c.ultima.texto || '📎 Anexo';
      preview = `${c.ultima.de_id === meuUsuario.id ? 'Você: ' : ''}${textoBase}`;
    } else {
      preview = '(sem mensagens)';
    }
    const onclickAttr = `abrirPerfilVisitado(${JSON.stringify(c.amigo).replace(/"/g, '&quot;')})`;
    const badgeSile = c.silenciado ? '<span class="badge-silenciado">🔇</span>' : '';
    info.innerHTML = `
      <span class="nome">
        ${avatarHTML(c.amigo, 'mini', onclickAttr)}
        <span class="status-dot ${estaOnline ? 'online' : 'offline'}"></span>
        ${c.amigo.nome}
        ${badgeSile}
      </span>
      <span class="preview">${escapeHtml(preview)}</span>
    `;
    li.appendChild(info);
    if (c.nao_lidas > 0) {
      const b = document.createElement('span');
      b.className = 'nao-lidas';
      b.textContent = c.nao_lidas;
      li.appendChild(b);
    }

    li.onclick = (e) => {
      if (e.target.closest('.avatar')) return;
      abrirConversa(c.amigo);
    };

    li.oncontextmenu = (e) => { e.preventDefault(); abrirMenuAmigo(e, c.amigo, c.silenciado); };
    let timer;
    li.addEventListener('touchstart', (e) => {
      timer = setTimeout(() => {
        e.preventDefault();
        const t = e.touches[0];
        abrirMenuAmigo({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {}, stopPropagation: () => {} }, c.amigo, c.silenciado);
      }, 500);
    }, { passive: true });
    li.addEventListener('touchend', () => clearTimeout(timer));
    li.addEventListener('touchmove', () => clearTimeout(timer));

    ul.appendChild(li);
  });
}

function abrirMenuAmigo(event, amigo, silenciado) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const bloqueado = estaBloqueadoLocal(amigo.id);

  abrirMenuContexto(event, {
    titulo: amigo.nome,
    acoes: [
      {
        emoji: silenciado ? '🔊' : '🔇',
        label: silenciado ? 'Dessilenciar' : 'Silenciar',
        onClick: async () => {
          const endpoint = silenciado ? '/api/dessilenciar' : '/api/silenciar';
          await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'usuario', alvoId: amigo.id }),
          });
          if (silenciado) silenciadosUsuarioLocal.delete(amigo.id);
          else silenciadosUsuarioLocal.add(amigo.id);
          carregarConversas();
        },
      },
      bloqueado ? {
        emoji: '🔓',
        label: 'Desbloquear',
        onClick: () => desbloquearUsuario(amigo.id),
      } : {
        emoji: '🚫',
        label: 'Bloquear',
        perigo: true,
        onClick: () => bloquearUsuario(amigo.id, amigo.nome),
      },
      {
        emoji: '👤',
        label: 'Ver perfil',
        onClick: () => abrirPerfilVisitado(amigo),
      },
    ],
  });
}

async function abrirConversa(amigo) {
  const r = await fetch('/api/conversas/abrir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amigoId: amigo.id }),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }

  conversaAtual = { conversa_id: data.conversa_id, amigo: data.amigo };

  cancelarReply('dm');
  fecharPickerReacao();
  esconderDigitando('dm');

  telaAtual = 'conversa';
  document.getElementById('app').classList.remove('canal-ativo');
  esconderTelasMain();
  document.getElementById('tela-conversa').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '💬 Conversa';
  document.getElementById('nome-conversa').textContent = data.amigo.nome;

  const r2 = await fetch(`/api/conversas/${data.conversa_id}/mensagens`);
  const d2 = await r2.json();
  const el = document.getElementById('chat-dm');
  el.innerHTML = '';
  (d2.mensagens || []).forEach(adicionarMsgDM);
  document.getElementById('input-dm').focus();
}

async function enviarMsgDM() {
  const input = document.getElementById('input-dm');
  const texto = input.value.trim();
  if (!texto || !conversaAtual) return;

  const reply = replyAtual.dm;
  const body = { texto };
  if (reply) {
    body.replyId = reply.msgId;
    body.replyAutor = reply.autor;
    body.replyTexto = reply.texto;
  }

  input.value = '';
  cancelarReply('dm');
  pararDigitando('dm');

  const r = await fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }
  adicionarMsgDM(data.mensagem);

  const el = document.getElementById('chat-dm');
  setTimeout(() => { el.scrollTop = el.scrollHeight; }, 100);
}

// ============================================================
// BLOQUEIOS
// ============================================================

async function bloquearUsuario(id, nome) {
  if (!confirm(`Bloquear ${nome}?`)) return;
  const r = await fetch('/api/bloquear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alvoId: id }),
  });
  if (!r.ok) { alert('Erro ao bloquear'); return; }
  bloqueadosLocal.add(id);
  carregarConversas();
  carregarAmizades();
  if (perfilVisitadoAtual && perfilVisitadoAtual.id === id) abrirPerfilVisitado(perfilVisitadoAtual);
}

async function desbloquearUsuario(id) {
  const r = await fetch('/api/desbloquear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alvoId: id }),
  });
  if (!r.ok) { alert('Erro ao desbloquear'); return; }
  bloqueadosLocal.delete(id);
  carregarConversas();
  carregarAmizades();
  carregarListaBloqueados();
  if (perfilVisitadoAtual && perfilVisitadoAtual.id === id) abrirPerfilVisitado(perfilVisitadoAtual);
}

async function abrirBloqueados() {
  fecharModalPerfil();
  await carregarListaBloqueados();
  document.getElementById('modal-bloqueados').classList.add('ativo');
}

function fecharBloqueados() {
  document.getElementById('modal-bloqueados').classList.remove('ativo');
}

async function carregarListaBloqueados() {
  const ul = document.getElementById('lista-bloqueados');
  ul.innerHTML = '<div class="vazio">Carregando...</div>';
  const r = await fetch('/api/bloqueados');
  const data = await r.json();
  const bloqueados = data.bloqueados || [];
  ul.innerHTML = '';
  if (bloqueados.length === 0) {
    ul.innerHTML = '<div class="vazio">Você não bloqueou ninguém.</div>';
    return;
  }
  bloqueados.forEach((b) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `
      <span class="nome">${avatarHTML(b, 'mini')} ${b.nome}</span>
      <span class="email">${b.email}</span>`;
    const btn = document.createElement('button');
    btn.className = 'mini verde';
    btn.textContent = '🔓 Desbloquear';
    btn.onclick = () => desbloquearUsuario(b.id);
    li.appendChild(info);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// ============================================================
// PERFIL — EDIÇÃO
// ============================================================

function abrirModalPerfil() {
  document.getElementById('perfil-nome-display').textContent = meuUsuario.nome;
  document.getElementById('perfil-email-display').textContent = meuUsuario.email;
  document.getElementById('perfil-bio').value = meuUsuario.bio || '';
  atualizarPreviewAvatar(meuUsuario);
  atualizarPreviewBanner(meuUsuario);
  document.getElementById('modal-perfil').classList.add('ativo');
}

function fecharModalPerfil() {
  document.getElementById('modal-perfil').classList.remove('ativo');
}

function atualizarPreviewAvatar(usuario) {
  const el = document.getElementById('avatar-preview');
  if (usuario.avatar) {
    el.classList.add('com-imagem');
    el.innerHTML = `<img src="${usuario.avatar}" alt="">`;
  } else {
    el.classList.remove('com-imagem');
    const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
    el.innerHTML = inicial;
    el.style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
  }
}

function atualizarPreviewBanner(usuario) {
  const el = document.getElementById('perfil-banner');
  if (usuario.banner) el.style.backgroundImage = `url(${usuario.banner})`;
  else el.style.backgroundImage = '';
}

async function salvarBio() {
  const bio = document.getElementById('perfil-bio').value.trim();
  if (bio === (meuUsuario.bio || '')) return;
  const r = await fetch('/api/bio', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bio }),
  });
  if (!r.ok) { alert('Erro ao salvar bio'); return; }
  meuUsuario.bio = bio;
  tocarSom();
}

function atualizarAvataresNaUI() {
  const el = document.getElementById('avatar-usuario');
  if (!el) return;
  el.className = 'avatar';
  el.removeAttribute('style');
  if (meuUsuario.avatar) {
    el.classList.add('com-imagem');
    el.innerHTML = `<img src="${meuUsuario.avatar}" alt="">`;
  } else {
    el.classList.remove('com-imagem');
    const inicial = (meuUsuario.nome || '?').charAt(0).toUpperCase();
    el.innerHTML = inicial;
    el.style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
  }
}

// ============================================================
// PERFIL — VISITA
// ============================================================

function abrirPerfilVisitado(usuario) {
  if (!usuario || !usuario.nome) return;
  if (meuUsuario && usuario.id === meuUsuario.id) { abrirModalPerfil(); return; }

  perfilVisitadoAtual = usuario;

  document.getElementById('visita-nome').textContent = usuario.nome;
  document.getElementById('visita-email').textContent = usuario.email || '';

  const avatarEl = document.getElementById('visita-avatar');
  if (usuario.avatar) {
    avatarEl.classList.add('com-imagem');
    avatarEl.innerHTML = `<img src="${usuario.avatar}" alt="">`;
  } else {
    avatarEl.classList.remove('com-imagem');
    const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
    avatarEl.innerHTML = inicial;
    avatarEl.style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
  }

  const bannerEl = document.getElementById('visita-banner');
  if (usuario.banner) bannerEl.style.backgroundImage = `url(${usuario.banner})`;
  else bannerEl.style.backgroundImage = '';

  document.getElementById('visita-bio').textContent =
    (usuario.bio && usuario.bio.trim()) ? usuario.bio : 'Sem descrição.';

  montarAcoesPerfil(usuario);
  document.getElementById('modal-perfil-visita').classList.add('ativo');
}

function montarAcoesPerfil(usuario) {
  const acoesEl = document.getElementById('visita-acoes');
  acoesEl.innerHTML = '';
  const bloqueado = estaBloqueadoLocal(usuario.id);

  if (bloqueado) {
    const btn = document.createElement('button');
    btn.className = 'desbloquear';
    btn.textContent = '🔓 Desbloquear';
    btn.onclick = () => desbloquearUsuario(usuario.id);
    acoesEl.appendChild(btn);
    return;
  }

  fetch('/api/amizades').then((r) => r.json()).then((amz) => {
    const ehAmigo = amz.amigos.some((a) => a.id === usuario.id);
    const pedidoEnviado = amz.pedidosEnviados.some((p) => p.id === usuario.id);
    const pedidoRecebido = amz.pedidosRecebidos.some((p) => p.id === usuario.id);

    if (!ehAmigo && !pedidoEnviado && !pedidoRecebido) {
      const btn = document.createElement('button');
      btn.className = 'amizade';
      btn.textContent = '➕ Mandar pedido de amizade';
      btn.onclick = () => { pedirAmizade(usuario.id); fecharPerfilVisitado(); };
      acoesEl.appendChild(btn);
    } else if (pedidoEnviado) {
      const btn = document.createElement('button');
      btn.className = 'silenciar';
      btn.textContent = '⏳ Pedido enviado';
      btn.disabled = true;
      acoesEl.appendChild(btn);
    } else if (pedidoRecebido) {
      const btn = document.createElement('button');
      btn.className = 'amizade';
      btn.textContent = '✅ Aceitar pedido';
      btn.onclick = () => {
        fetch('/api/amizades').then((r) => r.json()).then((d) => {
          const ped = d.pedidosRecebidos.find((p) => p.id === usuario.id);
          if (ped) aceitarPedido(ped.amizade_id);
          fecharPerfilVisitado();
        });
      };
      acoesEl.appendChild(btn);
    }

    const silenciado = estaSilenciadoLocal('usuario', usuario.id);
    const btnSil = document.createElement('button');
    btnSil.className = 'silenciar';
    btnSil.textContent = silenciado ? '🔊 Dessilenciar' : '🔇 Silenciar';
    btnSil.onclick = async () => {
      const endpoint = silenciado ? '/api/dessilenciar' : '/api/silenciar';
      await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'usuario', alvoId: usuario.id }),
      });
      if (silenciado) silenciadosUsuarioLocal.delete(usuario.id);
      else silenciadosUsuarioLocal.add(usuario.id);
      montarAcoesPerfil(usuario);
      carregarConversas();
    };
    acoesEl.appendChild(btnSil);

    if (servidorAtivo && servidorAtivo.ehDono && usuario.id !== meuUsuario.id) {
      const estaNoServidor = servidorAtivo.membros.some((m) => m.id === usuario.id);
      if (estaNoServidor) {
        const btnRem = document.createElement('button');
        btnRem.className = 'remover';
        btnRem.textContent = '👢 Remover do servidor';
        btnRem.onclick = async () => {
          if (!confirm(`Remover ${usuario.nome} do servidor?`)) return;
          const r = await fetch(`/api/servidores/${servidorAtivo.servidor.id}/remover-membro`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuarioId: usuario.id }),
          });
          if (!r.ok) { alert('Erro ao remover'); return; }
          servidorAtivo.membros = servidorAtivo.membros.filter((m) => m.id !== usuario.id);
          renderizarMembros();
          fecharPerfilVisitado();
        };
        acoesEl.appendChild(btnRem);
      }
    }

    const btnBl = document.createElement('button');
    btnBl.className = 'bloquear';
    btnBl.textContent = '🚫 Bloquear';
    btnBl.onclick = () => bloquearUsuario(usuario.id, usuario.nome);
    acoesEl.appendChild(btnBl);
  }).catch(() => {});
}

function fecharPerfilVisitado() {
  document.getElementById('modal-perfil-visita').classList.remove('ativo');
  perfilVisitadoAtual = null;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-perfil-visita') fecharPerfilVisitado();
  if (e.target.id === 'modal-perfil') fecharModalPerfil();
  if (e.target.id === 'modal-config') fecharConfig();
  if (e.target.id === 'modal-bloqueados') fecharBloqueados();
});

// ============================================================
// UPLOAD (avatar / banner)
// ============================================================

function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Escolha uma imagem'); return; }
  abrirEditor(file, 'avatar');
  event.target.value = '';
}

function uploadBanner(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Escolha uma imagem'); return; }
  abrirEditor(file, 'banner');
  event.target.value = '';
}

// ============================================================
// EDITOR DE IMAGEM
// ============================================================

let editorEstado = {
  tipo: null, imagem: null, zoom: 1, offsetX: 0, offsetY: 0,
  canvasW: 0, canvasH: 0, baseScale: 1,
  arrastando: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0,
};

function abrirEditor(file, tipo) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      editorEstado.tipo = tipo;
      editorEstado.imagem = img;
      editorEstado.zoom = 1;
      editorEstado.offsetX = 0;
      editorEstado.offsetY = 0;
      const canvas = document.getElementById('editor-canvas');

      if (tipo === 'avatar') {
        editorEstado.canvasW = 320; editorEstado.canvasH = 320;
        canvas.width = 320; canvas.height = 320;
        canvas.classList.add('circular');
        document.getElementById('editor-titulo').textContent = 'Ajustar avatar';
      } else {
        editorEstado.canvasW = 480; editorEstado.canvasH = 180;
        canvas.width = 480; canvas.height = 180;
        canvas.classList.remove('circular');
        document.getElementById('editor-titulo').textContent = 'Ajustar banner';
      }

      const escalaW = editorEstado.canvasW / img.width;
      const escalaH = editorEstado.canvasH / img.height;
      editorEstado.baseScale = Math.max(escalaW, escalaH);
      document.getElementById('editor-zoom').value = 1;

      const escalaTotal = editorEstado.baseScale * editorEstado.zoom;
      const w = img.width * escalaTotal;
      const h = img.height * escalaTotal;
      editorEstado.offsetX = (editorEstado.canvasW - w) / 2;
      editorEstado.offsetY = (editorEstado.canvasH - h) / 2;

      desenharEditor();
      document.getElementById('modal-editor').classList.add('ativo');
      document.getElementById('modal-perfil').classList.remove('ativo');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function desenharEditor() {
  const canvas = document.getElementById('editor-canvas');
  const ctx = canvas.getContext('2d');
  const { imagem, canvasW, canvasH, baseScale, zoom, offsetX, offsetY, tipo } = editorEstado;
  if (!imagem) return;

  ctx.clearRect(0, 0, canvasW, canvasH);
  const tam = 10;
  for (let y = 0; y < canvasH; y += tam) {
    for (let x = 0; x < canvasW; x += tam) {
      ctx.fillStyle = ((x / tam + y / tam) % 2 === 0) ? '#e0f2fe' : '#ffffff';
      ctx.fillRect(x, y, tam, tam);
    }
  }

  const escalaTotal = baseScale * zoom;
  const w = imagem.width * escalaTotal;
  const h = imagem.height * escalaTotal;
  ctx.drawImage(imagem, offsetX, offsetY, w, h);

  if (tipo === 'avatar') {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(canvasW / 2, canvasH / 2, Math.min(canvasW, canvasH) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function atualizarZoom(valor) {
  editorEstado.zoom = parseFloat(valor);
  const { imagem, baseScale, canvasW, canvasH } = editorEstado;
  const escalaTotal = baseScale * editorEstado.zoom;
  const w = imagem.width * escalaTotal;
  const h = imagem.height * escalaTotal;
  editorEstado.offsetX = (canvasW - w) / 2;
  editorEstado.offsetY = (canvasH - h) / 2;
  desenharEditor();
}

function iniciarArrasto(x, y) {
  editorEstado.arrastando = true;
  editorEstado.startX = x;
  editorEstado.startY = y;
  editorEstado.startOffsetX = editorEstado.offsetX;
  editorEstado.startOffsetY = editorEstado.offsetY;
}

function moverArrasto(x, y) {
  if (!editorEstado.arrastando) return;
  const dx = x - editorEstado.startX;
  const dy = y - editorEstado.startY;
  let novoX = editorEstado.startOffsetX + dx;
  let novoY = editorEstado.startOffsetY + dy;
  const { imagem, baseScale, zoom, canvasW, canvasH } = editorEstado;
  const escalaTotal = baseScale * zoom;
  const w = imagem.width * escalaTotal;
  const h = imagem.height * escalaTotal;
  const minX = canvasW - w;
  const minY = canvasH - h;
  novoX = Math.min(0, Math.max(minX, novoX));
  novoY = Math.min(0, Math.max(minY, novoY));
  editorEstado.offsetX = novoX;
  editorEstado.offsetY = novoY;
  desenharEditor();
}

function terminarArrasto() { editorEstado.arrastando = false; }

window.addEventListener('load', () => {
  const canvas = document.getElementById('editor-canvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', (e) => { e.preventDefault(); iniciarArrasto(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => moverArrasto(e.clientX, e.clientY));
  window.addEventListener('mouseup', terminarArrasto);

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { e.preventDefault(); iniciarArrasto(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) { e.preventDefault(); moverArrasto(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: false });
  canvas.addEventListener('touchend', terminarArrasto);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const slider = document.getElementById('editor-zoom');
    let valor = parseFloat(slider.value);
    valor += e.deltaY > 0 ? -0.05 : 0.05;
    valor = Math.min(3, Math.max(0.5, valor));
    slider.value = valor;
    atualizarZoom(valor);
  }, { passive: false });
});

async function salvarEdicao() {
  const { tipo, canvasW, canvasH } = editorEstado;
  const canvas = document.getElementById('editor-canvas');
  if (!tipo) return;

  let outputW, outputH;
  if (tipo === 'avatar') { outputW = 256; outputH = 256; }
  else { outputW = 800; outputH = 300; }

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputW;
  outputCanvas.height = outputH;
  const outCtx = outputCanvas.getContext('2d');
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outputW, outputH);
  outCtx.drawImage(canvas, 0, 0, canvasW, canvasH, 0, 0, outputW, outputH);

  const base64 = outputCanvas.toDataURL('image/jpeg', 0.92);
  const endpoint = tipo === 'avatar' ? '/api/avatar' : '/api/banner';
  const chave = tipo === 'avatar' ? 'avatar' : 'banner';

  const r = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [chave]: base64 }),
  });
  if (!r.ok) { alert('Erro ao salvar'); return; }

  meuUsuario[chave] = base64;
  if (tipo === 'avatar') { atualizarPreviewAvatar(meuUsuario); atualizarAvataresNaUI(); }
  else { atualizarPreviewBanner(meuUsuario); }
  tocarSom();
  fecharEditor();
  document.getElementById('modal-perfil').classList.add('ativo');
}

function descartarEdicao() {
  fecharEditor();
  document.getElementById('modal-perfil').classList.add('ativo');
}

function fecharEditor() {
  document.getElementById('modal-editor').classList.remove('ativo');
  editorEstado.tipo = null;
  editorEstado.imagem = null;
}

// ============================================================
// GRAVAÇÃO DE ÁUDIO
// ============================================================

let gravacaoEstado = {
  ativo: false, gravando: false, mediaRecorder: null,
  chunks: [], stream: null, blob: null, inicio: 0,
  timerInterval: null, barsInterval: null,
  audioCtxAnalyser: null, audioCtxSource: null, audioCtx: null,
  duracao: 0, contexto: null,
};

const GRAVACAO_MAX_SEGUNDOS = 120;

function iniciarGravacaoAudioDoContexto() {
  const contexto = anexoContexto || (telaAtual === 'canal' ? 'canal' : 'dm');
  fecharMenuAnexo();
  iniciarGravacaoAudio(contexto);
}

async function iniciarGravacaoAudio(contexto) {
  if (gravacaoEstado.ativo) return;
  if (contexto !== 'canal' && contexto !== 'dm') return;

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { alert('Não foi possível acessar o microfone.'); return; }

  const barra = document.getElementById('barra-gravacao');
  const timer = document.getElementById('gravacao-timer');
  const dica = document.getElementById('gravacao-dica');
  const btnGrav = document.getElementById('gravacao-btn');
  const iconeBtn = document.getElementById('gravacao-btn-icone');
  const info = document.getElementById('gravacao-info');
  const bars = document.getElementById('gravacao-bars');
  const acoes = document.getElementById('gravacao-acoes');
  const preview = document.getElementById('preview-gravacao');

  gravacaoEstado.ativo = true;
  gravacaoEstado.gravando = false;
  gravacaoEstado.contexto = contexto;
  gravacaoEstado.stream = stream;
  gravacaoEstado.chunks = [];
  gravacaoEstado.blob = null;
  gravacaoEstado.duracao = 0;

  info.style.display = 'flex';
  bars.style.display = 'flex';
  acoes.style.display = 'none';
  preview.style.display = 'none';
  timer.style.display = 'flex';
  btnGrav.style.display = 'flex';
  dica.textContent = 'Segure o botão pra gravar';
  iconeBtn.textContent = '🎙️';
  btnGrav.classList.remove('gravando');

  barra.classList.add('ativo');
  if (contexto === 'canal') document.getElementById('input-canal').disabled = true;
  else document.getElementById('input-dm').disabled = true;

  const iniciarGrav = async (e) => {
    if (e) e.preventDefault();
    if (gravacaoEstado.gravando) return;
    if (gravacaoEstado.blob) return;
    await comecarAGravar();
  };
  const pararGrav = (e) => {
    if (e) e.preventDefault();
    if (!gravacaoEstado.gravando) return;
    pararGravacao();
  };

  btnGrav.onmousedown = iniciarGrav;
  btnGrav.onmouseup = pararGrav;
  btnGrav.onmouseleave = pararGrav;
  btnGrav.ontouchstart = (e) => { e.preventDefault(); iniciarGrav(); };
  btnGrav.ontouchend = (e) => { e.preventDefault(); pararGrav(); };
  btnGrav.ontouchcancel = pararGrav;
  btnGrav.onclick = (e) => {
    e.preventDefault();
    if (gravacaoEstado.gravando) pararGravacao();
  };
}

async function comecarAGravar() {
  if (gravacaoEstado.gravando) return;
  const stream = gravacaoEstado.stream;
  if (!stream) return;

  const tipoMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

  let mr;
  try { mr = tipoMime ? new MediaRecorder(stream, { mimeType: tipoMime }) : new MediaRecorder(stream); }
  catch (e) { alert('Seu navegador não suporta gravação.'); return; }

  gravacaoEstado.mediaRecorder = mr;
  gravacaoEstado.chunks = [];
  gravacaoEstado.gravando = true;
  gravacaoEstado.inicio = Date.now();

  mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) gravacaoEstado.chunks.push(ev.data); };
  mr.onstop = () => {
    const blob = new Blob(gravacaoEstado.chunks, { type: mr.mimeType || 'audio/webm' });
    gravacaoEstado.blob = blob;
    gravacaoEstado.gravando = false;
    gravacaoEstado.duracao = (Date.now() - gravacaoEstado.inicio) / 1000;
    mostrarPreviewGravacao();
  };
  mr.start();

  const btnGrav = document.getElementById('gravacao-btn');
  const iconeBtn = document.getElementById('gravacao-btn-icone');
  const dica = document.getElementById('gravacao-dica');
  btnGrav.classList.add('gravando');
  iconeBtn.textContent = '⏺';
  dica.textContent = 'Solte pra parar';

  iniciarTimerGravacao();
  iniciarBarsGravacao();
}

function pararGravacao() {
  if (!gravacaoEstado.gravando) return;
  if (gravacaoEstado.mediaRecorder && gravacaoEstado.mediaRecorder.state !== 'inactive') {
    try { gravacaoEstado.mediaRecorder.stop(); } catch (e) {}
  }
  pararTimerGravacao();
  pararBarsGravacao();
}

function iniciarTimerGravacao() {
  const el = document.getElementById('gravacao-tempo');
  if (!el) return;
  pararTimerGravacao();
  gravacaoEstado.timerInterval = setInterval(() => {
    const seg = Math.floor((Date.now() - gravacaoEstado.inicio) / 1000);
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (seg >= GRAVACAO_MAX_SEGUNDOS) pararGravacao();
  }, 200);
}

function pararTimerGravacao() {
  clearInterval(gravacaoEstado.timerInterval);
  gravacaoEstado.timerInterval = null;
}

function iniciarBarsGravacao() {
  const bars = document.querySelectorAll('#gravacao-bars span');
  if (!bars.length) return;
  let analyser = null;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(gravacaoEstado.stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    gravacaoEstado.audioCtx = audioCtx;
    gravacaoEstado.audioCtxAnalyser = analyser;
    gravacaoEstado.audioCtxSource = source;
  } catch (e) { analyser = null; }

  const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  pararBarsGravacao();
  gravacaoEstado.barsInterval = setInterval(() => {
    bars.forEach((bar, i) => {
      let h = 8;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const valor = dataArray[i % dataArray.length] || 0;
        h = 6 + (valor / 255) * 22;
      } else h = 6 + Math.random() * 18;
      bar.style.height = h + 'px';
    });
  }, 60);
}

function pararBarsGravacao() {
  clearInterval(gravacaoEstado.barsInterval);
  gravacaoEstado.barsInterval = null;
  document.querySelectorAll('#gravacao-bars span').forEach((bar) => { bar.style.height = '6px'; });
  if (gravacaoEstado.audioCtx) {
    try { gravacaoEstado.audioCtx.close(); } catch (e) {}
    gravacaoEstado.audioCtx = null;
  }
}

function mostrarPreviewGravacao() {
  const info = document.getElementById('gravacao-info');
  const bars = document.getElementById('gravacao-bars');
  const acoes = document.getElementById('gravacao-acoes');
  const preview = document.getElementById('preview-gravacao');
  const btnGrav = document.getElementById('gravacao-btn');
  const timer = document.getElementById('gravacao-timer');
  if (!gravacaoEstado.blob) return;

  btnGrav.style.display = 'none';
  info.style.display = 'none';
  bars.style.display = 'none';
  timer.style.display = 'none';
  preview.style.display = 'flex';
  acoes.style.display = 'flex';

  const audio = document.getElementById('preview-audio');
  const url = URL.createObjectURL(gravacaoEstado.blob);
  audio.src = url;
  audio.dataset.naoPausar = '0';

  const playBtn = document.getElementById('preview-play');
  const barra = document.getElementById('preview-barra-fill');
  const tempoEl = document.getElementById('preview-tempo');

  const formatarTempo = (s) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const seg = Math.floor(s % 60);
    return `${m}:${seg.toString().padStart(2, '0')}`;
  };
  tempoEl.textContent = formatarTempo(gravacaoEstado.duracao);

  playBtn.onclick = (e) => {
    e.stopPropagation();
    if (audio.paused) {
      document.querySelectorAll('audio, video').forEach((el) => { if (el !== audio && !el.paused) el.pause(); });
      audio.play().catch(() => {});
    } else audio.pause();
  };
  audio.onplay = () => { playBtn.textContent = '⏸'; };
  audio.onpause = () => { playBtn.textContent = '▶'; };
  audio.onended = () => { playBtn.textContent = '▶'; audio.currentTime = 0; barra.style.width = '0%'; };
  audio.ontimeupdate = () => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    barra.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
  };
}

async function enviarGravacao() {
  if (!gravacaoEstado.blob) return;
  const contexto = gravacaoEstado.contexto;
  const blob = gravacaoEstado.blob;
  const ext = blob.type.includes('webm') ? 'webm' : 'ogg';
  const nome = `audio-${Date.now()}.${ext}`;
  const file = new File([blob], nome, { type: blob.type });
  finalizarGravacaoEstado();
  await enviarComUpload(file, 'arquivo', contexto);
}

function cancelarGravacao() { finalizarGravacaoEstado(); }

function finalizarGravacaoEstado() {
  if (gravacaoEstado.mediaRecorder && gravacaoEstado.mediaRecorder.state !== 'inactive') {
    try { gravacaoEstado.mediaRecorder.stop(); } catch (e) {}
  }
  if (gravacaoEstado.stream) gravacaoEstado.stream.getTracks().forEach((t) => t.stop());
  pararTimerGravacao();
  pararBarsGravacao();

  document.getElementById('barra-gravacao').classList.remove('ativo');

  const btnGrav = document.getElementById('gravacao-btn');
  const info = document.getElementById('gravacao-info');
  const bars = document.getElementById('gravacao-bars');
  const acoes = document.getElementById('gravacao-acoes');
  const preview = document.getElementById('preview-gravacao');
  const timer = document.getElementById('gravacao-timer');
  const iconeBtn = document.getElementById('gravacao-btn-icone');
  const dica = document.getElementById('gravacao-dica');

  btnGrav.style.display = 'flex';
  btnGrav.classList.remove('gravando');
  iconeBtn.textContent = '🎙️';
  info.style.display = 'flex';
  bars.style.display = 'flex';
  acoes.style.display = 'none';
  preview.style.display = 'none';
  timer.style.display = 'flex';

  const tempoEl = document.getElementById('gravacao-tempo');
  if (tempoEl) tempoEl.textContent = '0:00';
  dica.textContent = 'Segure o botão pra gravar';

  const audio = document.getElementById('preview-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  const barraFill = document.getElementById('preview-barra-fill');
  if (barraFill) barraFill.style.width = '0%';

  const inputCanal = document.getElementById('input-canal');
  const inputDM = document.getElementById('input-dm');
  if (inputCanal) inputCanal.disabled = false;
  if (inputDM) inputDM.disabled = false;

  gravacaoEstado = {
    ativo: false, gravando: false, mediaRecorder: null,
    chunks: [], stream: null, blob: null, inicio: 0,
    timerInterval: null, barsInterval: null,
    audioCtxAnalyser: null, audioCtxSource: null, audioCtx: null,
    duracao: 0, contexto: null,
  };
}

// ============================================================
// CÂMERA
// ============================================================

let cameraEstado = { stream: null, fotoBase64: null, contexto: null };

function abrirCameraDoContexto() {
  const contexto = anexoContexto || (telaAtual === 'canal' ? 'canal' : 'dm');
  fecharMenuAnexo();
  abrirCamera(contexto);
}

async function abrirCamera(contexto) {
  if (contexto !== 'canal' && contexto !== 'dm') return;
  const modal = document.getElementById('modal-camera');
  const video = document.getElementById('camera-video');
  const wrap = document.getElementById('camera-preview-wrap');
  const controlesCamera = document.getElementById('camera-controles');
  const controlesFoto = document.getElementById('camera-controles-foto');
  const canvas = document.getElementById('camera-canvas');

  cameraEstado.fotoBase64 = null;
  cameraEstado.contexto = contexto;
  wrap.classList.remove('mostrando-foto');
  controlesCamera.style.display = 'flex';
  controlesFoto.style.display = 'none';
  canvas.style.display = 'none';

  const tentativas = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
  ];

  let stream = null;
  let ultimoErro = null;
  for (const constraints of tentativas) {
    try { stream = await navigator.mediaDevices.getUserMedia(constraints); break; }
    catch (e) { ultimoErro = e; }
  }

  if (!stream) {
    let msg = 'Não foi possível acessar a câmera.\n\n';
    if (ultimoErro) {
      msg += 'Erro: ' + ultimoErro.name + '\n';
      if (ultimoErro.name === 'NotAllowedError') msg += 'Permita o acesso nas configurações.';
      else if (ultimoErro.name === 'NotFoundError') msg += 'Nenhuma câmera encontrada.';
      else if (ultimoErro.name === 'NotReadableError') msg += 'Câmera em uso por outro programa.';
      else msg += ultimoErro.message || 'Erro desconhecido';
    }
    alert(msg);
    return;
  }

  cameraEstado.stream = stream;
  video.srcObject = stream;
  video.onloadedmetadata = () => { video.play().catch(() => {}); };
  modal.classList.add('ativo');
}

function capturarFoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const wrap = document.getElementById('camera-preview-wrap');
  const controlesCamera = document.getElementById('camera-controles');
  const controlesFoto = document.getElementById('camera-controles-foto');
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  cameraEstado.fotoBase64 = canvas.toDataURL('image/jpeg', 0.92);
  wrap.classList.add('mostrando-foto');
  controlesCamera.style.display = 'none';
  controlesFoto.style.display = 'flex';
}

function tirarOutraFoto() {
  const wrap = document.getElementById('camera-preview-wrap');
  const controlesCamera = document.getElementById('camera-controles');
  const controlesFoto = document.getElementById('camera-controles-foto');
  cameraEstado.fotoBase64 = null;
  wrap.classList.remove('mostrando-foto');
  controlesCamera.style.display = 'flex';
  controlesFoto.style.display = 'none';
}

async function enviarFotoCapturada() {
  const contexto = cameraEstado.contexto;
  if (!cameraEstado.fotoBase64 || !contexto) return;
  const base64 = cameraEstado.fotoBase64;
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  const blob = new Blob([u8arr], { type: mime });
  const file = new File([blob], `foto-${Date.now()}.jpg`, { type: mime });
  fecharCamera();
  await enviarComUpload(file, 'foto', contexto);
}

function fecharCamera() {
  document.getElementById('modal-camera').classList.remove('ativo');
  const video = document.getElementById('camera-video');
  if (cameraEstado.stream) cameraEstado.stream.getTracks().forEach((t) => t.stop());
  cameraEstado.stream = null;
  cameraEstado.fotoBase64 = null;
  if (video) video.srcObject = null;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-camera') fecharCamera();
});

// ============================================================
// HELPERS FINAIS
// ============================================================

function formatarHora(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function atualizarTitulo() {
  if (naoLidasTotal > 0 && document.hidden) {
    document.title = `(${naoLidasTotal}) ${tituloOriginal}`;
  } else {
    document.title = tituloOriginal;
  }
}
document.addEventListener('visibilitychange', atualizarTitulo);

document.addEventListener('keypress', (e) => {
  if (e.target.id === 'input-canal' && e.key === 'Enter') enviarMsgCanal();
  if (e.target.id === 'input-dm' && e.key === 'Enter') enviarMsgDM();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'input-canal') emitirDigitando('canal');
  if (e.target.id === 'input-dm') emitirDigitando('dm');
});

// ============================================================
// SIDEBAR MOBILE
// ============================================================

function abrirSidebarMobile() {
  document.getElementById('sidebar-canais').classList.add('aberto');
  document.getElementById('overlay-mobile').classList.add('ativo');
}

function fecharSidebarMobile() {
  document.getElementById('sidebar-canais').classList.remove('aberto');
  document.getElementById('overlay-mobile').classList.remove('ativo');
}

// ============================================================
// 🔥 KEEP-ALIVE — Mantém a conexão viva no celular
// ============================================================

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    console.log('[VISIBILITY] Aba voltou ao foco');

    if (socket && !socket.connected) {
      console.log('[VISIBILITY] Socket morto, reconectando...');
      socket.connect();
    }

    if (conversaAtual) {
      fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`)
        .then(r => r.json())
        .then(data => {
          const el = document.getElementById('chat-dm');
          if (el && data.mensagens) {
            el.innerHTML = '';
            data.mensagens.forEach(adicionarMsgDM);
          }
        })
        .catch(() => {});
    }

    if (canalAtivo) {
      fetch(`/api/canais/${canalAtivo.id}/mensagens`)
        .then(r => r.json())
        .then(data => {
          const el = document.getElementById('chat-canal');
          if (el && data.mensagens) {
            el.innerHTML = '';
            data.mensagens.forEach(adicionarMsgCanal);
          }
        })
        .catch(() => {});
    }

    if (socket && socket.connected) {
      if (servidorAtivo) socket.emit('entrar-servidores');
      if (canalAtivo) socket.emit('entrar-canal', { canalId: canalAtivo.id });
    }
  }
});

setInterval(() => {
  if (socket && !socket.connected) {
    console.log('[HEARTBEAT] Socket morto, reconectando...');
    socket.connect();
  }
}, 20000);

window.addEventListener('online', () => {
  console.log('[ONLINE] Voltou a ter internet');
  if (socket && !socket.connected) socket.connect();
});

// ============================================================
// INIT
// ============================================================

window.addEventListener('load', async () => {
  carregarConfig();
  bindConfig();

  try {
    const r = await fetch('/api/eu', { credentials: 'same-origin' });
    if (r.ok) {
      const data = await r.json();
      if (data && data.usuario && data.usuario.id) {
        entrarNoApp(data.usuario);
        await carregarBloqueiosESilenciados();
      } else {
        meuUsuario = null;
        document.getElementById('tela-auth').style.display = 'flex';
        document.getElementById('app').classList.remove('ativo');
      }
    } else {
      meuUsuario = null;
      document.getElementById('tela-auth').style.display = 'flex';
      document.getElementById('app').classList.remove('ativo');
    }
  } catch (e) {
    meuUsuario = null;
    document.getElementById('tela-auth').style.display = 'flex';
    document.getElementById('app').classList.remove('ativo');
  }

  document.getElementById('login-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerLogin();
  });
  document.getElementById('cad-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerCadastro();
  });

  const nomeServidorEl = document.getElementById('nome-servidor');
  if (nomeServidorEl) nomeServidorEl.onclick = abrirModalEditarServidor;

  montarEmojiPicker();
  montarPickerReacao();

  window.addEventListener('storage', (e) => {
    if (e.key === 'void-logout') {
      location.reload();
    }
  });
});