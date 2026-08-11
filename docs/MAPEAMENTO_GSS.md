# Mapeamento SOTWISE ↔ GSS (`apps.core`)

Confronto entre o schema do GSS (ERD do app Django `apps.core`) e o nosso
([`docs/SCHEMA.md`](SCHEMA.md)), com o glossário confirmado pelo cliente, as
colunas que existem de cada lado e as fricções para a interligação desenhada em
[`docs/INTEGRACAO_GSS.md`](INTEGRACAO_GSS.md).

> ⚠️ **Este documento revisa premissas daquela especificação.** O ERD contradiz
> três coisas que o contrato do §3 assumia: não existe `deleted_at` em modelo
> nenhum, a PK é inteira (não uuid), e `Supplier` não tem `updated_at`. Ver §5.

O ERD tem **24 modelos**. `Category` e `PaymentCondition` aparecem só como caixa,
sem campos — são definidos em outro app e as colunas nos são desconhecidas.

---

## 1. Glossário confirmado

Definido pelo cliente em 2026-08-11:

| Nossa biblioteca | Modelo GSS | Situação |
|---|---|---|
| `agents` | `Agent` | direto |
| `contacts` | **nulo** | não existe no GSS — fica sem fonte |
| `business_units` | `BusinessUnit` | direto |
| `carriers` | `Carrier` | direto |
| `categories` | `Category` | direto (colunas ainda desconhecidas) |
| `factories` | **`SupplierCategory`** | junção supplier × category × city + `code` |
| `cities` | `City` | direto |
| `pols` + `pods` | **`Port`** | as nossas duas tabelas saem da mesma dele |
| `clients` | `Customer` | direto |
| `countries` | `Country` | direto |
| `exporters` | `Exporter` | direto |
| `order_types` | `OrderType` | direto |
| `shipment_models` | — | **ainda vão criar no GSS** |
| — | `Company` | conceito que não temos; o nome dele vai para `client` (§8.1) |

Isso fecha 12 das 14 bibliotecas: `contacts` não tem fonte e `shipment_models`
está por criar. Os demais modelos do ERD (`Currency`, `Family`,
`PaymentCondition`, `Province`, `SalesRepresentative*`, `CustomerConsignee`,
`CustomerImporter`, `Supplier`, `SystemRelease`, `SystemChangelog`) não têm
contrapartida nossa — ver §3.2.

---

## 2. O que os dados provam sobre o glossário

O glossário parecia estranho em dois pontos (`factories` mapear para uma **junção**,
e `pols`/`pods` saírem de uma tabela só). Fui conferir nos dados de produção, e ele
está certo — nossas bibliotecas **não são listas de nomes**: são junções
desnormalizadas, herdadas do Bubble, com o nome repetido em cada linha.

### 2.1 `pols` é (porto × cidade), não uma lista de portos

74 linhas, mas só **23 nomes distintos**. E cada linha tem exatamente **uma**
cidade em `city_pols` (72 têm, 2 estão sem):

| POL | linhas | cidades vinculadas |
|---|---:|---|
| Qingdao | 12 | Rizhao, Linyi, Chongqing, Dezhou, Shandong Jining, Xingtai, Cangzhou, Yangzhou, Liaocheng, Korla, Yiwu, Qingdao |
| Ningbo | 12 | Changzhou, Wenzhou, Taizhou, Lishui, Yiwu, Wuxi, Hangzhou, Yangzhou, Dongguan, Yuhuan, Jiading, Ningbo |
| Shanghai | 12 | Taizhou, Jiangyin, Lishui, Changzhou, Yiwu, Wuxi, Yangzhou, Suzhou, Shanghai, Jiading, Sichuan, Changshu |
| Tianjin | 9 | Renqiu, Langfang, Xingtai, Cangzhou, Liaocheng, Litao, Tianjin, Bazhou, Tangshan |
| Nansha | 5 | Kaiping, Jiangmen, Heshan, Guangzhou, Foshan |
| Chongqing | 5 | (sem cidade), Dadakou, Chongqing, Sichuan, Banan |
| Shenzhen | 3 | Shenzhen, Chongqing, Zhongshan |

