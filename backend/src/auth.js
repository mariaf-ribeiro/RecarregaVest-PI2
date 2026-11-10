// Autenticação simples baseada em token assinado (HMAC), sem bibliotecas extras.
// O navegador guarda o token e o envia no cabeçalho "Authorization: Bearer <token>".
const crypto = require("crypto");

const SEGREDO = process.env.SESSION_SECRET || "recarregavest-segredo-local";
const VALIDADE_MS = 8 * 60 * 60 * 1000; // 8 horas

// As senhas da carga inicial (DML) foram gravadas com SHA2(senha, 256),
// então usamos o mesmo algoritmo para manter a compatibilidade.
function hashSenha(senha) {
  return crypto.createHash("sha256").update(String(senha), "utf8").digest("hex");
}

function assinar(dados) {
  return crypto.createHmac("sha256", SEGREDO).update(dados).digest("base64url");
}

function gerarToken(usuario) {
  const payload = Buffer.from(
    JSON.stringify({ id: usuario.id_usuario, tipo: usuario.tipo_perfil, exp: Date.now() + VALIDADE_MS })
  ).toString("base64url");
  return `${payload}.${assinar(payload)}`;
}

function lerToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, assinatura] = token.split(".");
  const esperado = assinar(payload);
  if (
    assinatura.length !== esperado.length ||
    !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))
  ) {
    return null;
  }
  try {
    const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (dados.exp < Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

// Middleware: exige login. Opcionalmente restringe o tipo de perfil.
function exigirLogin(...tiposPermitidos) {
  return (req, res, next) => {
    const cabecalho = req.headers.authorization || "";
    const usuario = lerToken(cabecalho.replace(/^Bearer\s+/i, ""));
    if (!usuario) {
      return res.status(401).json({ erro: "Faça login para continuar." });
    }
    if (tiposPermitidos.length && !tiposPermitidos.includes(usuario.tipo)) {
      return res.status(403).json({ erro: "Seu perfil não tem acesso a esta funcionalidade." });
    }
    req.usuario = usuario;
    next();
  };
}

module.exports = { hashSenha, gerarToken, lerToken, exigirLogin };
