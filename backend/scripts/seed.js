// Carga inicial dos DOIS bancos para a apresentação.
//   npm run seed
// 1) MySQL: executa a DDL e a DML da pasta datebase/mysql (APAGA e recria o banco recarregavest_db)
//    e acrescenta sessões futuras para a demonstração.
// 2) MongoDB: recria as coleções "postagens" e "checklists" (validadores + índices) e insere a carga inicial.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");

const PASTA_SQL = path.join(__dirname, "..", "..", "datebase", "mysql");

// Divide um script SQL em comandos, respeitando "DELIMITER $$" (usado nos gatilhos).
function dividirSQL(texto) {
  const comandos = [];
  let delimitador = ";";
  let atual = "";
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.trim().match(/^DELIMITER\s+(\S+)/i);
    if (m) {
      delimitador = m[1];
      continue;
    }
    atual += linha + "\n";
    let idx;
    while ((idx = atual.indexOf(delimitador)) !== -1) {
      const cmd = atual.slice(0, idx).trim();
      atual = atual.slice(idx + delimitador.length);
      if (cmd.replace(/--.*$/gm, "").trim()) comandos.push(cmd);
    }
  }
  // A DDL não volta para "DELIMITER ;" depois dos gatilhos, então o restante
  // do arquivo (VIEW, CREATE USER, GRANT) ainda é separado por ";".
  for (const cmd of atual.split(";")) {
    if (cmd.replace(/--.*$/gm, "").trim()) comandos.push(cmd.trim());
  }
  return comandos;
}

async function executarArquivo(conexao, nome) {
  const texto = fs.readFileSync(path.join(PASTA_SQL, nome), "utf8");
  const comandos = dividirSQL(texto);
  for (const cmd of comandos) {
    await conexao.query(cmd);
  }
  console.log(`  ✓ ${nome} (${comandos.length} comandos)`);
}

async function seedMySQL() {
  console.log("MySQL:");
  const conexao = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  });
  await executarArquivo(conexao, "DDL - RecarregaVest");
  await executarArquivo(conexao, "DML - RecarregaVest");

  // Extras para a apresentação: sessões FUTURAS (as da DML já passaram)
  await conexao.query(`USE recarregavest_db`);
  await conexao.query(
    `INSERT INTO sessao (titulo, data_hora, link_acesso, limite_vagas, fk_id_psicologo) VALUES
      ('Sessão de dicas e rotinas', DATE_ADD(CURDATE(), INTERVAL '1 19' DAY_HOUR), 'https://meet.google.com/', 20, 2),
      ('Ansiedade na reta final do vestibular', DATE_ADD(CURDATE(), INTERVAL '3 18' DAY_HOUR), 'https://meet.google.com/', 15, 3),
      ('Como lidar com a comparação nas redes', DATE_ADD(CURDATE(), INTERVAL '5 17' DAY_HOUR), 'https://meet.google.com/', 2, 4),
      ('Respiração e foco antes da prova', DATE_ADD(CURDATE(), INTERVAL '8 10' DAY_HOUR), 'https://meet.google.com/', 10, 2)`
  );
  // (o gatilho de vagas lê a tabela sessao, por isso buscamos o id antes do INSERT)
  const [[sessaoCheia]] = await conexao.query(
    `SELECT id_sessao FROM sessao WHERE titulo = 'Como lidar com a comparação nas redes'`
  );
  await conexao.query(`INSERT INTO participa_sessao (fk_id_sessao, fk_id_vestibulando) VALUES (?, 7)`, [
    sessaoCheia.id_sessao
  ]);
  console.log("  ✓ sessões futuras de demonstração");
  await conexao.end();
}

// Cria a coleção com validador $jsonSchema. Se o servidor não suportar
// validadores (ex.: alguns serviços compatíveis com MongoDB), cria sem ele e avisa.
async function criarColecao(db, nome, opcoes) {
  try {
    await db.createCollection(nome, opcoes);
  } catch (error) {
    if (!/not implemented|not supported/i.test(error.message)) throw error;
    console.warn(`  ! servidor sem suporte a validador; coleção "${nome}" criada sem $jsonSchema`);
    await db.createCollection(nome);
  }
}

