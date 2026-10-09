let socket = null;
let meuUsuario = null;
let onlineIds = new Set();
let conversaAtual = null; // { conversa_id, amigo }
let timeoutBusca = null;
let naoLidasTotal = 0;
let tituloOriginal = document.title;

// ========== ABAS DE AUTH ==========

function mudarAbaAuth(qual) {
  document.getElementById('aba-login').classList.toggle('ativa', qual === 'login');
  document.getElementById('aba-cadastro').classList.toggle('ativa', qual === 'cadastro');
  document.getElementById('form-login').style.display = qual === 'login' ? 'block' : 'none';
  document.getElementById('form-cadastro').style.display = qual === 'cadastro' ? 'block' : 'none';
  document.getElementById('login-erro').textContent = '';
  document.getElementById('cad-erro').textContent = '';
}

// ========== ABAS PRINCIPAIS ==========

function mudarAba(qual) {
  ['conversas', 'amigos', 'buscar'].forEach((t) => {
    document.getElementById('tab-' + t).classList.toggle('ativa', t === qual);
    document.getElementById('painel-' + t).classList.toggle('ativo', t === qual);
  });

  if (qual === 'amigos') carregarAmizades();
  if (qual === 'buscar') {
    setTimeout(() => document.getElementById('busca-input').focus(), 50);
  }
  if (qual === 'conversas') carregarConversas();
}

// ========== LOGIN / CADASTRO ==========

async function fazerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.textContent = '';

  if (!email || !senha) { erroEl.textContent = 'Preencha email e senha'; return; }

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro || 'Erro ao entrar'; return; }
    entrarNoApp(data.usuario);
  } catch (e) {
    erroEl.textContent = 'Erro de conexão';
  }
}

async function fazerCadastro() {
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim();
  const senha = document.getElementById('cad-senha').value;
  const erroEl = document.getElementById('cad-erro');
  erroEl.textContent = '';

  if (!nome || !email || !senha) { erroEl.textContent = 'Preencha todos os campos'; return; }

  try {
    const r = await fetch('/api/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro || 'Erro ao cadastrar'; return; }
    entrarNoApp(data.usuario);
  } catch (e) {
    erroEl.textContent = 'Erro de conexão';
  }
}

async function fazerLogout() {
  if (!confirm('Sair da conta?')) return;
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

// ========== ENTRAR NO APP ==========

function entrarNoApp(usuario) {
  meuUsuario = usuario;
  document.getElementById('nome-usuario').textContent = usuario.nome;
  document.getElementById('tela-auth').classList.remove('ativa');
  document.getElementById('tela-app').classList.add('ativa');

  conectarSocket();
  carregarAmizades();
  carregarConversas();
}

// ========== SOCKET ==========

function conectarSocket() {
  if (socket) return;

  socket = io();

  socket.on('connect', () => {
    console.log('Conectado como', meuUsuario.nome, '— socket', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('Erro de conexão:', err.message);
    if (err.message === 'Não autenticado' || err.message === 'Token inválido') {
      alert('Sessão expirada. Faça login de novo.');
      location.reload();
    }
  });

  socket.on('lista-online', (users) => {
    onlineIds = new Set(users.map((u) => u.id));
    carregarAmizades(); // atualiza status
  });

  socket.on('amizade-nova', ({ pedido }) => {
    tocarSom();
    carregarAmizades();
  });

  socket.on('amizade-aceita', ({ por }) => {
    tocarSom();
    carregarAmizades();
    alert(`${por.nome} aceitou seu pedido de amizade!`);
  });

  socket.on('dm-nova', ({ conversa_id, mensagem }) => {
    tocarSom();

    // Se tô na conversa, adiciona na tela
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      adicionarMsg(mensagem);
      // Marca como lida no servidor
      fetch(`/api/conversas/${conversa_id}/mensagens`, { method: 'GET' });
    } else {
      // Senão conta como não lida
      naoLidasTotal++;
      atualizarTitulo();
    }

    carregarConversas();
  });

  socket.on('dm-historico-limpo', ({ conversa_id }) => {
    if (conversaAtual && conversaAtual.conversa_id === conversa_id) {
      document.getElementById('chat').innerHTML = '';
      adicionarMsgSistema('--- histórico apagado ---');
    }
    carregarConversas();
  });
}

// ========== AMIZADES ==========

async function carregarAmizades() {
  try {
    const r = await fetch('/api/amizades');
    if (!r.ok) return;
    const data = await r.json();

    renderizarPedidos(data.pedidosRecebidos);
    renderizarAmigos(data.amigos);
    renderizarEnviados(data.pedidosEnviados);

    const badge = document.getElementById('badge-pedidos');
    const n = data.pedidosRecebidos.length;
    if (n > 0) { badge.textContent = n; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  } catch (e) { console.warn(e); }
}

function renderizarPedidos(pedidos) {
  const ul = document.getElementById('lista-pedidos');
  ul.innerHTML = '';
  if (pedidos.length === 0) {
    ul.innerHTML = '<div class="vazio">Sem pedidos pendentes</div>';
    return;
  }
  pedidos.forEach((p) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<span class="nome">${p.nome}</span><span class="email">${p.email}</span>`;

    const acoes = document.createElement('div');
    acoes.className = 'acoes';

    const btnA = document.createElement('button');
    btnA.className = 'mini';
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
    ul.innerHTML = '<div class="vazio">Você ainda não tem amigos 😢</div>';
    return;
  }
  amigos.forEach((a) => {
    const estaOnline = onlineIds.has(a.id);
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<span class="nome"><span class="status ${estaOnline ? 'online' : 'offline'}"></span>${a.nome}</span>
                      <span class="email">${estaOnline ? '🟢 online' : '⚫ offline'}</span>`;

    const acoes = document.createElement('div');
    acoes.className = 'acoes';

    const btnConv = document.createElement('button');
    btnConv.className = 'mini';
    btnConv.textContent = '💬 Conversar';
    btnConv.onclick = () => abrirConversa(a);

    const btnRem = document.createElement('button');
    btnRem.className = 'secundario mini';
    btnRem.textContent = '🗑️';
    btnRem.title = 'Remover amigo';
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
    info.innerHTML = `<span class="nome">${p.nome}</span><span class="email">${p.email}</span>`;
    const s = document.createElement('span');
    s.className = 'email';
    s.textContent = '⏳ Pendente';
    li.appendChild(info);
    li.appendChild(s);
    ul.appendChild(li);
  });
}

async function aceitarPedido(amizadeId) {
  await fetch('/api/amizades/aceitar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amizadeId }),
  });
  carregarAmizades();
}

async function recusarPedido(amizadeId) {
  await fetch('/api/amizades/recusar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amizadeId }),
  });
  carregarAmizades();
}

