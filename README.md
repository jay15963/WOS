# WOS — World of Survival

Survival MMO 2D visto de cima, no navegador. Visual inspirado em RimWorld, combate simplificado inspirado em WoW, pensado para celular.
Instalável como app em tela cheia (PWA).

**Jogar:** https://jay15963.github.io/WOS/

## Controles
- **Celular:** joystick à esquerda (toque e arraste), toque no mundo para coletar/atacar/andar, pinça para zoom,
  habilidades no arco à direita, botões rápidos à esquerda (Mochila, Criar, Construir, Minerar, Comer).
- **PC:** WASD/setas para andar, clique para interagir/atacar, 1–7 habilidades, F ataque, Tab alvo, E interagir,
  C criar, B construir, X minerar, I mochila, Q comer, M mapa, Esc cancelar, roda do mouse para zoom.

## Progressão
Você começa só com as mãos: pegue pedrinhas, gravetos e fibras → faca, machado e picareta primitivos → madeira e pedra →
bancada → ferramentas de pedra → minere as montanhas (cobre, carvão, ferro...) → fornalha e bigorna → cobre → ferro → aço.
Construa casas com paredes que se conectam, portas, pisos, móveis e plantações. Cuidado com lobos, aranhas e saqueadores.

## Desenvolvimento
Sem build — módulos ES puros + WebGL2.

```bash
python tools/serve.py
```

Abra http://localhost:5173 (use `?seed=123` para outro mundo). Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e,
para o multijogador, [docs/SYNC.md](docs/SYNC.md).

Antes de cada commit:

```bash
node tools/stamp.mjs        # grava a identidade do build (src/version.js + VERSION do sw.js)
node tools/check-sync.mjs   # regras de sincronização do multijogador (ou: npm run check)
```

Teste automático com dois clientes: `tools/mp-test.html` (iframes com `?link=bc`, sem rede).
