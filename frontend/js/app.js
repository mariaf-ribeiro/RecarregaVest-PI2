// =====================================================================
// RecarregaVest - funções compartilhadas por todas as páginas
// (chamadas à API, login, menu, botão Sair, avisos e avatares)
// =====================================================================

const RV = {
  token: () => localStorage.getItem("rv_token"),
  usuario: () => {
    try {
      return JSON.parse(localStorage.getItem("rv_usuario"));
    } catch {
      return null;
    }
  },
  salvarLogin(token, usuario) {
    localStorage.setItem("rv_token", token);
    localStorage.setItem("rv_usuario", JSON.stringify(usuario));
  },
  atualizarUsuario(usuario) {
    localStorage.setItem("rv_usuario", JSON.stringify(usuario));
  },
  sair() {
    localStorage.removeItem("rv_token");
    localStorage.removeItem("rv_usuario");
    window.location.href = "login.html";
  }
};

// Chamada à API. Ex.: await api("GET", "/api/rotina")
async function api(metodo, caminho, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (RV.token()) opcoes.headers.Authorization = "Bearer " + RV.token();
  if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  let resposta;
  try {
    resposta = await fetch(caminho, opcoes);
  } catch {
    throw new Error("Não foi possível falar com o servidor. Ele está ligado?");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && RV.token()) {
    RV.sair(); // sessão expirou
  }
  if (!resposta.ok) throw new Error(dados.erro || "Algo deu errado.");
  return dados;
}

// Página inicial de cada perfil
function paginaInicial(tipo) {
  if (tipo === "psicologo") return "psicologo.html";
  if (tipo === "administrador") return "admin.html";
  return "inicio.html";
}

// Bloqueia páginas que exigem login (e, opcionalmente, um perfil específico)
function protegerPagina(...tipos) {
  const usuario = RV.usuario();
  if (!RV.token() || !usuario) {
    window.location.href = "login.html";
    return null;
  }
  if (tipos.length && !tipos.includes(usuario.tipo_perfil)) {
    window.location.href = paginaInicial(usuario.tipo_perfil);
    return null;
  }
  return usuario;
}

// Menu azul do estudante (igual ao Figma). Use <nav id="menu" data-ativo="rotina"></nav>
function montarMenu() {
  const nav = document.getElementById("menu");
  if (!nav) return;
  const itens = [
    ["inicio", "inicio.html", "Página inicial"],
    ["comunidades", "comunidades.html", "Comunidades"],
    ["rotina", "rotina.html", "Rotina"],
    ["calendario", "calendario.html", "Calendário"],
    ["checklist", "checklist.html", "Checklist"],
    ["perfil", "perfil.html", "Seu Perfil"],
    ["dicas", "dicas.html", "Dicas"]
  ];
  nav.className = "menu";
  nav.innerHTML =
    itens
      .map(([id, href, texto]) => `<a href="${href}" class="${nav.dataset.ativo === id ? "ativo" : ""}">${texto}</a>`)
      .join("") + `<button type="button" onclick="confirmarSair()">Sair</button>`;
}

// Tela "Sair da conta" (modal pêssego do Figma)
function confirmarSair() {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo";
  fundo.innerHTML = `
    <div class="modal modal-sair" role="dialog" aria-modal="true">
      <p>Tem certeza que deseja sair da sua conta?</p>
      <div class="acoes">
        <button class="btn" id="sim-sair">Sair</button>
        <button class="btn" id="nao-sair">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);
  fundo.querySelector("#sim-sair").onclick = RV.sair;
  fundo.querySelector("#nao-sair").onclick = () => fundo.remove();
  fundo.onclick = (e) => e.target === fundo && fundo.remove();
}

// Aviso rápido no rodapé
function avisar(mensagem, erro = false) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = mensagem;
  toast.className = "mostrar" + (erro ? " erro" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toast.className = ""), 3200);
}

// Avatares (guardados em usuario.foto_perfil como "avatar-1" ... "avatar-6")
const CORES_AVATAR = ["#2a4bb0", "#f7931e", "#7a3e0e", "#4f68c9", "#2e9e5b", "#c2417a"];
function avatarSVG(id, tamanho = 120) {
  const n = Number(String(id || "").replace("avatar-", "")) || 0;
  const cor = n ? CORES_AVATAR[(n - 1) % CORES_AVATAR.length] : "#b8bec9";
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="56" fill="#fff" stroke="${cor}" stroke-width="8"/>
    <circle cx="60" cy="48" r="20" fill="${cor}"/>
    <path d="M22 98c6-20 22-30 38-30s32 10 38 30" fill="${cor}"/>
  </svg>`;
}

// Mostrar/ocultar senha (botão 👁)
function ligarOlhoSenha() {
  document.querySelectorAll(".senha-wrap button").forEach((botao) => {
    botao.onclick = () => {
      const input = botao.previousElementSibling;
      input.type = input.type === "password" ? "text" : "password";
    };
  });
}

// Evita injeção de HTML ao mostrar textos digitados por usuários
function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

document.addEventListener("DOMContentLoaded", montarMenu);