async function removerAmigo(amizadeId, nome) {
  if (!confirm(`Remover ${nome} dos amigos?`)) return;
  await fetch('/api/amizades/' + amizadeId, { method: 'DELETE' });
  carregarAmizades();
}

// ========== BUSCAR ==========

function buscarUsuarios() {
  clearTimeout(timeoutBusca);
  timeoutBusca = setTimeout(async () => {
    const q = document.getElementById('busca-input').value.trim();
    const ul = document.getElementById('lista-busca');

    if (q.length < 1) {
      ul.innerHTML = '<div class="vazio">Digite pra buscar</div>';
      return;
    }

    try {
      const r = await fetch('/api/usuarios/buscar?q=' + encodeURIComponent(q));
      if (!r.ok) return;
      const data = await r.json();
      ul.innerHTML = '';

      if (data.usuarios.length === 0) {
        ul.innerHTML = '<div class="vazio">Nenhum usuário encontrado</div>';
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
        info.innerHTML = `<span class="nome">${u.nome}</span><span class="email">${u.email}</span>`;
        const acoes = document.createElement('div');
        acoes.className = 'acoes';

        if (amigosIds.has(u.id)) acoes.innerHTML = '<span class="email">✅ Já é amigo</span>';
        else if (enviadosIds.has(u.id)) acoes.innerHTML = '<span class="email">⏳ Pedido enviado</span>';
        else if (recebidosIds.has(u.id)) acoes.innerHTML = '<span class="email">📩 Te mandou pedido</span>';
        else {
          const btn = document.createElement('button');
          btn.className = 'mini';
          btn.textContent = '+ Adicionar';
          btn.onclick = () => pedirAmizade(u.id);
          acoes.appendChild(btn);
        }

        li.appendChild(info);
        li.appendChild(acoes);
        ul.appendChild(li);
      });
    } catch (e) { console.warn(e); }
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

// ========== CONVERSAS ==========

async function carregarConversas() {
  try {
    const r = await fetch('/api/conversas');
    if (!r.ok) return;
    const data = await r.json();
    renderizarConversas(data.conversas);
  } catch (e) { console.warn(e); }
}

function renderizarConversas(convs) {
  const ul = document.getElementById('lista-conversas');
  ul.innerHTML = '';

  if (convs.length === 0) {
    ul.innerHTML = '<div class="vazio">Nenhuma conversa ainda. Vá em Amigos e clique em Conversar.</div>';
    return;
  }

  let totalNaoLidas = 0;

  convs.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'clicavel';

    const info = document.createElement('div');
    info.className = 'info';

    const estaOnline = onlineIds.has(c.amigo.id);
    const preview = c.ultima ? `${c.ultima.de_id === meuUsuario.id ? 'Você: ' : ''}${c.ultima.texto}` : '(sem mensagens)';

    info.innerHTML = `
      <span class="nome"><span class="status ${estaOnline ? 'online' : 'offline'}"></span>${c.amigo.nome}</span>
      <span class="preview">${escapeHtml(preview)}</span>
    `;

    li.appendChild(info);

    if (c.nao_lidas > 0) {
      totalNaoLidas += c.nao_lidas;
      const badge = document.createElement('span');
      badge.className = 'nao-lidas';
      badge.textContent = c.nao_lidas;
      li.appendChild(badge);
    } else if (c.ultima) {
      const h = document.createElement('span');
      h.className = 'hora-lista';
      h.textContent = formatarHoraCurta(c.ultima.hora);
      li.appendChild(h);
    }

    li.onclick = () => abrirConversa(c.amigo);
    ul.appendChild(li);
  });

  // Atualiza badge total
  naoLidasTotal = totalNaoLidas;
  const badge = document.getElementById('badge-dm');
  if (totalNaoLidas > 0) {
    badge.textContent = totalNaoLidas;
    badge.style.display = 'inline-block';
    atualizarTitulo();
  } else {
    badge.style.display = 'none';
    naoLidasTotal = 0;
    document.title = tituloOriginal;
  }
}

