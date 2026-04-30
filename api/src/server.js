const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const MASTER_EMAIL = String(process.env.MASTER_EMAIL || "").toLowerCase();
const MASTER_PASSWORD = String(process.env.MASTER_PASSWORD || "");

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_LEADS_TABLE_URL = process.env.SUPABASE_LEADS_TABLE_URL || "";
const SUPABASE_CLIENTS_TABLE_URL = process.env.SUPABASE_CLIENTS_TABLE_URL || "";
const SUPABASE_SEARCHES_TABLE_URL = process.env.SUPABASE_SEARCHES_TABLE_URL || "";
const SUPABASE_ORDERS_TABLE_URL = process.env.SUPABASE_ORDERS_TABLE_URL || "";
const SUPABASE_ORDER_ITEMS_TABLE_URL = process.env.SUPABASE_ORDER_ITEMS_TABLE_URL || "";

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseFetch(url, options = {}) {
  return fetch(url, { ...options, headers: supabaseHeaders(options.headers || {}) });
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
  res.json({
    ok: true,
    service: "neuralhire-api",
    now: new Date().toISOString(),
    supabaseConfigured: Boolean(SUPABASE_SERVICE_KEY && SUPABASE_CLIENTS_TABLE_URL),
  });
});

app.get("/api/setup/status", async (_req, res) => {
  res.json({ needsSetup: false });
});

app.post("/api/setup", async (_req, res) => {
  res.status(409).json({ error: "Setup desabilitado. Use login master." });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!MASTER_EMAIL || !MASTER_PASSWORD) {
    return res.status(503).json({ error: "MASTER_EMAIL/MASTER_PASSWORD nao configurados" });
  }
  if (String(email || "").toLowerCase() !== MASTER_EMAIL || String(password || "") !== MASTER_PASSWORD) {
    return res.status(401).json({ error: "Credenciais invalidas" });
  }
  const user = { id: "master", name: "Master", email: MASTER_EMAIL, role: "owner" };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user });
});

app.get("/api/clientes", auth, async (_req, res) => {
  if (!SUPABASE_CLIENTS_TABLE_URL) return res.status(503).json({ error: "SUPABASE_CLIENTS_TABLE_URL nao configurado" });
  const url = new URL(SUPABASE_CLIENTS_TABLE_URL);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "500");
  url.searchParams.set("order", "criado_em.desc");
  const response = await supabaseFetch(url.toString());
  const body = await response.text();
  if (!response.ok) return res.status(response.status).send(body || "[]");
  res.type("application/json").send(body || "[]");
});

app.get("/api/clientes/:id/dashboard", auth, async (req, res) => {
  const { id } = req.params;
  if (!SUPABASE_CLIENTS_TABLE_URL || !SUPABASE_ORDERS_TABLE_URL) {
    return res.status(503).json({ error: "Supabase de clientes/pedidos nao configurado" });
  }

  const clientUrl = new URL(SUPABASE_CLIENTS_TABLE_URL);
  clientUrl.searchParams.set("select", "*");
  clientUrl.searchParams.set("id", `eq.${id}`);
  clientUrl.searchParams.set("limit", "1");
  const cResp = await supabaseFetch(clientUrl.toString());
  const cBody = await cResp.text();
  if (!cResp.ok) return res.status(cResp.status).send(cBody || "[]");
  const [cliente] = JSON.parse(cBody || "[]");
  if (!cliente) return res.status(404).json({ error: "Cliente nao encontrado" });

  const orderUrl = new URL(SUPABASE_ORDERS_TABLE_URL);
  orderUrl.searchParams.set("select", "id,numero_rp,data_emissao,situacao,valor_total,valor_comissao,valor_preposto,created_at,cliente_id,cnpj");
  orderUrl.searchParams.set("order", "created_at.desc");
  orderUrl.searchParams.set("limit", "10");
  const ors = [];
  if (cliente.id) ors.push(`cliente_id.eq.${cliente.id}`);
  if (cliente.cnpj) ors.push(`cnpj.eq.${String(cliente.cnpj).replace(/\\D/g, "")}`);
  if (ors.length) orderUrl.searchParams.set("or", `(${ors.join(",")})`);

  const oResp = await supabaseFetch(orderUrl.toString());
  const oBody = await oResp.text();
  if (!oResp.ok) return res.status(oResp.status).send(oBody || "[]");
  const orders = JSON.parse(oBody || "[]");
  const totalValue = orders.reduce((sum, o) => sum + Number(o?.valor_total || 0), 0);
  const totalOrders = orders.length;
  const avgTicket = totalOrders ? totalValue / totalOrders : 0;
  res.json({ cliente, orders, metrics: { totalOrders, totalValue, avgTicket } });
});