Ou seja: **existem 23 portos reais**, e as 74 linhas são o roteamento "esta cidade
de origem embarca por este porto". A nossa `city_pols`, modelada M-N, é usada como
**1-1** — cada linha de `pol` pertence a uma cidade.

Isso levanta uma pergunta de semântica para o GSS: `Port.city` é a **cidade onde o
porto fica** (o normal: Qingdao fica em Qingdao) ou é a **cidade de origem da
carga** (o nosso caso: Qingdao aparece 12 vezes, uma por cidade que embarca por
lá)? São coisas diferentes, e o checklist do Pre-loading depende da segunda para
filtrar o dropdown de POL pela cidade escolhida. Ver §8.2.

`pods` não tem esse problema: 26 linhas, 26 nomes únicos, todos destinos
(Itajaí, Manaus, Belém, Buenos Aires…) — enquanto os `pols` são todos chineses.
É por aí que dá para derivar o discriminador que falta no `Port` (§7).

### 2.2 `factories` é (fornecedor × categoria), não uma lista de fábricas

752 linhas, **700 nomes distintos** — 40 nomes aparecem repetidos, em 92 linhas.
E o que diferencia as linhas repetidas é justamente a **categoria**: **31 dos 40**
nomes duplicados têm conjuntos de categoria diferentes entre si.

```
maoquan     [Clutch, Clutch Disc]                                  [CVT System]
heima       [Engine parts, Small parts]  [Metal Parts]  [Stand]     [Pedal]
tongqing    [Engine parts, Equipment, Filter, Fuel Pump, Hand sw.]  [Hand switch]
xingjie     [Electric parts]                                       [Cable]
```

É exatamente a assinatura de `SupplierCategory`: o mesmo fornecedor entra uma vez
por categoria. O nome que exibimos ("Aideli", "Andeli", "Heima") é nome de
**fornecedor/empresa**, não de uma fábrica específica — o que reforça que a
identidade da linha vem da junção e o nome vem de `Supplier` → `Company`.

Distribuição de categorias por `factory` (823 vínculos em `category_factories`):

| categorias | fábricas |
|---:|---:|
| 0 | 129 |
| 1 | 543 |
| 2 | 56 |
| 3 | 16 |
| 4–50 | 8 |

**543 de 623** com vínculo têm exatamente uma categoria — coerente com "uma linha
por par". As 80 com duas ou mais são o resíduo que não caberia em uma linha de
`SupplierCategory`, e são o ponto de decisão do §6.

### 2.3 Duplicatas e sujeira em todas as bibliotecas

Levantamento completo (produção, 2026-08-11) — importa para o pareamento por nome:

| Tabela | Linhas | Nomes únicos | Nomes duplicados | Nomes vazios |
|---|---:|---:|---|---:|
| `countries` | 3 | 3 | — | 0 |
| `cities` | 51 | 51 | — | 0 |
| `pols` | 74 | **23** | 7 (58 linhas) | 0 |
| `pods` | 26 | 26 | — | 0 |
| `factories` | 752 | 700 | 40 (92 linhas) | 0 |
| `categories` | 115 | 100 | 4 (10 linhas) | **9** |
| `contacts` | 288 | 269 | 14 (30 linhas) | 3 |
| `agents` | 144 | 138 | 6 (12 linhas) | 0 |
| `carriers` | 26 | 26 | — | 0 |
| `clients` | 115 | 115 | — | 0 |
| `exporters` | 4 | 4 | — | 0 |
| `business_units` | 7 | 7 | — | 0 |
| `order_types` | 5 | 5 | — | 0 |
| `shipment_models` | 6 | 6 | — | 0 |

