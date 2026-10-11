// ============================================================
// HELPERS
// ============================================================

function avatarHTML(usuario, classe = '', onclick = null) {
  if (!usuario) return '';
  const cls = 'avatar ' + classe;
  const attr = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : '';

  // 🔥 SE TEM FOTO → mostra a foto e NUNCA muda com o tema
  if (usuario.avatar) {
    return `<div class="${cls} com-imagem"${attr}><img src="${usuario.avatar}" alt=""></div>`;
  }

  // 🔥 SE NÃO TEM FOTO → gera inicial com cor baseada no tema
  const inicial = (usuario.nome || '?').charAt(0).toUpperCase();
  const escuro = document.body.classList.contains('tema-escuro');

  const coresClaro = ['#0284c7', '#0891b2', '#16a34a', '#7c3aed', '#db2777', '#ea580c'];
  const coresEscuro = ['#1e5a8e', '#155e75', '#15803d', '#5b21b6', '#9d174d', '#9a3412'];
  const cores = escuro ? coresEscuro : coresClaro;

  const cor = cores[(usuario.nome || '').charCodeAt(0) % cores.length];
  const corFim = escuro ? cor + 'aa' : cor + '99';

  const estiloExtra = onclick ? '; cursor:pointer' : '';
  const sombra = escuro ? 'box-shadow: 0 0 12px rgba(14, 165, 233, 0.4);' : '';

  return `<div class="${cls}"${attr} style="background: linear-gradient(180deg, ${corFim}, ${cor}); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.4); ${sombra}${estiloExtra}">${inicial}</div>`;
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

const CONFIG_PADRAO = { somMsg: true, somReacao: true, notifVisual: true, notifSistema: true, digitando: true, darkMode: false };
let config = { ...CONFIG_PADRAO };

// 🔥 Aplica tema E re-renderiza avatares
function aplicarTema(escuro) {
  if (escuro) {
    document.body.classList.add('tema-escuro');
  } else {
    document.body.classList.remove('tema-escuro');
  }

  if (typeof atualizarAvataresNaUI === 'function' && meuUsuario) atualizarAvataresNaUI();
  if (typeof renderizarMembros === 'function' && servidorAtivo) renderizarMembros();
  if (typeof carregarAmizades === 'function' && meuUsuario) carregarAmizades();
  if (typeof carregarConversas === 'function' && meuUsuario) carregarConversas();
  if (typeof atualizarPreviewAvatar === 'function' && meuUsuario) atualizarPreviewAvatar(meuUsuario);
  if (typeof renderizarServidores === 'function') renderizarServidores();
}

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
  const ids = { somMsg: 'cfg-som-msg', somReacao: 'cfg-som-reacao', notifVisual: 'cfg-notif-visual', notifSistema: 'cfg-notif-sistema', digitando: 'cfg-digitando', darkMode: 'cfg-dark-mode' };
  for (const [chave, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!config[chave];
  }
  aplicarTema(config.darkMode);
}

function abrirConfig() {
  aplicarConfigNaUI();
  document.getElementById('modal-config').classList.add('ativo');
}

function fecharConfig() {
  document.getElementById('modal-config').classList.remove('ativo');
}

function bindConfig() {
  const ids = { somMsg: 'cfg-som-msg', somReacao: 'cfg-som-reacao', notifVisual: 'cfg-notif-visual', notifSistema: 'cfg-notif-sistema', digitando: 'cfg-digitando', darkMode: 'cfg-dark-mode' };
  for (const [chave, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      config[chave] = el.checked;
      salvarConfig();
      if (chave === 'notifSistema' && el.checked) pedirPermissaoNotificacoes();
      if (chave === 'darkMode') aplicarTema(el.checked);
    });
  }
}