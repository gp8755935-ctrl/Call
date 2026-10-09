// Helper: gera HTML do avatar
function avatarHTML(usuario, classe = '') {
  if (!usuario) return '';
  const cls = 'avatar ' + classe;
  if (usuario.avatar) {
    return `<div class="${cls}"><img src="${usuario.avatar}" alt=""></div>`;
  }
  const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
  const cores = ['#0284c7', '#0891b2', '#16a34a', '#7c3aed', '#db2777', '#ea580c'];
  const cor = cores[(usuario.nome || '').charCodeAt(0) % cores.length];
  return `<div class="${cls}" style="background: linear-gradient(180deg, ${cor}99, ${cor})">${inicial}</div>`;
}

// Lista de emojis
const EMOJIS = {
  'Carinhas': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
  'Gestos': ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','👃','🧠','🦷','👀','👁️','👅','👄'],
  'Corações': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋'],
  'Objetos': ['🔥','✨','⭐','🌟','💫','💥','💢','💤','💨','🕳️','💣','💬','🗨️','🗯️','💭','🎉','🎊','🎈','🎁','🎂','🍕','🍔','🍟','🍿','☕','🍺','🍻','🥂','🍷','🍸','🍹','🍾','🎮','🎯','🎲','🎰','🎸','🎺','🎻','🥁','🎤','🎧','🎬','📷','📸','📹','📺','📻'],
  'Símbolos': ['✅','❌','❗','❓','⚠️','🚫','💯','🔞','📛','♻️','🆗','🆕','🆒','🆓','🔝','🔙','🔚','🔛','🔜','🔎','🔍','➕','➖','➗','✖️','💲','💱','©️','®️','™️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻'],
};

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

// Reply
let replyAtual = { canal: null, dm: null };

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }
    entrarNoApp(data.usuario);
  } catch (e) { erroEl.textContent = 'Erro de conexão'; }
}

async function fazerLogout() {
  if (!confirm('Sair?')) return;
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

function entrarNoApp(usuario) {
  meuUsuario = usuario;
  document.getElementById('tela-auth').style.display = 'none';
  document.getElementById('app').classList.add('ativo');

  atualizarAvataresNaUI();

  conectarSocket();
  carregarServidores();
  carregarAmizades();
}

// ============================================================
// SOCKET
// ============================================================

function conectarSocket() {
  if (socket) return;
  socket = io();

  socket.on('connect', () => {
    console.log('Conectado como', meuUsuario.nome, '— socket', socket.id);
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'Não autenticado' || err.message === 'Token inválido') {
      alert('Sessão expirada. Faça login de novo.');
      location.reload();
    }
  });

  socket.on('lista-online', (users) => {
    onlineIds = new Set(users.map((u) => u.id));
    atualizarMembrosOnline();
    carregarAmizades();
  });

  socket.on('amizade-nova', () => { tocarSom(); carregarAmizades(); });
  socket.on('amizade-aceita', ({ por }) => {
    tocarSom(); carregarAmizades();
    alert(`${por.nome} aceitou seu pedido!`);
  });

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
        if (r.ok) {
          servidorAtivo = await r.json();
          renderizarMembros();
        }
      });
    }
    carregarConversas();
  });

  socket.on('dm-nova', ({ conversa_id, mensagem }) => {
    tocarSom();
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      adicionarMsgDM(mensagem);
      fetch(`/api/conversas/${conversa_id}/mensagens`);
    } else {
      naoLidasTotal++;
      atualizarTitulo();
    }
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

  socket.on('canal-nova-msg', ({ canal_id, mensagem }) => {
    if (canalAtivo && canalAtivo.id === canal_id) {
      adicionarMsgCanal(mensagem);
    }
  });

  socket.on('canal-msg-editada', ({ canal_id, mensagem }) => {
    if (canalAtivo && canalAtivo.id === canal_id) {
      atualizarMsgNaTela('chat-canal', mensagem.id, mensagem.texto, true);
    }
  });

  socket.on('canal-msg-deletada', ({ canal_id, mensagem_id }) => {
    if (canalAtivo && canalAtivo.id === canal_id) {
      removerMsgDaTela('chat-canal', mensagem_id);
    }
  });

  socket.on('reacao-atualizada', ({ tipo, alvoId, reacoes }) => {
    const chatId = tipo === 'canal' ? 'chat-canal' : 'chat-dm';
    atualizarReacoesNaTela(chatId, alvoId, reacoes);
  });

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
      html += `<div class="emoji-categoria">${categoria}</div>`;
      html += `<div class="emoji-grid">`;
      emojis.forEach((e) => {
        html += `<span onclick="inserirEmoji('${id}', '${e}')">${e}</span>`;
      });
      html += `</div>`;
    }
    el.innerHTML = html;
  });
}