app.get("/api/clientes/:id/details", auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!SUPABASE_CLIENTS_TABLE_URL || !SUPABASE_ORDERS_TABLE_URL) {
      return res.status(503).json({ error: "Supabase de clientes/pedidos nao configurado" });
    }

    const clientUrl = new URL(SUPABASE_CLIENTS_TABLE_URL);
    clientUrl.searchParams.set("select", "*");
    clientUrl.searchParams.set("id", `eq.${id}`);
    clientUrl.searchParams.set("limit", "1");
    const cResp = await supabaseFetch(clientUrl.toString());
    const cBody = await cResp.text();
    if (!cResp.ok) return res.status(cResp.status).send(cBody || "[]");
    const [cliente] = JSON.parse(cBody || "[]");
    if (!cliente) return res.status(404).json({ error: "Cliente nao encontrado" });

    const orderUrl = new URL(SUPABASE_ORDERS_TABLE_URL);
    orderUrl.searchParams.set("select", "id,numero_rp,data_emissao,situacao,valor_total,created_at,cliente_id,cnpj");
    orderUrl.searchParams.set("order", "created_at.desc");
    orderUrl.searchParams.set("limit", "300");
    const ors = [];
    if (cliente.id) ors.push(`cliente_id.eq.${cliente.id}`);
    if (cliente.cnpj) ors.push(`cnpj.eq.${String(cliente.cnpj).replace(/\D/g, "")}`);
    if (ors.length) orderUrl.searchParams.set("or", `(${ors.join(",")})`);
    const oResp = await supabaseFetch(orderUrl.toString());
    const oBody = await oResp.text();
    if (!oResp.ok) return res.status(oResp.status).send(oBody || "[]");
    const orders = JSON.parse(oBody || "[]");

    let items = [];
    if (SUPABASE_ORDER_ITEMS_TABLE_URL) {
      const itemUrl = new URL(SUPABASE_ORDER_ITEMS_TABLE_URL);
      itemUrl.searchParams.set("select", "*");
      itemUrl.searchParams.set("limit", "2000");
      const orderNumbers = [...new Set(orders.map((o) => String(o.numero_rp || "").trim()).filter(Boolean))];
      if (orderNumbers.length) itemUrl.searchParams.set("numero_rp", `in.(${orderNumbers.join(",")})`);
      const iResp = await supabaseFetch(itemUrl.toString());
      const iBody = await iResp.text();
      if (iResp.ok) items = JSON.parse(iBody || "[]");
    }

    const totalOrders = orders.length;
    const totalValue = orders.reduce((sum, o) => sum + Number(o?.valor_total || 0), 0);
    const avgTicket = totalOrders ? totalValue / totalOrders : 0;
    const lastPurchaseAt = orders[0]?.data_emissao || orders[0]?.created_at || null;

    const productAgg = new Map();
    for (const item of items) {
      const name = String(item?.produto || item?.descricao || item?.item || "Item sem nome");
      const qty = Number(item?.quantidade || item?.qtd || 1);
      const value = Number(item?.valor_total || item?.valor || 0);
      const curr = productAgg.get(name) || { name, qty: 0, value: 0 };
      curr.qty += qty;
      curr.value += value;
      productAgg.set(name, curr);
    }
    const topItems = [...productAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

    res.json({
      cliente,
      metrics: { totalOrders, totalValue, avgTicket, lastPurchaseAt },
      orders: orders.slice(0, 20),
      topItems,
      mostBoughtItem: topItems[0] || null,
      recentItems: items.slice(0, 20),
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar detalhes do cliente", detail: String(error?.message || error) });
  }
});

