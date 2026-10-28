# WOS — World of Survival

Survival MMO 2D visto de cima, no navegador. Visual inspirado em RimWorld, combate simplificado inspirado em WoW, pensado para celular.
Instalável como app em tela cheia (PWA).

**Jogar:** https://jay15963.github.io/WOS/

## Controles
- **Celular:** joystick à esquerda (toque e arraste), toque no mundo para interagir/selecionar alvo, pinça para zoom.
- **PC:** WASD/setas para andar, clique para interagir, roda do mouse para zoom.

## Desenvolvimento
Sem build — módulos ES puros + WebGL2.

```bash
python -m http.server 5173 --bind 127.0.0.1
```

Abra http://localhost:5173 (use `?seed=123` para outro mundo). Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
