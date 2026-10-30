# WOS — HUD (tema "kit artesanal", agente N)

Referência do dono: `docs/ref/hud-reference.jpg`. Linguagem visual: formas em **creme / pergaminho** com
**contorno de tinta marrom-escura**, sobre fundo **casca** (marrom), acentos **coral · laranja · mostarda ·
verde-água · oliva**, **hachura desenhada à mão** atrás dos elementos, **números condensados em itálico
negrito**, losangos, fitas inclinadas com **ponta brilhante**, anéis segmentados e etiquetas penduradas.
Nada de retângulos escuros translúcidos com desfoque nem pílulas na fonte do sistema.

## Camadas

| Arquivo | O quê |
|---|---|
| `src/ui/hud-theme.css` | fonte, **tokens**, primitivas `.n-*`, peles da UI injetada por outros módulos (barra de construção e menu de contexto do A, Detalhes do K, barra de caminhos do M, avisos `notify.js`, mira do G) |
| `src/ui/hud.css` | layout + peles do HUD em jogo (cartão, alvo, radar, barra de ações, atalhos, janelas, dicas, ajuda, morte) |
| `src/ui/menu.css` | menu principal (layout do B), pausa, configurações, sala, chat, aviso de instalação — seção final "N · theme alignment" |
| `src/ui/hud-icons.css` | **ícones** (carregado por último): glifos em negrito com contorno de tinta (`icons.js` `glyph`), halos e placas nos botões de toque, tamanhos dos glifos, contorno nos sprites de itens/construções |
| `src/ui/hudtheme.js` | `installHudTheme()`: texturas procedurais (`--n-hatch` hachura, `--n-grain` papel) e o sprite de símbolos SVG (`nIcon(nome)` → `<svg><use href="#n-nome"/></svg>`) |
| `src/ui/radar.js` | o radar (minimapa elíptico + arco do sol + gotas na borda) |
| `vendor/barlow-condensed/` | fonte Barlow Condensed (OFL 1.1, `@fontsource/barlow-condensed` 5.2.6): 600, 700, 700 itálico, 800 itálico |

Estilos de outros módulos são acrescentados depois no `<head>`; as peles em `hud-theme.css` usam um
seletor um pouco mais específico (`html …`, `html :is(#hud, body) …`) para ganhar sem `!important`.
O reset de botões do HUD é `:where(#hud) button` (especificidade zero): classes de componentes ganham sozinhas.

## Tokens (`:root`)

| Token | Valor | Uso |
|---|---|---|
| `--n-ink` | `#24160d` | contornos, texto sobre creme |
| `--n-ink-2` | `#33200f` | trilho das barras, fundo profundo |
| `--n-bark` / `--n-bark-2` / `--n-bark-3` | `#4a2f1b` / `#5f3d23` / `#3b2615` | placas, hover, corpo de janela |
| `--n-cream` / `--n-cream-hi` / `--n-cream-lo` | `#f2e4c4` / `#fff7e6` / `#d8c294` | pergaminho, realces, sombra do pergaminho |
| `--n-text` / `--n-text-2` / `--n-text-3` | `#f4e9d2` / `#c9b48c` / `#7a5c3c` | texto no escuro, apagado no escuro, apagado no creme |
| `--n-coral` (`-hi`, `-lo`) | `#e5574a` | vida, hostil, fechar, perigo |
| `--n-orange` | `#ec8b3b` | calor do corpo, casa, aviso |
| `--n-mustard` | `#e2b443` | energia, neutro, primário, XP, nível |
| `--n-teal` | `#3fa89c` | jogadores / amigos, ativo, atualização, frio |
| `--n-olive` | `#93b04c` | fome, passivo, confirmar, bom |
| `--n-sky` | `#8cc6e8` | frio extremo, sem energia |
| `--n-glow` / `--n-glow-c` | `#fff4e4` / rosado | ponta brilhante e halo |
| `--n-glass` / `--n-glass-ring` / `--n-glass-on` | | botões de vidro no toque (fundo, anel creme, estado opaco) |
| `--n-fd` | Barlow Condensed… | fonte de toda a interface |
| `--n-drop` | sombra dura + suave | "peça recortada" |
| `--n-ts` / `--n-ts-soft` | | contorno de tinta no texto sobre o mundo |
| `--n-tile` / `--n-tile-full` / `--n-tile-on` | SVG | ladrilho chanfrado (atalhos, espaços da mochila, ícones de cartões) |

