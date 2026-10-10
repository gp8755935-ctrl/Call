const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-esse-segredo-em-producao-123';
const EXPIRA_EM = '30d';

// 🔥 Valida se o SECRET é forte em produção
if (process.env.NODE_ENV === 'production' && SECRET.length < 32) {
  console.error('⚠️ JWT_SECRET muito curto em produção! Use pelo menos 32 caracteres.');
  process.exit(1);
}

async function hashearSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function verificarSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

function gerarToken(usuario) {
  if (!usuario || !usuario.id) {
    throw new Error('gerarToken chamado sem usuário válido');
  }
  return jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
    },
    SECRET,
    { expiresIn: EXPIRA_EM }
  );
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (!payload || !payload.id) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashearSenha,
  verificarSenha,
  gerarToken,
  verificarToken,
};