`clients`, `carriers`, `pods`, `cities`, `countries`, `exporters`,
`business_units`, `order_types` estão limpos: pareamento por nome funciona neles
sem ambiguidade. `pols` e `factories` **não podem** ser pareados por nome — ali o
nome não identifica a linha.

---

## 3. Colunas que o GSS tem e nós não

### 3.1 Dentro de entidades que já temos

| Modelo GSS | Coluna | Comentário |
|---|---|---|
| `Country` | `iso_code` | **Vale trazer** — barato e útil |
| `City` | `province` (FK) | Exige criar `provinces` aqui, ou achatar o nome em `cities` |
| `Carrier` | `address` | Endereço da transportadora |
| `Agent` | `address` | Endereço do agente |
| `OrderType` | `description` | Nosso chip usa só o nome |
| `BusinessUnit` | `description` | idem |
| `Customer` | `payment_condition` (FK) | Condição de pagamento — domínio que não temos |
| `SupplierCategory` | **`city`**, **`code`** | A fonte das nossas `factories` carrega cidade e um código que a nossa tabela não tem onde guardar |
| `Supplier` | `is_obsolete`, `obsolete_justification` | Semanticamente **é o nosso soft delete** + o motivo (§5.1) |
| `Exporter` | `company` (FK) | Liga o exportador à empresa |

### 3.2 Entidades inteiras que não temos

| Modelo GSS | Colunas | Comentário |
|---|---|---|
| **`Company`** | `city`, `country`, `province`, `address`, `company_id`, `contact_name`, `email`, `is_consignee`, `is_importer`, `logo`, `name`, `phone`, `short_name` | O hub do modelo deles. Papéis (`Supplier`, `Exporter`, consignatário, importador) penduram nela |
| **`Province`** | `country`, `name` | Nível país → província → cidade |
| **`Currency`** | `code`, `name` | Não temos nada de moeda |
| **`PaymentCondition`** | *(desconhecidas)* | Referenciada por `Customer` |
| **`Family`** | `description`, `name`, `requires_model_application` | Família de produto (?). `requires_model_application` sugere regra que não conhecemos |
| **`SalesRepresentative`** | `name`, `email`, `phone` | Representante comercial |
| **`SalesRepresentativeCustomer`** | `customer`, `representative`, `assigned_date`, `commission_rate` | Carteira + comissão |
| **`CustomerConsignee`** | `company`, `customer`, `active`, `note` | Consignatário de cada cliente |
| **`CustomerImporter`** | `company`, `customer`, `active`, `note` | Importador de cada cliente |
| **`SystemRelease`** / **`SystemChangelog`** | versão, changelog | Versionamento do app **deles** — fora do sync |

**Consignee / Importer merece atenção à parte:** é informação de negócio real (quem
recebe e quem importa a carga de cada cliente) que hoje não existe em lugar nenhum
do SOTWISE — nem em `orders`, nem em `pre_loadings`, nem em `shipments`.

---

## 4. Colunas nossas sem fonte no GSS

A lista que **quebra coisa**: se o GSS é o dono e não manda o campo, ou o insert
falha, ou uma feature em produção para de funcionar.