async function abrirConversa(amigo) {
  try {
    const r = await fetch('/api/conversas/abrir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amigoId: amigo.id }),
    });
    const data = await r.json();
    if (!r.ok) { alert(data.erro || 'Erro'); return; }

    conversaAtual = { conversa_id: data.conversa_id, amigo: data.amigo };

    document.getElementById('tela-app').classList.remove('ativa');
    document.getElementById('tela-conversa').classList.add('ativa');
    document.getElementById('nome-conversa').textContent = data.amigo.nome;
    atualizarStatusConversa();

    // Carrega mensagens
    const r2 = await fetch(`/api/conversas/${data.conversa_id}/mensagens`);
    const d2 = await r2.json();
    const chat = document.getElementById('chat');
    chat.innerHTML = '';
    (d2.mensagens || []).forEach(adicionarMsg);

    // Marca como lida
    carregarConversas();

    document.getElementById('msg').focus();
  } catch (e) {
    alert('Erro ao abrir conversa');
    console.warn(e);
  }
}

function atualizarStatusConversa() {
  if (!conversaAtual) return;
  const estaOnline = onlineIds.has(conversaAtual.amigo.id);
  document.getElementById('status-conversa').innerHTML = estaOnline
    ? '<span class="status online"></span> online'
    : '<span class="status offline"></span> offline';
}

function voltarConversas() {
  conversaAtual = null;
  document.getElementById('tela-conversa').classList.remove('ativa');
  document.getElementById('tela-app').classList.add('ativa');
  mudarAba('conversas');
}

async function enviarMensagem() {
  const input = document.getElementById('msg');
  const texto = input.value.trim();
  if (!texto || !conversaAtual) return;

  input.value = '';

  try {
    const r = await fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    const data = await r.json();
    if (!r.ok) { alert(data.erro || 'Erro'); return; }
    adicionarMsg(data.mensagem);
    carregarConversas();
  } catch (e) {
    alert('Erro ao enviar');
  }
}

// Enter pra enviar
document.addEventListener('keypress', (e) => {
  if (e.target.id === 'msg' && e.key === 'Enter') enviarMensagem();
});

// ========== RENDER DE MENSAGEM ==========

function adicionarMsg(m) {
  const div = document.createElement('div');
  const ehMinha = m.de_id === meuUsuario.id;
  div.className = 'msg ' + (ehMinha ? 'eu' : 'ele');
  div.innerHTML = `<strong>${escapeHtml(m.de_nome || (ehMinha ? 'Você' : '?'))}:</strong>
                   ${escapeHtml(m.texto)}
                   <span class="hora">${formatarHora(m.hora)}</span>`;

  const chat = document.getElementById('chat');
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function adicionarMsgSistema(txt) {
  const div = document.createElement('div');
  div.className = 'msg sistema';
  div.textContent = txt;
  document.getElementById('chat').appendChild(div);
}

// ========== HELPERS ==========

function formatarHora(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarHoraCurta(ms) {
  const d = new Date(ms);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return formatarHora(ms);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========== SOM / TÍTULO ==========

const audioCtx = window.AudioContext ? new AudioContext() : null;

function tocarSom() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
}

function atualizarTitulo() {
  if (naoLidasTotal > 0 && document.hidden) {
    document.title = `(${naoLidasTotal}) Meu Chat`;
  } else {
    document.title = tituloOriginal;
  }
}

document.addEventListener('visibilitychange', () => {
  atualizarTitulo();
});

// ========== INIT ==========

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
});