Os tokens antigos (`--panel`, `--border`, `--text`, `--muted`, `--accent`, `--hostile`…) foram remapeados para o tema,
então UI que ainda os usa já sai na paleta.

## Primitivas (use em UI nova)

- `.n-panel` + `.n-head` — corpo de janela (casca, contorno, linha creme interna, grão) e faixa de título em pergaminho.
- `.n-btn` (`.primary` mostarda · `.ok` oliva · `.danger` coral) — placa inclinada com contorno (o formato é um `::before` com `skewX`).
- `.n-tag` (`.cream` · `.coral` · `.teal`) — etiqueta inclinada (paralelogramo), como "DIA 6" e o relógio.
- `.n-key` / `kbd` — tecla de pergaminho; nos botões do HUD a tecla é uma **flâmula pendurada** (`.qb .qk`, `.ab .key`).
- `.n-coin` — moeda (contadores, nível).
- `.n-hatch` — nuvem de hachura atrás do elemento (máscara radial).
- `.n-glass` — controle de toque translúcido (`.down` / `.hot` = opaco).
- `.n-num` — numerais condensados em itálico.

## Componentes

- **Cartão do jogador** `#pf`: retrato em **losango** creme com dupla moldura e chevrons laterais (o canvas `#pf-face`
  é recortado em losango), **moeda de nível** `#pf-lv` na ponta de baixo, nome em caixa alta, etiqueta de **°C** (`.tmp`:
  `.cold` verde-água, `.freeze` céu pulsando, `.hot` laranja, `.wet`). Fitas `.rb > .bar` inclinadas (vida coral, energia
  mostarda, fome oliva, calor laranja → céu com `.low` e o ícone vira floco), cada uma com o **emblema** na ponta
  esquerda (`.cap`, símbolos `heart/bolt/food/flame/snow/star`). A barra `#pf-xp` é a fita fina creme. Em combate o losango ganha
  contorno coral e brilho.
- **Barras**: `hud.js setBar` move o preenchimento `<i>` com `translateX` (não `scaleX`), então o fim inclinado e a **ponta
  brilhante** (`i::after`) acompanham o valor. Barras de fila / conjuração continuam com `scaleX` (sem ponta).
- **Alvo** `#tf`: losango menor, nome e fita na cor do temperamento, moeda de nível escura com a cor de dificuldade,
  barra de conjuração e debuffs em losangos, botão limpar = losango coral.
- **Buffs** `.bf`: losangos com moldura oliva (bom) / coral (ruim) e o tempo numa flâmula.
- **Botões rápidos** `.qb`: moedas com anel creme; no toque são vidro translúcido; no PC ficam no canto inferior direito com
  a tecla pendurada.
- **Botões do sistema** `.sb` (☰ tela cheia instalar ajuda): losangos (alvo de toque 44 px).
- **Radar** `#radar` (radar.js) — ver abaixo.
- **Barra de ações** `#ab`: ataque com **bisel entalhado** (`.ab-atk`, coral quando `.on`); habilidades com **anel de
  recarga segmentado** (24 segmentos em `.cd::before`, a parte que falta escurece, `.cd::after` = tique brilhante na
  fronteira, `--p` vindo do actionbar.js), número da recarga em itálico, custo, munição em moeda, tecla pendurada no PC.
  Estados: `.cool` (recarregando), `.gcd`, `.noen` (anel céu), `.far` (anel coral), `.queued` (mostarda), `.active` (verde-água),
  `.nostock`, `.ready` (pulso). **Interagir** `.ab-int` é um **losango** creme com o verbo numa etiqueta pendurada (no PC, uma
  etiqueta de pergaminho com a tecla E).
- **Toque translúcido (pedido do dono)**: no celular os botões de ação, os rápidos e os do sistema são vidro (`--n-glass`)
  com anel creme; ficam opacos só quando pressionados (`.down`), recarregando (`.cool`), recém-prontos (`.ready`), na fila,
  ativos ou sem munição.
