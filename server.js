require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_TOKEN = process.env.KOMMO_TOKEN;

const RECEPTION_PIPELINE_NAME = process.env.RECEPTION_PIPELINE_NAME || "RECEPCAO";
const SURGERY_PIPELINE_NAME = process.env.SURGERY_PIPELINE_NAME || "EXECUSAO DE CIRURGIA";

const RECEPTION_PIPELINE_ID = process.env.RECEPTION_PIPELINE_ID ? Number(process.env.RECEPTION_PIPELINE_ID) : null;
const SURGERY_PIPELINE_ID = process.env.SURGERY_PIPELINE_ID ? Number(process.env.SURGERY_PIPELINE_ID) : null;

const WON_STATUS_ID = process.env.WON_STATUS_ID ? Number(process.env.WON_STATUS_ID) : null;
const WON_STATUS_NAME = process.env.WON_STATUS_NAME || "Fechado ganho";

function requiredEnv() {
  if (!KOMMO_SUBDOMAIN || !KOMMO_TOKEN) {
    throw new Error("Configure KOMMO_SUBDOMAIN e KOMMO_TOKEN nas variáveis de ambiente.");
  }
}

function toUnixStart(dateString) {
  const d = new Date(`${dateString}T00:00:00`);
  return Math.floor(d.getTime() / 1000);
}

function toUnixEnd(dateString) {
  const d = new Date(`${dateString}T23:59:59`);
  return Math.floor(d.getTime() / 1000);
}

function currentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return { from: fmt(from), to: fmt(to) };
}

async function kommoFetch(endpoint) {
  requiredEnv();

  const url = `https://${KOMMO_SUBDOMAIN}.kommo.com${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${KOMMO_TOKEN}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erro Kommo ${response.status}: ${text}`);
  }

  return response.json();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getFieldValue(lead, wantedNames = [], wantedCodes = []) {
  const fields = lead.custom_fields_values || [];

  const normalizedNames = wantedNames.map(normalize);
  const normalizedCodes = wantedCodes.map(normalize);

  for (const field of fields) {
    const fieldName = normalize(field.field_name);
    const fieldCode = normalize(field.field_code);

    const isMatch =
      normalizedNames.includes(fieldName) ||
      normalizedCodes.includes(fieldCode);

    if (!isMatch) continue;

    const first = field.values && field.values[0];
    if (!first) return "";

    return first.value || first.enum_code || first.enum_id || "";
  }

  return "";
}

function getUtm(lead, key) {
  const map = {
    source: {
      names: ["utm_source", "UTM Source", "UTM_SOURCE", "source"],
      codes: ["UTM_SOURCE"]
    },
    medium: {
      names: ["utm_medium", "UTM Medium", "UTM_MEDIUM", "medium"],
      codes: ["UTM_MEDIUM"]
    },
    campaign: {
      names: ["utm_campaign", "UTM Campaign", "UTM_CAMPAIGN", "campaign"],
      codes: ["UTM_CAMPAIGN"]
    },
    content: {
      names: ["utm_content", "UTM Content", "UTM_CONTENT", "content"],
      codes: ["UTM_CONTENT"]
    }
  };

  return getFieldValue(lead, map[key].names, map[key].codes);
}

async function getPipelines() {
  const data = await kommoFetch("/api/v4/leads/pipelines");
  return data?._embedded?.pipelines || [];
}

function findPipeline(pipelines, preferredId, wantedName) {
  if (preferredId) {
    const byId = pipelines.find((p) => Number(p.id) === Number(preferredId));
    if (byId) return byId;
  }

  const wanted = normalize(wantedName);
  return pipelines.find((p) => normalize(p.name) === wanted || normalize(p.name).includes(wanted));
}

function findWonStatusId(pipeline) {
  if (WON_STATUS_ID) return WON_STATUS_ID;

  const statusesObj = pipeline?._embedded?.statuses || [];
  const statuses = Array.isArray(statusesObj) ? statusesObj : Object.values(statusesObj);

  const exact = statuses.find((s) => normalize(s.name) === normalize(WON_STATUS_NAME));
  if (exact) return Number(exact.id);

  const likely = statuses.find((s) => {
    const name = normalize(s.name);
    return name.includes("ganho") || name.includes("won") || Number(s.id) === 142;
  });

  return likely ? Number(likely.id) : 142;
}