function toggleEmojiPicker(contexto) {
  const id = contexto === 'canal' ? 'emoji-picker-canal' : 'emoji-picker-dm';
  const inputId = contexto === 'canal' ? 'input-canal' : 'input-dm';
  const el = document.getElementById(id);
  const input = document.getElementById(inputId);
  if (!el || !input) return;

  const outros = ['emoji-picker-canal', 'emoji-picker-dm'].filter((x) => x !== id);
  outros.forEach((x) => document.getElementById(x)?.classList.remove('ativo'));

  if (el.classList.contains('ativo')) {
    el.classList.remove('ativo');
    return;
  }

  el.classList.add('ativo');

  // 🔥 Pega a largura real da janela
  const windowWidth = window.innerWidth;
  const isMobile = windowWidth <= 768;

  // 🔥 No mobile, o picker ocupa quase toda a largura
  const margem = 12;
  const larguraMax = isMobile ? (windowWidth - margem * 2) : 340;

  el.style.width = larguraMax + 'px';
  el.style.maxWidth = larguraMax + 'px';

  // 🔥 Calcula altura depois de setar a largura (emoji grid muda)
  const altura = Math.min(320, el.scrollHeight || 320);
  const rect = input.getBoundingClientRect();
  const espacoAcima = rect.top;
  const espacoAbaixo = window.innerHeight - rect.bottom;

  let top;
  if (espacoAcima >= altura + 20) {
    top = rect.top - altura - 8;
  } else if (espacoAbaixo >= altura + 20) {
    top = rect.bottom + 8;
  } else {
    top = espacoAcima > espacoAbaixo
      ? 10
      : window.innerHeight - altura - 10;
  }

  // 🔥 Calcula left pra centralizar e nunca sair da tela
  let left;
  if (isMobile) {
    left = margem;
  } else {
    left = rect.left;
    if (left + larguraMax > windowWidth - 10) {
      left = windowWidth - larguraMax - 10;
    }
    if (left < 10) left = 10;
  }

  el.style.top = top + 'px';
  el.style.left = left + 'px';
  el.style.bottom = 'auto';
}
document.addEventListener('scroll', (e) => {
  if (e.target && e.target.closest && e.target.closest('.chat-area')) {
    document.querySelectorAll('.emoji-picker.ativo').forEach((el) => {
      el.classList.remove('ativo');
    });
  }
}, true);

// ============================================================
// REPLY (responder)
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

let swipeEstado = {
  ativo: false,
  x: 0,
  y: 0,
  msgEl: null,
  startX: 0,
  startY: 0,
  tipo: null,
};

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

  const isTouch = e.type.startsWith('touch');
  const clientX = isTouch ? e.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.touches[0].clientY : e.clientY;

  swipeEstado = {
    ativo: true,
    x: clientX,
    y: clientY,
    msgEl,
    startX: clientX,
    startY: clientY,
    tipo: isTouch ? 'touch' : 'mouse',
  };

  msgEl.classList.add('arrastando');
}