async function seedMongo() {
  console.log("MongoDB:");
  const cliente = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");
  await cliente.connect();
  const db = cliente.db(process.env.MONGO_DATABASE || "recarregavest_nosql");

  const existentes = (await db.listCollections().toArray()).map((c) => c.name);
  for (const nome of ["postagens", "checklists"]) {
    if (existentes.includes(nome)) await db.collection(nome).drop();
  }

  const TIPOS_COMUNIDADE = [
    "ciencias_naturais", "humanas", "saude", "exatas", "estudo_trabalho",
    "geral", "noticias", "psicologos", "sessoes"
  ];

  // autorId e vestibulandoId guardam o MESMO id inteiro do usuário no MySQL (referência lógica)
  await criarColecao(db, "postagens", {
    validationLevel: "strict",
    validationAction: "error",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["autorId", "comunidadeId", "texto", "tipo", "dataCriacao"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "objectId" },
          autorId: { bsonType: "int", minimum: 1 },
          comunidadeId: { enum: TIPOS_COMUNIDADE },
          texto: { bsonType: "string", minLength: 1, maxLength: 1000, pattern: "\\S" },
          tipo: { bsonType: "string", minLength: 1, maxLength: 45 },
          urlExterna: { bsonType: ["string", "null"], maxLength: 255 },
          dataCriacao: { bsonType: "date" }
        }
      }
    }
  });
  await criarColecao(db, "checklists", {
    validationLevel: "strict",
    validationAction: "error",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["vestibulandoId", "data", "itens"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "objectId" },
          vestibulandoId: { bsonType: "int", minimum: 1 },
          data: { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
          itens: {
            bsonType: "array",
            minItems: 0, // 0 para aceitar o index.js original dos testes de carga, que cria o dia com itens: []
            uniqueItems: true,
            items: {
              bsonType: "object",
              additionalProperties: false,
              required: ["descricao", "realizado"],
              properties: {
                descricao: { bsonType: "string", minLength: 1, maxLength: 150 },
                realizado: { bsonType: "bool" }
              }
            }
          }
        }
      }
    }
  });

  await db.collection("postagens").createIndex(
    { autorId: 1, comunidadeId: 1, dataCriacao: 1 },
    { unique: true, name: "uk_postagens_autor_comunidade_data" }
  );
  await db.collection("postagens").createIndex(
    { comunidadeId: 1, dataCriacao: -1 },
    { name: "idx_postagens_comunidade_data" }
  );
  await db.collection("checklists").createIndex(
    { vestibulandoId: 1, data: -1 },
    { unique: true, name: "uk_checklists_vestibulando_data" }
  );

  const agora = Date.now();
  const horasAtras = (h) => new Date(agora - h * 3600 * 1000);
  await db.collection("postagens").insertMany([
    { autorId: 2, comunidadeId: "psicologos", texto: "Bem-vindos à comunidade de psicólogos voluntários do RecarregaVest!", tipo: "texto", urlExterna: null, dataCriacao: new Date("2026-09-21T13:00:00Z") },
    { autorId: 2, comunidadeId: "sessoes", texto: "Abrimos uma nova sessão sobre ansiedade. Inscrevam-se!", tipo: "link", urlExterna: "https://meet.example.com/ansiedade-1", dataCriacao: new Date("2026-09-28T12:00:00Z") },
    { autorId: 6, comunidadeId: "saude", texto: "Alguém tem dicas para revisar Biologia em pouco tempo?", tipo: "texto", urlExterna: null, dataCriacao: new Date("2026-09-29T23:15:00Z") },
    { autorId: 8, comunidadeId: "geral", texto: "Sugestão de playlist para relaxar antes de dormir.", tipo: "link", urlExterna: "https://open.spotify.com/", dataCriacao: new Date("2026-10-01T01:00:00Z") },
    { autorId: 7, comunidadeId: "exatas", texto: "Resolvi 20 questões de Física hoje, foi difícil mas valeu!", tipo: "texto", urlExterna: null, dataCriacao: new Date("2026-10-01T21:40:00Z") },
    { autorId: 3, comunidadeId: "estudo_trabalho", texto: "Lembrem de fazer pausas: 50 minutos de estudo, 10 de descanso.", tipo: "texto", urlExterna: null, dataCriacao: new Date("2026-10-02T11:00:00Z") },
    // Extras para a apresentação (iguais aos exemplos do Figma)
    { autorId: 9, comunidadeId: "ciencias_naturais", texto: "É muito doido pensar que a gente ainda conhece tão pouco sobre a biodiversidade do nosso próprio planeta.", tipo: "texto", urlExterna: null, dataCriacao: horasAtras(5) },
    { autorId: 1, comunidadeId: "noticias", texto: "ENEM 2026: inscrições encerradas. Prazo também vale para quem pediu atendimento por nome social.", tipo: "texto", urlExterna: null, dataCriacao: horasAtras(30) },
    { autorId: 10, comunidadeId: "humanas", texto: "Alguém tem um resumo bom de Revolução Industrial? Estou montando meus mapas mentais.", tipo: "texto", urlExterna: null, dataCriacao: horasAtras(12) },
    { autorId: 6, comunidadeId: "geral", texto: "Hoje consegui seguir minha rotina inteira! Pequenas vitórias contam.", tipo: "texto", urlExterna: null, dataCriacao: horasAtras(2) }
  ]);
  console.log("  ✓ postagens");

  await db.collection("checklists").insertMany([
    { vestibulandoId: 6, data: "2026-10-05", itens: [
      { descricao: "Beber 2 litros de água", realizado: true },
      { descricao: "Dormir pelo menos 7 horas", realizado: false },
      { descricao: "Caminhar 20 minutos", realizado: false }
    ] },
    { vestibulandoId: 7, data: "2026-10-05", itens: [
      { descricao: "Beber 2 litros de água", realizado: true },
      { descricao: "Dormir pelo menos 7 horas", realizado: true }
    ] },
    { vestibulandoId: 8, data: "2026-10-05", itens: [
      { descricao: "Fazer uma pausa sem telas", realizado: false }
    ] }
  ]);
  console.log("  ✓ checklists");
  await cliente.close();
}

(async () => {
  try {
    await seedMySQL();
    await seedMongo();
    console.log("\nPronto! Bancos carregados. Agora rode:  npm start");
    console.log("Logins de teste (senhas da DML):");
    console.log("  Estudante:     carla.souza@exemplo.com  /  Senha@201");
    console.log("  Psicóloga:     CRP 05/10001             /  Senha@101");
    console.log("  Administrador: admin@recarregavest.com.br / Admin@2026");
  } catch (error) {
    console.error("\nErro na carga:", error.message);
    process.exit(1);
  }
})();