async function getAllLeads({ from, to }) {
  const fromTs = toUnixStart(from);
  const toTs = toUnixEnd(to);

  const all = [];
  let page = 1;
  const limit = 250;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("page", String(page));
    qs.set("limit", String(limit));
    qs.set("filter[created_at][from]", String(fromTs));
    qs.set("filter[created_at][to]", String(toTs));

    const data = await kommoFetch(`/api/v4/leads?${qs.toString()}`);
    const leads = data?._embedded?.leads || [];
    all.push(...leads);

    const next = data?._links?.next?.href;
    if (!next || leads.length === 0) break;

    page += 1;

    // trava de segurança para evitar loop infinito
    if (page > 80) break;
  }

  return all;
}

function campaignKey(campaign, content) {
  return `${campaign || "sem_utm_campaign"}||${content || "sem_utm_content"}`;
}

function makeEmptyRow(campaign, content) {
  return {
    utm_campaign: campaign || "sem_utm_campaign",
    utm_content: content || "sem_utm_content",
    leads_total: 0,
    recepcao_fechado_ganho: 0,
    recepcao_valor_total: 0,
    cirurgia_fechado_ganho: 0,
    cirurgia_valor_total: 0
  };
}

app.get("/api/meta-campaigns", async (req, res) => {
  try {
    const defaultRange = currentMonthRange();

    const from = req.query.from || defaultRange.from;
    const to = req.query.to || defaultRange.to;

    const pipelines = await getPipelines();

    const receptionPipeline = findPipeline(pipelines, RECEPTION_PIPELINE_ID, RECEPTION_PIPELINE_NAME);
    const surgeryPipeline = findPipeline(pipelines, SURGERY_PIPELINE_ID, SURGERY_PIPELINE_NAME);

    if (!receptionPipeline) {
      throw new Error(`Funil de recepção não encontrado. Configure RECEPTION_PIPELINE_ID ou RECEPTION_PIPELINE_NAME.`);
    }

    if (!surgeryPipeline) {
      throw new Error(`Funil EXECUSAO DE CIRURGIA não encontrado. Configure SURGERY_PIPELINE_ID ou SURGERY_PIPELINE_NAME.`);
    }

    const receptionWonStatusId = findWonStatusId(receptionPipeline);
    const surgeryWonStatusId = findWonStatusId(surgeryPipeline);

    const leads = await getAllLeads({ from, to });

    const filtered = leads.filter((lead) => {
      const source = normalize(getUtm(lead, "source"));
      const medium = normalize(getUtm(lead, "medium"));

      return source === "meta_ads" && medium === "mensagem";
    });

    const grouped = {};

    for (const lead of filtered) {
      const campaign = String(getUtm(lead, "campaign") || "").trim();
      const content = String(getUtm(lead, "content") || "").trim();
      const key = campaignKey(campaign, content);

      if (!grouped[key]) grouped[key] = makeEmptyRow(campaign, content);

      grouped[key].leads_total += 1;

      const pipelineId = Number(lead.pipeline_id);
      const statusId = Number(lead.status_id);
      const price = Number(lead.price || 0);

      const isReceptionWon =
        pipelineId === Number(receptionPipeline.id) &&
        statusId === Number(receptionWonStatusId);

      const isSurgeryWon =
        pipelineId === Number(surgeryPipeline.id) &&
        statusId === Number(surgeryWonStatusId);

      if (isReceptionWon) {
        grouped[key].recepcao_fechado_ganho += 1;
        grouped[key].recepcao_valor_total += price;
      }

      if (isSurgeryWon) {
        grouped[key].cirurgia_fechado_ganho += 1;
        grouped[key].cirurgia_valor_total += price;
      }
    }

    const rows = Object.values(grouped).sort((a, b) => b.leads_total - a.leads_total);

    const totals = rows.reduce(
      (acc, row) => {
        acc.leads_total += row.leads_total;
        acc.recepcao_fechado_ganho += row.recepcao_fechado_ganho;
        acc.recepcao_valor_total += row.recepcao_valor_total;
        acc.cirurgia_fechado_ganho += row.cirurgia_fechado_ganho;
        acc.cirurgia_valor_total += row.cirurgia_valor_total;
        return acc;
      },
      {
        leads_total: 0,
        recepcao_fechado_ganho: 0,
        recepcao_valor_total: 0,
        cirurgia_fechado_ganho: 0,
        cirurgia_valor_total: 0
      }
    );

    res.json({
      period: { from, to },
      filters: {
        utm_source: "meta_ads",
        utm_medium: "mensagem"
      },
      pipelines: {
        reception: {
          id: receptionPipeline.id,
          name: receptionPipeline.name,
          won_status_id: receptionWonStatusId
        },
        surgery: {
          id: surgeryPipeline.id,
          name: surgeryPipeline.name,
          won_status_id: surgeryWonStatusId
        }
      },
      totals,
      rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Widget rodando na porta ${PORT}`);
});