app.get("/api/clientes/details-by-cnpj/:cnpj", auth, async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj || "").replace(/\D/g, "");
    if (!cnpj) return res.status(400).json({ error: "CNPJ invalido" });
    if (!SUPABASE_CLIENTS_TABLE_URL || !SUPABASE_ORDERS_TABLE_URL) {
      return res.status(503).json({ error: "Supabase de clientes/pedidos nao configurado" });
    }

    const clientUrl = new URL(SUPABASE_CLIENTS_TABLE_URL);
    clientUrl.searchParams.set("select", "*");
    clientUrl.searchParams.set("cnpj", `eq.${cnpj}`);
    clientUrl.searchParams.set("limit", "1");
    const cResp = await supabaseFetch(clientUrl.toString());
    const cBody = await cResp.text();
    if (!cResp.ok) return res.status(cResp.status).send(cBody || "[]");
    const [cliente] = JSON.parse(cBody || "[]");
    if (!cliente) return res.status(404).json({ error: "Cliente nao encontrado para esse CNPJ" });

    const orderUrl = new URL(SUPABASE_ORDERS_TABLE_URL);
    orderUrl.searchParams.set("select", "id,numero_rp,data_emissao,situacao,valor_total,created_at,cliente_id,cnpj");
    orderUrl.searchParams.set("order", "created_at.desc");
    orderUrl.searchParams.set("limit", "300");
    orderUrl.searchParams.set("or", `(cliente_id.eq.${cliente.id},cnpj.eq.${cnpj})`);
    const oResp = await supabaseFetch(orderUrl.toString());
    const oBody = await oResp.text();
    if (!oResp.ok) return res.status(oResp.status).send(oBody || "[]");
    const orders = JSON.parse(oBody || "[]");

    let items = [];
    if (SUPABASE_ORDER_ITEMS_TABLE_URL) {
      const itemUrl = new URL(SUPABASE_ORDER_ITEMS_TABLE_URL);
      itemUrl.searchParams.set("select", "*");
      itemUrl.searchParams.set("limit", "2000");
      const orderNumbers = [...new Set(orders.map((o) => String(o.numero_rp || "").trim()).filter(Boolean))];
      if (orderNumbers.length) itemUrl.searchParams.set("numero_rp", `in.(${orderNumbers.join(",")})`);
      const iResp = await supabaseFetch(itemUrl.toString());
      const iBody = await iResp.text();
      if (iResp.ok) items = JSON.parse(iBody || "[]");
    }

    const totalOrders = orders.length;
    const totalValue = orders.reduce((sum, o) => sum + Number(o?.valor_total || 0), 0);
    const avgTicket = totalOrders ? totalValue / totalOrders : 0;
    const lastPurchaseAt = orders[0]?.data_emissao || orders[0]?.created_at || null;
    const productAgg = new Map();
    for (const item of items) {
      const name = String(item?.produto || item?.descricao || item?.item || "Item sem nome");
      const qty = Number(item?.quantidade || item?.qtd || 1);
      const value = Number(item?.valor_total || item?.valor || 0);
      const curr = productAgg.get(name) || { name, qty: 0, value: 0 };
      curr.qty += qty;
      curr.value += value;
      productAgg.set(name, curr);
    }
    const topItems = [...productAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    res.json({
      cliente,
      metrics: { totalOrders, totalValue, avgTicket, lastPurchaseAt },
      orders: orders.slice(0, 20),
      topItems,
      mostBoughtItem: topItems[0] || null,
      recentItems: items.slice(0, 20),
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar detalhes por CNPJ", detail: String(error?.message || error) });
  }
});