function moverSwipe(e) {
  if (!swipeEstado.ativo || !swipeEstado.msgEl) return;

  const isTouch = e.type.startsWith('touch');
  const clientX = isTouch ? e.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.touches[0].clientY : e.clientY;

  const dx = clientX - swipeEstado.startX;
  const dy = clientY - swipeEstado.startY;

  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
    cancelarSwipe();
    return;
  }

  if (dx < 0) {
    swipeEstado.msgEl.style.transform = '';
    swipeEstado.msgEl.classList.remove('arrastando-ativo');
    return;
  }

  const deslocamento = Math.min(dx, 100);
  swipeEstado.msgEl.style.transform = `translateX(${deslocamento}px)`;

  if (deslocamento >= 60) {
    swipeEstado.msgEl.classList.add('arrastando-ativo');
  } else {
    swipeEstado.msgEl.classList.remove('arrastando-ativo');
  }

  if (isTouch && Math.abs(dx) > 10 && e.cancelable) {
    e.preventDefault();
  }
}

function terminarSwipe(e) {
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
  setTimeout(() => {
    msgEl.classList.remove('arrastando-ativo');
  }, 200);

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
document.addEventListener('mouseup', (e) => terminarSwipe(e));

document.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg-com-avatar');
  if (!msgEl) return;
  iniciarSwipe(e, msgEl);
}, { passive: true });
document.addEventListener('touchmove', (e) => moverSwipe(e), { passive: false });
document.addEventListener('touchend', (e) => terminarSwipe(e));

// ============================================================
// SERVIDORES
// ============================================================

async function carregarServidores() {
  try {
    const r = await fetch('/api/servidores');
    const data = await r.json();
    servidores = data.servidores || [];
    renderizarServidores();

    if (servidores.length > 0 && !servidorAtivo) {
      abrirServidor(servidores[0].id);
    }
  } catch (e) { console.warn(e); }
}

function renderizarServidores() {
  const el = document.getElementById('lista-servidores');
  el.innerHTML = '';

  servidores.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'servidor-icon';
    if (servidorAtivo && servidorAtivo.servidor.id === s.id) d.classList.add('ativo');
    d.textContent = s.nome.charAt(0).toUpperCase();
    d.title = s.nome;
    d.onclick = () => abrirServidor(s.id);
    el.appendChild(d);
  });

  const add = document.createElement('div');
  add.className = 'servidor-icon add';
  add.textContent = '+';
  add.title = 'Criar ou entrar em servidor';
  add.onclick = abrirModalServidor;
  el.appendChild(add);
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

    renderizarServidores();
    socket.emit('entrar-servidores');
    renderizarCanais();
    renderizarMembros();

    if (data.canais.length > 0) {
      if (telaAtual === 'canal') {
        abrirCanal(data.canais[0]);
      } else {
        canalAtivo = data.canais[0];
        renderizarCanais();
      }
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
  const el = document.getElementById('lista-membros');
  el.innerHTML = '';
  if (!servidorAtivo) return;

  document.getElementById('num-membros').textContent = servidorAtivo.membros.length;

  servidorAtivo.membros.forEach((m) => {
    const d = document.createElement('div');
    d.className = 'membro-item';
    const estaOnline = onlineIds.has(m.id);

    d.innerHTML = `
      ${avatarHTML(m, 'mini')}
      <span class="dot ${estaOnline ? 'online' : 'offline'}"></span>
      <span>${escapeHtml(m.nome)}</span>
      ${m.id === servidorAtivo.servidor.dono_id ? '<span class="dono">dono</span>' : ''}
    `;
    el.appendChild(d);
  });
}

function atualizarMembrosOnline() {
  if (servidorAtivo) renderizarMembros();
}

