require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 20
});

const mongoClient = new MongoClient(process.env.MONGO_URI);
let mongoDB;

app.get("/", (req, res) => {
  res.json({
    mensagem: "API experimental do RecarregaVest funcionando!"
  });
});

app.get("/api/comunidades/:comunidadeId/postagens", async (req, res) => {
  try {
    const { comunidadeId } = req.params;

    const postagens = await mongoDB
      .collection("postagens")
      .find({ comunidadeId })
      .sort({ dataCriacao: -1 })
      .limit(100)
      .toArray();

    res.json({ total: postagens.length, postagens });
  } catch (error) {
    console.error("Erro ao consultar postagens:", error);
    res.status(500).json({ erro: "Erro ao consultar postagens." });
  }
});

app.post("/api/checklists/:vestibulandoId/itens", async (req, res) => {
  try {
    const vestibulandoId = Number(req.params.vestibulandoId);
    const { data, descricao } = req.body;

    if (
      !Number.isInteger(vestibulandoId) ||
      vestibulandoId < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data || "") ||
      typeof descricao !== "string" ||
      !descricao.trim() ||
      descricao.length > 150
    ) {
      return res.status(400).json({
        erro: "Informe um usuário válido, uma data AAAA-MM-DD e uma descrição de até 150 caracteres."
      });
    }

    const colecao = mongoDB.collection("checklists");

    try {
      await colecao.updateOne(
        { vestibulandoId, data },
        {
          $setOnInsert: {
            vestibulandoId,
            data,
            itens: []
          }
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }

    const resultado = await colecao.updateOne(
      { vestibulandoId, data },
      {
        $addToSet: {
          itens: {
            descricao: descricao.trim(),
            realizado: false
          }
        }
      }
    );

    res.status(200).json({
      mensagem: "Operação de checklist concluída.",
      inserido: resultado.modifiedCount === 1,
      itensModificados: resultado.modifiedCount
    });
  } catch (error) {
    console.error("Erro ao atualizar checklist:", error);
    res.status(500).json({ erro: "Erro ao atualizar checklist." });
  }
});

async function iniciar() {
  try {
    await mysqlPool.query("SELECT 1");
    console.log("MySQL conectado!");

    await mongoClient.connect();
    mongoDB = mongoClient.db("recarregavest_nosql");
    await mongoDB.command({ ping: 1 });
    console.log("MongoDB conectado!");

    const porta = Number(process.env.PORT) || 3000;

    app.listen(porta, () => {
      console.log(`API RecarregaVest disponível na porta ${porta}.`);
    });
  } catch (error) {
    console.error("Falha ao iniciar a API:", error);
    process.exit(1);
  }
}

iniciar();
