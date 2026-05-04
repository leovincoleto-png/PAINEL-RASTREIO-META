# Widget Kommo - Campanhas Meta Ads

Este projeto cria um painel HTML para inserir na Kommo.

## O que ele mede

Filtro fixo:

- `utm_source = meta_ads`
- `utm_medium = mensagem`

Agrupamento:

- `utm_campaign`
- `utm_content`

Métricas:

- total de leads no período
- leads em Fechado ganho no funil de Recepção
- valor total desses leads
- leads em Fechado ganho no funil EXECUSAO DE CIRURGIA
- valor total desses leads

## Como rodar localmente

```bash
npm install
cp .env.example .env
npm start
```

Abra:

```text
http://localhost:3000
```

## Como subir no Render

1. Suba estes arquivos em um repositório GitHub.
2. No Render, crie um Web Service.
3. Selecione o repositório.
4. Build Command:

```bash
npm install
```

5. Start Command:

```bash
npm start
```

6. Environment Variables:

```text
KOMMO_SUBDOMAIN
KOMMO_TOKEN
PORT
RECEPTION_PIPELINE_NAME
SURGERY_PIPELINE_NAME
WON_STATUS_NAME
```

Opcionalmente, use IDs:

```text
RECEPTION_PIPELINE_ID
SURGERY_PIPELINE_ID
WON_STATUS_ID
```

## Como inserir na Kommo

Depois de publicado no Render, copie a URL pública, exemplo:

```text
https://seu-widget.onrender.com
```

Na Kommo, adicione um widget personalizado no dashboard e cole essa URL.

## Observação sobre período da Kommo

O painel vem com seletor próprio de datas. Em widget HTML externo, a Kommo normalmente não envia automaticamente o período selecionado no dashboard para a sua URL.

## Observação sobre histórico

Este código considera o status atual do lead no funil. Para saber com 100% de precisão se um lead passou por Fechado ganho e depois mudou de funil/etapa, é necessário consultar eventos/histórico da Kommo ou gravar essa passagem via webhook.