async function abrirCanal(canal) {
  if (canalAtivo) socket.emit('sair-canal', { canalId: canalAtivo.id });

  canalAtivo = canal;
  socket.emit('entrar-canal', { canalId: canal.id });
  renderizarCanais();

  cancelarReply('canal');

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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  fetch(`/api/canais/${canalAtivo.id}/mensagens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) { alert('Erro ao enviar'); return; }
    // 🔥 scroll pro final
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
    ? msg.reply_texto.slice(0, 80) + '...'
    : (msg.reply_texto || '');
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

  div.innerHTML = `
    <div class="msg-reply-hint">↩️</div>
    ${avatarHTML({ nome: m.de_nome, avatar: m.de_avatar })}
    <div class="msg-conteudo">
      <div class="msg-linha">
        <span class="msg-autor">${escapeHtml(m.de_nome || (ehMinha ? 'Você' : '?'))}</span>
        <span class="msg-hora">${formatarHora(m.hora)}</span>
        ${editadoTag}
      </div>
      ${reply}
      <div class="msg-texto">${escapeHtml(m.texto)}</div>
      ${reacoesHTML(m.id, reacoes, contexto)}
    </div>
    <div class="msg-acoes">
      <button class="btn-reagir" onclick="toggleReacaoPicker(event, this)" title="Reagir">😀</button>
      ${ehMinha ? `
        <button onclick="iniciarEdicao('${chatId}', ${m.id}, '${contexto}')" title="Editar">✏️</button>
        <button class="perigo" onclick="deletarMsg('${chatId}', ${m.id}, '${contexto}')" title="Deletar">🗑️</button>
      ` : ''}
    </div>
    <div class="reacao-picker" onclick="event.stopPropagation()">
      <span onclick="toggleReacao('${contexto}', ${m.id}, '👍')">👍</span>
      <span onclick="toggleReacao('${contexto}', ${m.id}, '❤️')">❤️</span>
      <span onclick="toggleReacao('${contexto}', ${m.id}, '😂')">😂</span>
      <span onclick="toggleReacao('${contexto}', ${m.id}, '😮')">😮</span>
      <span onclick="toggleReacao('${contexto}', ${m.id}, '😢')">😢</span>
      <span onclick="toggleReacao('${contexto}', ${m.id}, '🔥')">🔥</span>
    </div>
  `;

  return div;
}

function adicionarMsgCanal(m) {
  const el = document.getElementById('chat-canal');
  const div = criarElMsg(m, 'chat-canal', 'canal');
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function adicionarMsgDM(m) {
  const el = document.getElementById('chat-dm');
  const div = criarElMsg(m, 'chat-dm', 'dm');
  el.appendChild(div);
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

function toggleReacaoPicker(event, btn) {
  event.stopPropagation();

  const msgEl = btn.closest('.msg-com-avatar');
  const picker = msgEl.querySelector('.reacao-picker');
  const btnRect = btn.getBoundingClientRect();

  document.querySelectorAll('.reacao-picker.ativo').forEach((p) => {
    if (p !== picker) p.classList.remove('ativo');
  });

  if (picker.classList.contains('ativo')) {
    picker.classList.remove('ativo');
    return;
  }

  picker.classList.add('ativo');

  requestAnimationFrame(() => {
    const pRect = picker.getBoundingClientRect();
    const pWidth = pRect.width || 220;
    const pHeight = pRect.height || 40;

    let top = btnRect.top - pHeight - 8;
    let left = btnRect.right - pWidth;

    if (left < 10) left = 10;
    if (left + pWidth > window.innerWidth - 10) {
      left = window.innerWidth - pWidth - 10;
    }

    if (top < 10) {
      top = btnRect.bottom + 8;
    }

    if (top + pHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - pHeight - 10);
    }

    picker.style.top = top + 'px';
    picker.style.left = left + 'px';
  });
}

async function toggleReacao(contexto, msgId, emoji) {
  document.querySelectorAll('.reacao-picker').forEach((p) => p.classList.remove('ativo'));

  const r = await fetch('/api/reacoes/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: contexto, alvoId: msgId, emoji }),
  });

  if (!r.ok) {
    const data = await r.json();
    alert(data.erro || 'Erro ao reagir');
    return;
  }

  const data = await r.json();
  const chatId = contexto === 'canal' ? 'chat-canal' : 'chat-dm';
  atualizarReacoesNaTela(chatId, msgId, data.reacoes);
  tocarSom();
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

document.addEventListener('click', (e) => {
  if (e.target.closest('.reacao-picker') || e.target.closest('.btn-reagir')) return;
  document.querySelectorAll('.reacao-picker').forEach((p) => p.classList.remove('ativo'));
});

// ============================================================
// EDITAR / DELETAR MENSAGEM
// ============================================================

function iniciarEdicao(chatId, msgId, contexto) {
  const el = document.getElementById(chatId);
  const msgEl = el.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;

  const textoEl = msgEl.querySelector('.msg-texto');
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
    if (contexto === 'canal') {
      url = `/api/canais/${canalAtivo.id}/mensagens/${msgId}`;
    } else {
      url = `/api/conversas/${conversaAtual.conversa_id}/mensagens/${msgId}`;
    }

    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: novoTexto }),
    });

    if (!r.ok) {
      const data = await r.json();
      alert(data.erro || 'Erro ao editar');
      return cancelar();
    }

    atualizarMsgNaTela(chatId, msgId, novoTexto, true);
    cancelar();
  };

  const cancelar = () => {
    wrap.remove();
    textoEl.style.display = '';
  };

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
  if (contexto === 'canal') {
    url = `/api/canais/${canalAtivo.id}/mensagens/${msgId}`;
  } else {
    url = `/api/conversas/${conversaAtual.conversa_id}/mensagens/${msgId}`;
  }

  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) {
    const data = await r.json();
    alert(data.erro || 'Erro ao deletar');
    return;
  }

  removerMsgDaTela(chatId, msgId);
}

// ============================================================
// MODAL SERVIDOR
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  });
  const data = await r.json();
  if (!r.ok) { erroEl.textContent = data.erro || 'Erro'; return; }

  fecharModalServidor();
  await carregarServidores();
  telaAtual = 'canal';
  abrirServidor(data.servidor.id);
}

// ============================================================
// MODAL EDITAR SERVIDOR
// ============================================================

function abrirModalEditarServidor() {
  if (!servidorAtivo || !servidorAtivo.ehDono) {
    alert('Só o dono pode editar o servidor');
    return;
  }
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
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
  document.querySelectorAll('.tela-main').forEach((el) => {
    el.classList.remove('ativa');
  });
}

function mostrarTelaCanal() {
  telaAtual = 'canal';
  esconderTelasMain();
  const telaCanal = document.getElementById('tela-canal');
  telaCanal.classList.add('ativa');
  telaCanal.classList.add('tem-canal');
  document.getElementById('app').classList.add('canal-ativo');
  if (canalAtivo) {
    document.getElementById('titulo-main').textContent = '# ' + canalAtivo.nome;
  }
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

function voltarParaServidor() {
  mostrarTelaHome();
}

function voltarDMs() {
  conversaAtual = null;
  document.getElementById('chat-dm').innerHTML = '';
  cancelarReply('dm');
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
  if (pedidos.length === 0) {
    ul.innerHTML = '<div class="vazio">Sem pedidos</div>';
    return;
  }
  pedidos.forEach((p) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `
      <span class="nome">${avatarHTML(p, 'mini')} ${p.nome}</span>
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
  if (amigos.length === 0) {
    ul.innerHTML = '<div class="vazio">Sem amigos ainda</div>';
    return;
  }
  amigos.forEach((a) => {
    const estaOnline = onlineIds.has(a.id);
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `
      <span class="nome">
        ${avatarHTML(a, 'mini')}
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
  if (enviados.length === 0) {
    ul.innerHTML = '<div class="vazio">Sem pedidos enviados</div>';
    return;
  }
  enviados.forEach((p) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `
      <span class="nome">${avatarHTML(p, 'mini')} ${p.nome}</span>
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amizadeId: id }),
  });
  carregarAmizades();
}