| Nossa coluna | Gravidade | O que acontece |
|---|---|---|
| `contacts.*` (tabela inteira, 288 linhas) | 🔴 | Glossário confirma: **nulo** no GSS. `agent_contacts` e os campos `contact_brazil_id`/`contact_china_id` do checklist do Pre-loading ficam sem dono |
| `carrier_agents` (junção) | 🔴 | Não existe vínculo Carrier↔Agent no GSS — o filtro "Carrier agent" do Pre-loading perde a base |
| `agents.location` (`brazil`\|`china`) | 🔴 | `Agent` não tem país nem location. Os dropdowns **Agent Brazil / Agent China** filtram por essa coluna: agente sem `location` não aparece |
| `agents.country_id` | 🔴 | Não existe em `Agent`. Era daí que o `location` foi derivado no backfill |
| `exporters.acronym` **NOT NULL** | 🔴 | Não existe em `Exporter`. Sem valor, o upsert falha no banco. Dado real e em uso: `AGK`/AGK, `Zenchum`/ZC, `Zenya`/ZY, `ZAT`/ZT |
| `shipment_models.*` | 🟡 | Vão criar no GSS — resolvido, só depende do prazo |
| `factories.name` | 🟡 | `SupplierCategory` não tem nome, só `code`. O nome vem de `Supplier` → `Company` (`name` ou `short_name`?) — §8.3 |
| `agents.phone_number`, `carriers` | 🟡 | `Agent` e `Carrier` têm `address` e `email`, mas **não têm telefone** |
| `order_types.color` | 🟡 | Não existe lá. Nullable aqui: não quebra o insert, quebra o chip sem cor |
| `order_types.icon_path` / `business_units.icon_path` | 🟡 | `BusinessUnit.icon` é ImageField **no storage deles**; `OrderType` não tem ícone. Arquivo não viaja no sync |
| `contacts.email_na` / `agents.email_na` | 🟡 | Não existe lá. Mapear e-mail vazio → `email_na = true` |
| `clients` sem flag de inativo | 🟡 | `Customer` não tem `active` nem `deleted_at` — não há como o GSS dizer que um cliente saiu |
| `cities` sem província | 🟢 | Perda de informação, não quebra nada |

---

## 5. Premissas do contrato que o ERD derruba

### 5.1 Não existe `deleted_at` em modelo nenhum

