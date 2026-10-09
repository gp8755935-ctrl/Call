// Helper: gera HTML do avatar (imagem se tiver, inicial colorida se não)
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
        if (canalAtivo) abrirCanal(canalAtivo);
      }
      renderizarCanais();
    }
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
      abrirCanal(data.canais[0]);
    } else {
      canalAtivo = null;
      document.getElementById('chat-canal').innerHTML = '<div class="vazio">Sem canais neste servidor.</div>';
    }

    mostrarTelaCanal();
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

  document.getElementById('titulo-main').textContent = '# ' + canal.nome;

  const r = await fetch(`/api/canais/${canal.id}/mensagens`);
  const data = await r.json();

  const el = document.getElementById('chat-canal');
  el.innerHTML = '';
  (data.mensagens || []).forEach(adicionarMsgCanal);

  document.getElementById('input-canal').focus();
  mostrarTelaCanal();

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

  input.value = '';

  fetch(`/api/canais/${canalAtivo.id}/mensagens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
  }).then(async (r) => {
    if (!r.ok) { alert('Erro ao enviar'); return; }
  });
}

function adicionarMsgCanal(m) {
  const el = document.getElementById('chat-canal');
  const div = document.createElement('div');
  div.className = 'msg-com-avatar';

  div.innerHTML = `
    ${avatarHTML({ nome: m.de_nome, avatar: m.de_avatar })}
    <div class="msg-conteudo">
      <div class="msg-linha">
        <span class="msg-autor">${escapeHtml(m.de_nome)}</span>
        <span class="msg-hora">${formatarHora(m.hora)}</span>
      </div>
      <div class="msg-texto">${escapeHtml(m.texto)}</div>
    </div>
  `;

  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
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
  abrirServidor(data.servidor.id);
}

// ============================================================
// TELAS
// ============================================================

function esconderTelasMain() {
  ['tela-canal', 'tela-dm', 'tela-conversa', 'tela-amigos', 'tela-buscar'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('ativa');
  });
}

function mostrarTelaCanal() {
  esconderTelasMain();
  document.getElementById('tela-canal').classList.add('ativa');
  if (canalAtivo) {
    document.getElementById('titulo-main').textContent = '# ' + canalAtivo.nome;
  }
}

function abrirDM() {
  esconderTelasMain();
  document.getElementById('tela-dm').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '💬 Mensagens diretas';
  carregarConversas();
}

function abrirAmigos() {
  esconderTelasMain();
  document.getElementById('tela-amigos').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '👥 Amigos';
  carregarAmizades();
}

function abrirBuscar() {
  esconderTelasMain();
  document.getElementById('tela-buscar').classList.add('ativa');
  document.getElementById('titulo-main').textContent = '🔍 Buscar usuários';
  setTimeout(() => document.getElementById('busca-input').focus(), 50);
}

function voltarParaServidor() {
  if (canalAtivo) {
    mostrarTelaCanal();
  } else if (servidorAtivo && servidorAtivo.canais.length > 0) {
    abrirCanal(servidorAtivo.canais[0]);
  } else {
    esconderTelasMain();
    document.getElementById('tela-canal').classList.add('ativa');
  }
}

function voltarDMs() {
  conversaAtual = null;
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

function adicionarMsgDM(m) {
  const el = document.getElementById('chat-dm');
  const div = document.createElement('div');
  div.className = 'msg-com-avatar';

  div.innerHTML = `
    ${avatarHTML({ nome: m.de_nome, avatar: m.de_avatar })}
    <div class="msg-conteudo">
      <div class="msg-linha">
        <span class="msg-autor">${escapeHtml(m.de_nome || (m.de_id === meuUsuario.id ? 'Você' : '?'))}</span>
        <span class="msg-hora">${formatarHora(m.hora)}</span>
      </div>
      <div class="msg-texto">${escapeHtml(m.texto)}</div>
    </div>
  `;

  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

async function enviarMsgDM() {
  const input = document.getElementById('input-dm');
  const texto = input.value.trim();
  if (!texto || !conversaAtual) return;
  input.value = '';
  const r = await fetch(`/api/conversas/${conversaAtual.conversa_id}/mensagens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
  });
  const data = await r.json();
  if (!r.ok) { alert(data.erro || 'Erro'); return; }
  adicionarMsgDM(data.mensagem);
}

// ============================================================
// PERFIL / AVATAR / BANNER / BIO
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

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Escolha uma imagem');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;

      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

      const base64 = canvas.toDataURL('image/jpeg', 0.85);

      const r = await fetch('/api/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: base64 }),
      });

      if (!r.ok) { alert('Erro ao salvar avatar'); return; }

      meuUsuario.avatar = base64;
      atualizarPreviewAvatar(meuUsuario);
      atualizarAvataresNaUI();
      tocarSom();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function uploadBanner(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Escolha uma imagem');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      const w = 800, h = 300;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      const ratio = Math.max(w / img.width, h / img.height);
      const nw = img.width * ratio;
      const nh = img.height * ratio;
      const sx = (nw - w) / 2 / ratio;
      const sy = (nh - h) / 2 / ratio;
      const sw = w / ratio;
      const sh = h / ratio;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

      const base64 = canvas.toDataURL('image/jpeg', 0.85);

      const r = await fetch('/api/banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner: base64 }),
      });

      if (!r.ok) { alert('Erro ao salvar banner'); return; }

      meuUsuario.banner = base64;
      atualizarPreviewBanner(meuUsuario);
      tocarSom();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
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
});