- **Atalhos (PC)** `.hotbar`: ladrilhos chanfrados (`--n-tile*`), número da tecla em itálico, quantidade com contorno, o item
  equipado ganha moldura mostarda e tique brilhante.
- **Mensagens**: `.err` itálico coral com contorno; `.banner` (subiu de nível) dourado com losangos e etiqueta; `.feed`
  fitas de tinta com barra de cor (`--fic`: loot mostarda, bom oliva, aviso laranja).
- **Janelas** `.panel`: corpo de casca com grão, **faixa de título em pergaminho** (`.ph`, título em caixa alta, tecla em tinta),
  fechar = losango coral (`.px`), abas e ordenação = etiquetas inclinadas (creme quando `.on`), botões `.btn` em placas,
  espaços `.slot` em ladrilhos chanfrados (`.sel` mostarda), cartões `.bcard/.rcard` com contorno.
- **Dica** `.rtip`: cartão de **pergaminho** com texto de tinta; era do item numa etiqueta escura.
- **Ajuda** `.help`, **morte** `.death`, **barra de trabalho** `.workbar`, **chip de tarefas** `.jobchip` (pergaminho).
- **Mundo** (canvas): nomes e números de dano em Barlow Condensed (dano em itálico), contorno de tinta (`overlay.js`);
  balões de chat em pergaminho com contorno (`session.js`).

## Radar

Elipse no canto superior direito (`.mm` 186×120 no PC, 140×90 no celular deitado, 112×74 em pé):

- **Disco**: o minimapa (`Minimap.draw`, 2,7 px por tile, sem distorção — a janela é só mais larga que alta), recortado em
  elipse, vinheta e brilho; à noite um tom azul. Toque / clique abre o mapa (M).
- **Anel de bússola** (SVG): contorno de tinta + linha creme, marcas a cada 22,5° (cardeais em mostarda).
- **Arco do sol** sobre o anel: enche do amanhecer (5:30) ao anoitecer (19:30) com o degradê do dia (coral → laranja →
  creme → coral); à noite enche do anoitecer ao amanhecer em azul / verde-água. A **ponta brilhante** é o sol / a lua.
  O **relógio** fica numa etiqueta de pergaminho no topo do arco. Leitura de sobrevivência: barra quase cheia = a noite fria vem aí.
- **Gotas na borda** (até 10, apontam para fora na direção do alvo, menores quando longe), só para o que está **fora** do disco:
  hostis e saqueadores (coral, até ~66 tiles), neutros (mostarda, até ~40, no máximo 3), **outros jogadores** (verde-água, qualquer
  distância), **sua casa** = ponto de renascer (cama / fogueira / partida, laranja), **seu corpo** enquanto ainda guarda itens
  (creme) e o **alvo atual** (branco brilhante). Dados: `game.entities`, `game.player.target`, `respawnPoint(game)`,
  `game.corpses.map.get(player._corpse)`.
- **Faixa** embaixo: "DIA n" em pergaminho + clima com ícone (`env.weather`, "Noite" quando limpo à noite).

Desempenho: o disco redesenha a 10 Hz (como antes), as gotas se movem por `transform` a 10 Hz sem transição, o arco só muda
quando o valor muda (~1×/s) e **sem transições CSS no SVG** (elas faziam um layout por quadro). Medido no celular emulado:
layouts por quadro iguais aos do HUD anterior.

## Tamanhos e telas

Breakpoint compacto: `(max-height: 520px), (max-width: 640px)`; retrato: `(max-width: 640px) and (orientation: portrait)`
(o alvo desce para baixo do radar, o clima mostra só o ícone). Alvos de toque ≥ 44 px (rápidos, sistema, fechar, abas).
`--ui` (uiscale.js) continua valendo para o HUD inteiro. Áreas seguras via `--safe-*`.

## Ganchos que não mudam

ids (`#pf`, `#pf-hp`, `#tf`, `#mm`, `#clock`, `#weather`, `#ab-int`, `#eat-n`…), `data-*` (`data-slot`, `data-cslot`, `data-eq`,
`data-hb`, `data-build`, `data-sort`, `data-sortk`, `data-q`, `data-ab`, `data-tip`), `.p-chest .pt` e as classes de estado
usadas pelos módulos (`hidden`, `on`, `sel`, `full`, `low`, `combat`, `cool`, `gcd`…).
