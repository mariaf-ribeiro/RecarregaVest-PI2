// Funções auxiliares usadas em várias rotas.

// Data de hoje no formato AAAA-MM-DD, no fuso do computador que roda o servidor.
function hoje() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function dataValida(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto || "") && !Number.isNaN(Date.parse(texto));
}

function textoValido(texto, max) {
  return typeof texto === "string" && texto.trim().length > 0 && texto.trim().length <= max;
}

// Converte erros do MySQL (UNIQUE, gatilhos) em mensagens amigáveis.
function erroMySQL(res, error, mensagens = {}) {
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ erro: mensagens.duplicado || "Esse registro já existe." });
  }
  if (error.sqlState === "45000") {
    // Mensagens dos gatilhos (SIGNAL) da DDL, ex.: "Vagas esgotadas"
    return res.status(409).json({ erro: mensagens.gatilho || error.sqlMessage });
  }
  if (error.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
    return res.status(400).json({ erro: mensagens.check || "Dados inválidos." });
  }
  console.error(error);
  return res.status(500).json({ erro: "Erro interno no servidor." });
}

// Comunidades (mesmos valores do ENUM comunidade.tipo na DDL)
const COMUNIDADES = {
  ciencias_naturais: "Ciências Naturais",
  humanas: "Humanas",
  saude: "Saúde",
  exatas: "Exatas",
  estudo_trabalho: "Estudo-Trabalho",
  geral: "Geral",
  noticias: "Notícias",
  psicologos: "Psicólogos",
  sessoes: "Sessões"
};

module.exports = { hoje, dataValida, textoValido, erroMySQL, COMUNIDADES };
