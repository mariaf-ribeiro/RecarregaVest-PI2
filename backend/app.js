// Servidor COMPLETO do RecarregaVest: entrega o site (pasta frontend) e a API (/api/...)
// Para rodar:  npm install  ->  npm run seed (só na primeira vez)  ->  npm start
//
// Obs.: o arquivo index.js (API experimental usada nos testes de carga da Fase E)
// foi mantido sem alterações. Para os testes do k6 com a versão original: node index.js
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const path = require("path");
const express = require("express");
const { conectar } = require("./src/db");

const app = express();
app.use(express.json());

// ---------- API ----------
app.get("/api", (req, res) => {
  res.json({ mensagem: "API do RecarregaVest funcionando!" });
});
app.use("/api", require("./src/routes/usuarios"));
app.use("/api", require("./src/routes/vestibulando"));
app.use("/api", require("./src/routes/checklist"));
app.use("/api", require("./src/routes/comunidades"));

app.use("/api", (req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

// ---------- Site (HTML, CSS e JS da pasta frontend) ----------
app.use(express.static(path.join(__dirname, "..", "frontend"), { extensions: ["html"] }));

async function iniciar() {
  try {
    await conectar();
    const porta = Number(process.env.PORT) || 3000;
    app.listen(porta, () => {
      console.log(`\nRecarregaVest rodando! Abra no navegador: http://localhost:${porta}\n`);
    });
  } catch (error) {
    console.error("\nFalha ao iniciar. Confira se o MySQL e o MongoDB estão ligados e se o arquivo .env está correto.");
    console.error(error.message);
    process.exit(1);
  }
}

iniciar();