app.get("/api/dashboard/summary", auth, async (req, res) => {
  try {
    const period = String(req.query.period || "month");
    if (!SUPABASE_CLIENTS_TABLE_URL || !SUPABASE_ORDERS_TABLE_URL || !SUPABASE_LEADS_TABLE_URL) {
      return res.status(503).json({ error: "Supabase nao configurado para dashboard" });
    }

    const [leadsResp, clientsResp, ordersResp] = await Promise.all([
      (async () => {
        const u = new URL(SUPABASE_LEADS_TABLE_URL);
        u.searchParams.set("select", "id");
        u.searchParams.set("limit", "2000");
        return supabaseFetch(u.toString());
      })(),
      (async () => {
        const u = new URL(SUPABASE_CLIENTS_TABLE_URL);
        u.searchParams.set("select", "id,empresa,razao_social,nome_fantasia,cnpj");
        u.searchParams.set("limit", "2000");
        return supabaseFetch(u.toString());
      })(),
      (async () => {
        const u = new URL(SUPABASE_ORDERS_TABLE_URL);
        u.searchParams.set("select", "id,numero_rp,data_emissao,razao_social,cnpj,situacao,valor_total,created_at,cliente_id");
        u.searchParams.set("order", "created_at.desc");
        u.searchParams.set("limit", "3000");
        return supabaseFetch(u.toString());
      })(),
    ]);

    const [leadsBody, clientsBody, ordersBody] = await Promise.all([leadsResp.text(), clientsResp.text(), ordersResp.text()]);
    if (!leadsResp.ok) return res.status(leadsResp.status).send(leadsBody || "[]");
    if (!clientsResp.ok) return res.status(clientsResp.status).send(clientsBody || "[]");
    if (!ordersResp.ok) return res.status(ordersResp.status).send(ordersBody || "[]");

    const leads = JSON.parse(leadsBody || "[]");
    const clients = JSON.parse(clientsBody || "[]");
    const ordersAll = JSON.parse(ordersBody || "[]");

    const now = new Date();
    const start = new Date(now);
    if (period === "week") start.setDate(now.getDate() - 7);
    else if (period === "year") start.setFullYear(now.getFullYear(), 0, 1);
    else start.setMonth(now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const filteredOrders = ordersAll.filter((o) => {
      const d = new Date(o?.data_emissao || o?.created_at || 0);
      return !Number.isNaN(d.getTime()) && d >= start;
    });
    const periodMs = now.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - periodMs);
    const prevEnd = new Date(start.getTime() - 1);
    const previousOrders = ordersAll.filter((o) => {
      const d = new Date(o?.data_emissao || o?.created_at || 0);
      return !Number.isNaN(d.getTime()) && d >= prevStart && d <= prevEnd;
    });

    const totalSales = filteredOrders.reduce((sum, o) => sum + Number(o?.valor_total || 0), 0);
    const previousSales = previousOrders.reduce((sum, o) => sum + Number(o?.valor_total || 0), 0);
    const avgTicket = filteredOrders.length ? totalSales / filteredOrders.length : 0;
    const growthValue = totalSales - previousSales;
    const growthPercent = previousSales > 0 ? (growthValue / previousSales) * 100 : (totalSales > 0 ? 100 : 0);
    const latestOrders = filteredOrders.slice(0, 10);

    const rankingMap = new Map();
    for (const o of filteredOrders) {
      const key = String(o?.cliente_id || o?.cnpj || o?.razao_social || "sem_cliente");
      const name = o?.razao_social || o?.cnpj || "Sem identificacao";
      const curr = rankingMap.get(key) || { key, name, total: 0, orders: 0 };
      curr.total += Number(o?.valor_total || 0);
      curr.orders += 1;
      rankingMap.set(key, curr);
    }
    const topClients = [...rankingMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);

    res.json({
      period,
      summary: {
        leads: leads.length,
        clients: clients.length,
        salesTotal: totalSales,
        ordersCount: filteredOrders.length,
        avgTicket,
        growthValue,
        growthPercent,
      },
      latestOrders,
      topClients,
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar dashboard", detail: String(error?.message || error) });
  }
});

app.listen(PORT, () => {
  console.log(`API running on :${PORT}`);
});