O contrato ([INTEGRACAO_GSS §3.2](INTEGRACAO_GSS.md#32-colunas-obrigatórias-em-toda-view))
pedia soft delete. O ERD não tem isso em lugar nenhum. O que existe é
`Supplier.is_obsolete` e `CustomerConsignee/Importer.active` — três modelos. Nos
outros, **excluir é excluir**: a linha desaparece do pull e nós nunca sabemos.

- **`Supplier.is_obsolete` é um achado:** tem exatamente a semântica do nosso
  `deleted_at` (para de ser oferecido, histórico preservado), e
  `obsolete_justification` é informação a mais que hoje não temos.
- **Para o resto, recomendo resolver do nosso lado:** varredura completa
  periódica comparando o conjunto de `id` do GSS com os nossos `gss_id`; o que
  faltar recebe `deleted_at`. Nos volumes atuais (maior tabela: 752 linhas) o full
  scan é irrelevante, e não depende do GSS mudar nada.

### 5.2 PK é `BigAutoField` (inteiro), não uuid

Cabe no nosso `gss_id text` — é só converter. O que morre é o **caminho A do
pareamento inicial**: não dá para o GSS "importar guardando o nosso uuid como id
dele". Substituto que preserva a vantagem: o GSS guarda o nosso uuid num campo
**`sotwise_id`** (indexado, nullable, exposto na view). Pareamento 1:1 exato, e o
`gss_id` continua sendo o `id` inteiro deles.

### 5.3 `Supplier` não tem `updated_at`, e isso contamina `factories`

`SupplierCategory` **herda** `TimeStampedModel` (o ERD mostra `created_at`/
`updated_at` em itálico), então o cursor incremental funciona para ela. Mas
`Supplier` **não herda** — e o *nome* das nossas `factories` vem de
`Supplier` → `Company`. Consequência: se alguém renomear a empresa no GSS,
`SupplierCategory.updated_at` não sobe e a mudança **nunca chega aqui**.

Requisito concreto para a view: expor
`greatest(supplier_category.updated_at, company.updated_at)` como `updated_at`.
Vale a mesma lógica para `Exporter` (nome pode vir de `Company`).

`SalesRepresentativeCustomer` e `SystemChangelog` também não têm timestamps, mas
não entram no sync.

---

## 6. O custo no transacional das duas leituras de "Factories = SupplierCategory"

`SupplierCategory` tem **uma** categoria por linha; 80 das nossas fábricas têm
**duas ou mais**. Então "factory = SupplierCategory" pode significar duas coisas,
com custos diferentes e medidos:

| | **Leitura (i)** — nossa `factory` = uma linha de `SupplierCategory` | **Leitura (ii)** — nossa `factory` = o fornecedor (`Supplier`), e `SupplierCategory` alimenta `category_factories` |
|---|---|---|
| O que acontece com a nossa base | **Dividir** 80 fábricas multi-categoria → +200 linhas novas | **Mesclar** 92 linhas de nome repetido em 40 fábricas |
| Linhas de `order_factory_category` a repontar | **3.754** (39,5% do total) | **2.023** (21,3%) |
| `category_factories` | Vira derivada (1 categoria por fábrica) | Continua M-N, alimentada direto pelo `SupplierCategory` |
| `gss_id` guarda | `SupplierCategory.id` | `Supplier.id` |
| Ganha | `city` e `code` por linha | Nada além do vínculo |
| Nossa estrutura | Muda | **Não muda** |

Em ambos os casos o repontamento é **determinístico**, porque
`order_factory_category` já carrega `category_id` **e** `factory_id` — o par diz
para onde a linha vai. Duas exceções que precisam de decisão manual:

- **215 linhas de OFC (2,3%)** usam um par (fábrica, categoria) que **não existe**
  em `category_factories` — 125 pares órfãos. O pedido afirma uma combinação que a
  biblioteca não conhece.
- **107 linhas de OFC** apontam para uma das **129 fábricas sem categoria nenhuma**.

**Recomendo a leitura (ii):** metade do repontamento, não mexe no nosso schema, e
preserva a junção M-N que as telas já usam. O custo é perder `city`/`code` do
`SupplierCategory` — que hoje não temos onde guardar de qualquer forma.

---

## 7. Fricções por ordem de gravidade

| # | Fricção | Decisão necessária | De quem |
|---:|---|---|---|
| 1 | `contacts` sem fonte (288 + junção + 2 campos do checklist) | O GSS cria `Contact`, **ou** `contacts` fica como exceção mantida no SOTWISE | cliente + GSS |
| 2 | `carrier_agents` sem fonte | O GSS modela o vínculo, ou ele fica local | GSS |
| 3 | `Agent` sem país / `location` | O GSS adiciona país (derivamos `brazil`/`china`), senão o checklist perde os dropdowns de agente | GSS |
| 4 | `exporters.acronym` NOT NULL sem fonte | Campo novo no GSS, ou relaxar o NOT NULL e a sigla passa a ser dado local | nós + GSS |
| 5 | `Port` não separa POL de POD | Discriminador no GSS (`is_loading`/`is_discharge`). Alternativa: derivar pelo país da cidade — nossos POLs são todos chineses e os PODs todos de destino | GSS |
| 6 | Semântica de `Port.city`: cidade do porto ou cidade de origem? (§2.1) | Se for a do porto, o roteamento cidade→POL do checklist não tem fonte | GSS |
| 7 | Leitura (i) vs (ii) de `factories` (§6) | Decisão de modelagem, com 3.754 ou 2.023 linhas de OFC a repontar | cliente + nós |
| 8 | Sem soft delete (§5.1) | Full scan do nosso lado (recomendado) ou `deleted_at` lá | nós |
| 9 | `Company.name` de `Supplier`/`Exporter` não move o `updated_at` (§5.3) | View expõe `greatest(...)` | GSS |
| 10 | Pareamento inicial sem uuid (§5.2) | Campo `sotwise_id` no GSS (recomendado) ou match por nome — que **não funciona** em `pols` e `factories` (§2.3) | GSS |
| 11 | Qual nome vale: `Company.name`, `short_name`, `Exporter.name`, `SupplierCategory.code` | Definir a regra por biblioteca | cliente |
| 12 | 129 fábricas sem categoria e 125 pares órfãos em uso (§6) | Limpeza de dados antes do pareamento | cliente + nós |
| 13 | `Category` e `PaymentCondition` com colunas desconhecidas | Pedir o ERD do outro app | GSS |
| 14 | 9 categorias com nome vazio, 3 contatos sem nome, 2 POLs sem cidade | Limpeza | cliente |
| 15 | `Province` não existe aqui; `SupplierCategory.city`/`code` sem lugar | Ignorar, achatar ou criar tabela | nós |
| 16 | Ícones e `order_types.color` sem fonte | Seguem locais (proposta do §6.4 da especificação) | nós |
| 17 | Telefone de `Agent`/`Carrier` | Aceitar a perda ou pedir o campo | cliente |
| 18 | Consignee / Importer / Currency / PaymentCondition / Family / SalesRepresentative | Decidir o que entra no nosso schema — não bloqueia o sync | cliente |

---

## 8. Perguntas abertas

### 8.1 `Company` → `client`

A nota do glossário diz: *"empresa (não temos no SOT, pegar o `name` e atribuir em
`client`)"*. Duas leituras possíveis, e elas produzem bases diferentes:

- **(a)** `clients.gss_id = Customer.id`, mas `clients.name` vem de
  `Company.name` (o nome legal, em vez do nome comercial do `Customer`). Problema:
  não há FK direta `Customer` → `Company`; o vínculo passa por
  `CustomerConsignee`/`CustomerImporter`, e **um Customer pode ter várias
  Companies**. Qual nome vale?
- **(b)** A nossa lista de `clients` recebe **`Customer` e `Company`**, achatados
  na mesma tabela. Aí o número de clientes cresce muito acima dos 115 atuais, e
  passa a misturar dois conceitos.

### 8.2 `Port.city` (§2.1)

É a cidade **onde o porto fica**, ou a cidade **de origem da carga**? O checklist
do Pre-loading depende da segunda.

### 8.3 Nome das `factories`

Vem de `SupplierCategory.code`, de `Company.name` ou de `Company.short_name`? Os
nossos 700 nomes distintos ("Aideli", "Andeli", "Heima") parecem nome de empresa,
não código.

---

## 9. Leitura de fundo

A diferença entre os dois schemas não é de colunas, é de **normalização**.

O GSS é **Company-cêntrico e normalizado**: existe uma pessoa jurídica única e os
papéis (fornecedor, exportador, consignatário, importador) são vínculos pendurados
nela — o que permite a mesma empresa ser fornecedora e exportadora sem duplicar
cadastro.

O nosso schema veio do Bubble **achatado**: cada junção virou uma lista de nomes
repetidos. Os dados do §2 mostram isso sem margem de dúvida — 74 `pols` para 23
portos reais, 92 linhas de `factories` para 40 fornecedores. Não é um defeito de
digitação: é o modelo do Bubble sendo (fornecedor × categoria) e (porto × cidade)
sem dizer que era.

O bom disso: o glossário do cliente **encaixa perfeitamente** — nossas bibliotecas
são as junções deles. O caro disso: para parear é preciso escolher a granularidade
(§6) e mexer em 2.000–3.700 linhas de `order_factory_category`.

E uma consequência que precisa estar clara: **uma `Company` pode gerar registro em
mais de uma biblioteca nossa** (a mesma empresa como fábrica e como exportadora).
O `gss_id` é unique **por tabela**, então funciona — mas as duas linhas não sabem
que são a mesma empresa. Se em algum momento o SOTWISE precisar dessa riqueza
(relatório por empresa, consignatário no embarque, condição de pagamento no
pedido), o caminho não é esticar as bibliotecas planas: é trazer o conceito de
`Company` para cá. É decisão de produto, não do sync, e não precisa ser tomada
agora.