async function recusarPedido(id) {
  await fetch('/api/amizades/recusar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      info.innerHTML = `
        <span class="nome">${avatarHTML(u, 'mini')} ${u.nome}</span>
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    const preview = c.ultima
      ? `${c.ultima.de_id === meuUsuario.id ? 'Você: ' : ''}${c.ultima.texto}`
      : '(sem mensagens)';
    info.innerHTML = `
      <span class="nome">
        ${avatarHTML(c.amigo, 'mini')}
        <span class="status-dot ${estaOnline ? 'online' : 'offline'}"></span>
        ${c.amigo.nome}
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
    li.onclick = () => abrirConversa(c.amigo);
    ul.appendChild(li);
  });
}

async function abrirConversa(amigo) {
  const r = await fetch('/api/conversas/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amigoId: amigo.id }),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }

  conversaAtual = { conversa_id: data.conversa_id, amigo: data.amigo };

  cancelarReply('dm');

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

  const r = await fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }
  adicionarMsgDM(data.mensagem);

  // 🔥 scroll pro final
  const el = document.getElementById('chat-dm');
  setTimeout(() => { el.scrollTop = el.scrollHeight; }, 100);
}

// ============================================================
// PERFIL
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
    el.innerHTML = `<img src="${usuario.avatar}" alt="">`;
    el.style.background = 'transparent';
  } else {
    const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
    el.innerHTML = inicial;
    el.style.background = 'linear-gradient(180deg, #38bdf8, #0284c7)';
  }
}

function atualizarPreviewBanner(usuario) {
  const el = document.getElementById('perfil-banner');
  if (usuario.banner) {
    el.style.backgroundImage = `url(${usuario.banner})`;
  } else {
    el.style.backgroundImage = '';
  }
}

async function salvarBio() {
  const bio = document.getElementById('perfil-bio').value.trim();
  if (bio === (meuUsuario.bio || '')) return;

  const r = await fetch('/api/bio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bio }),
  });

  if (!r.ok) { alert('Erro ao salvar bio'); return; }

  meuUsuario.bio = bio;
  tocarSom();
}

function atualizarAvataresNaUI() {
  const el = document.getElementById('avatar-usuario');
  if (el) {
    el.outerHTML = avatarHTML(meuUsuario, '').replace('class="avatar "', 'id="avatar-usuario" class="avatar"');
  }
}

// ============================================================
// UPLOAD
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
        editorEstado.canvasW = 320;
        editorEstado.canvasH = 320;
        canvas.width = 320;
        canvas.height = 320;
        canvas.classList.add('circular');
        document.getElementById('editor-titulo').textContent = 'Ajustar avatar';
      } else {
        editorEstado.canvasW = 480;
        editorEstado.canvasH = 180;
        canvas.width = 480;
        canvas.height = 180;
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
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(0, 0, canvasW, canvasH);

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
  outCtx.drawImage(canvas, 0, 0, canvasW, canvasH, 0, 0, outputW, outputH);

  const base64 = outputCanvas.toDataURL('image/jpeg', 0.85);
  const endpoint = tipo === 'avatar' ? '/api/avatar' : '/api/banner';
  const chave = tipo === 'avatar' ? 'avatar' : 'banner';

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [chave]: base64 }),
  });

  if (!r.ok) { alert('Erro ao salvar'); return; }

  meuUsuario[chave] = base64;

  if (tipo === 'avatar') {
    atualizarPreviewAvatar(meuUsuario);
    atualizarAvataresNaUI();
  } else {
    atualizarPreviewBanner(meuUsuario);
  }

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
// HELPERS
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

const audioCtx = window.AudioContext ? new AudioContext() : null;
function tocarSom() {
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
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
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

// ============================================================
// RESPONSIVO MOBILE
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
// INIT
// ============================================================

window.addEventListener('load', async () => {
  try {
    const r = await fetch('/api/eu');
    if (r.ok) {
      const data = await r.json();
      entrarNoApp(data.usuario);
    }
  } catch (e) {}

  document.getElementById('login-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerLogin();
  });
  document.getElementById('cad-senha').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fazerCadastro();
  });

  const nomeServidorEl = document.getElementById('nome-servidor');
  if (nomeServidorEl) {
    nomeServidorEl.onclick = abrirModalEditarServidor;
  }

  montarEmojiPicker();
});