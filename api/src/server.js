const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const MASTER_EMAIL = String(process.env.MASTER_EMAIL || "").toLowerCase();

function isMasterUser(user) {
  if (!user) return false;
  if (String(user.role || "").toLowerCase() === "owner" && !user.accountId) return true;
  return MASTER_EMAIL && String(user.email || "").toLowerCase() === MASTER_EMAIL;
}

async function hasActiveAccess(user) {
  if (!user) return false;
  if (isMasterUser(user)) return true;
  if (!user.accountId) return false;
  const sub = await prisma.subscription.findFirst({
    where: { accountId: user.accountId },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return false;
  if (!["active", "trialing"].includes(String(sub.status || ""))) return false;
  if (!sub.currentPeriodEnd) return true;
  return new Date(sub.currentPeriodEnd).getTime() >= Date.now();
}

function auth(req, res, next) {
  const token = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Nao autenticado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido" });
  }
}

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, service: "neuralhire-api", now: new Date().toISOString() });
});

app.get("/api/setup/status", async (_req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
});

app.post("/api/setup", async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) return res.status(409).json({ error: "Setup ja realizado" });
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email e password obrigatorios" });
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await prisma.user.create({ data: { name, email: String(email).toLowerCase(), passwordHash, role: "admin" } });
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email: String(email || "").toLowerCase() } });
  if (!user) return res.status(401).json({ error: "Credenciais invalidas" });
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Credenciais invalidas" });
  const allowed = await hasActiveAccess(user);
  if (!allowed) return res.status(402).json({ error: "Acesso expirado ou assinatura inativa" });
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get("/api/clientes", auth, async (_req, res) => {
  const clientes = await prisma.cliente.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  res.json(clientes);
});

app.post("/api/clientes", auth, async (req, res) => {
  const { nome, cnpj, cidade, preposto, status } = req.body || {};
  if (!nome) return res.status(400).json({ error: "nome obrigatorio" });
  const cliente = await prisma.cliente.create({ data: { nome, cnpj: (cnpj || "").replace(/\D/g, "") || null, cidade: cidade || null, preposto: preposto || null, status: status || "ativo" } });
  res.status(201).json(cliente);
});

app.get("/api/clientes/:id/dashboard", auth, async (req, res) => {
  const { id } = req.params;
  const cliente = await prisma.cliente.findUnique({ where: { id } });
  if (!cliente) return res.status(404).json({ error: "Cliente nao encontrado" });
  const orders = await prisma.pedido.findMany({
    where: { OR: [{ clienteId: id }, ...(cliente.cnpj ? [{ cnpj: cliente.cnpj }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const totalValue = orders.reduce((sum, o) => sum + Number(o.valorTotal || 0), 0);
  const totalOrders = orders.length;
  const avgTicket = totalOrders ? totalValue / totalOrders : 0;
  res.json({ cliente, orders, metrics: { totalOrders, totalValue, avgTicket } });
});

app.listen(PORT, () => {
  console.log(`API running on :${PORT}`);
});
