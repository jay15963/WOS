# Câmera giratória (protótipo das faces calculadas)

Pedido do dono: girar a câmera suavemente, continuando 2D e leve. As estruturas não viram sprites de 8 / 32
direções (emendas tortas, atlas enorme): viram **faces calculadas** — retângulos texturizados com a arte de sempre,
calculados para o ângulo do momento.

## Controles

- **PC:** arrastar com o **botão do meio do mouse** (para a direita = a câmera gira para a direita); **clique duplo
  no botão do meio** = de volta ao norte.
- **Celular:** **dois dedos girando como um volante**. Abrir / fechar os dedos continua sendo zoom: o primeiro
  movimento claro (giro ou pinça) fica com o gesto até os dedos saírem da tela (input.js `gLock`).
- Com a câmera girada aparece uma **bússola no radar** (a agulha aponta o norte); tocar nela volta ao norte.
- O joystick e o WASD andam em relação à tela (para cima = para longe da câmera).

## Como funciona

- `game.cam.rot` (radianos) segue `rot To` com suavização; `rotFade` (0..1) enquanto girada. Em 0° tudo é desenhado
  exatamente como antes.
- Uma transformação só: o mundo gira em volta da câmera; a altura sobe reta na tela (`y − h`, como sempre).
  - Shaders: `uRot` (cos, sen). Sprites em pé (personagens, árvores, itens, móveis) giram só a âncora e continuam de
    frente para a tela; sprites deitados (`uFlat`: pisos, tapetes, decalques) giram inteiros. Terreno, luz ambiente
    e pós-processamento convertem tela → mundo pela rotação; sombras do sol e feixes de luz também.
  - JS: `game.screenToWorld` / `worldToScreen(x, y, h)` (h = altura na tela: plaquinhas de nome), `view()` (a caixa
    em volta da tela girada), profundidade = o y girado.
- **Paredes e portas** viram caixas de faces (`art/archCompose.drawWallFaces`, `engine/faceBatch.js`,
  `FACE_VS / FACE_FS`): o topo usa a metade de cima do sprite da parede; cada lado virado para a câmera usa a
  fachada de um pedaço reto do mesmo estilo, sombreado pelo ângulo com o sol. Lados internos (encostados em outra
  parede) não são desenhados. Ordenadas pelo ponto mais à frente da caixa; escrevem na camada de brilho (escondem o
  que brilha atrás).
- **Personagens e bichos:** a vista desenhada = a direção deles menos a da câmera (`viewFacing`), em 4 vistas.

## O que falta (lacunas conhecidas do protótipo)

- **Telhados** somem enquanto a câmera está girada (as fatias são pintadas para a vista norte). Próximo passo:
  telhado em faces inclinadas por tile (`roofs.roofPropAt` já tem a água e a inclinação de cada tile).
- **Janelas, portas detalhadas e enfeites da parede** não aparecem nas faces (só a fachada lisa do estilo). Próximo
  passo: desenhar as camadas de detalhe da fachada na face sul de cada peça.
- **Cercas, portões, escadas e andares de cima** continuam sprites (ficam "de frente" em qualquer ângulo).
- **Coisas penduradas na parede** (quadros, ervas) e a grade / fantasmas do modo construção não giram com a parede.
- **8 direções** dos personagens: hoje 4 vistas; as diagonais pedem o rig em 5 vistas (o resto espelhado).
- O minimapa / radar fica com o norte para cima (a bússola mostra o giro).
