# Simulação — o pedido do dono e como ficou

> "Crie um modo de simulação para testar como o mundo vai mudando, o modo simulação tem velocidade de 1x, 2x, 3x, 4x, 5x,
> 10x, 50x e 100x, mas apenas na visão do mapa mundi, na visão de gameplay vai até 5x, quando o scroll passar do zoom out
> limite do modo gameplay vai para visão do mapa mundi. Esse modo vai ser essencial para testes. Além disso, o jogador pode
> possuir qualquer npc dentro do mundo, permanecendo os itens que o npc tem, por exemplo possuir um soldado fica com as armas
> e armadura, todo npc tem que ter pelo menos 5 pães no inventário na hora que o jogador possuir um npc e alguns itens
> aleatórios básicos, até mesmo ferramentas, tudo depende do nível do npc, e claro só dá de possuir npc humano, ao possuir
> ele entra no modo gameplay exatamente igual a gameplay normal, e sim, esse modo tem como abrir para multiplayer também e
> todos os jogadores podem possuir npc, mas apenas o host pode mudar a velocidade da simulação e se a velocidade passar de
> 5x os jogadores que estiverem no zoom de gameplay voltam ao zoom de mapa mundi, e se tiver jogadores possuindo npc o host
> não pode aumentar a velocidade acima de 5x."

## Como se joga

- **Menu principal → "Simulação"** (logo abaixo de "Escaramuça"). Um planeta novo (semente sorteada; `?sim=1&seed=N` escolhe),
  **nunca salvo**. Abre no **mapa-múndi** sobre o lugar do início, com os reinos em volta.
- **Sem corpo**: todo jogador começa **espectador** — invisível, voa por cima de tudo (WASD; mais rápido com o zoom mais
  aberto), não é alvo de ninguém (criaturas, soldados, guardas, flechas), não sofre dano, não sente fome nem frio. Mesmo
  assim ele conta como "alguém por perto": o mundo em volta da câmera carrega e fica vivo (moradores na rua, exércitos que
  chegam perto, ataques da noite).
- **Barra no alto**: "SIMULAÇÃO", a data e a hora, os botões de velocidade e quem você é ("Espectador" ou "Você é Ana ·
  Guarda nv 7 · Sair do corpo"), e quantos estão num corpo.
- **Velocidades**: 1x, 2x, 3x, 4x, 5x na visão do jogo; **10x, 50x, 100x só no mapa-múndi** (os botões aparecem lá).
  Só o **anfitrião** muda (os outros veem os botões apagados: "Só o anfitrião muda a velocidade"). Com **alguém num corpo**
  o anfitrião não passa de 5x ("Alguém está possuindo um NPC: no máximo 5x"). Acima de 5x quem estava na visão do jogo vai
  para o mapa ("Velocidade acima de 5x: visão do mapa") e não volta até a velocidade baixar.
- **Mapa-múndi** (a tela inteira): o planeta inteiro revelado (sem névoa), reinos, estradas, lugares, exércitos, cercos e
  batalhas ao vivo. Roda do mouse aproxima / afasta (em volta do cursor), arrastar move, **duplo clique vai para lá**.
  **Aproximar além do campo de visão mais aberto do jogo entra na visão do jogo** naquele ponto (o espectador desce lá; quem
  está num corpo volta para ele). Na visão do jogo, **afastar além do zoom mais aberto volta ao mapa**.
- **Possuir**: espectador na visão do jogo, **clique numa pessoa** (morador, criança, guarda, soldado, saqueador — só gente,
  nunca bicho, andarilho ou esqueleto) ou E perto dela ("Possuir Ana"). A pessoa sai do mundo e você fica no lugar dela,
  com a aparência, o **nível**, o que ela usa (arma na mão, escudo, armadura, elmo — o soldado com a armadura que usa sob o
  tabardo) e a mochila: **pelo menos 5 pães** (+1 a cada 4 níveis), moedas, **ferramentas do material do nível** (pedra até
  o 3, cobre do 4, ferro do 8, aço do 13: faca, machado, picareta, pá por sorteio, pelo menos uma) e alguns itens básicos
  sorteados (tocha, corda, ervas, madeira, pedra, fibra, frutas, comida pronta, gravetos); um arqueiro leva flechas. Daí é
  o jogo normal (a barra de vida, a fome, o combate). Enquanto você é ela, ninguém "a" faz aparecer de novo.
- **Sair do corpo** (botão na barra): espectador de novo, a mochila vazia (a pessoa não volta). **Morrer** no corpo: depois de
  um instante, espectador de novo.
- **Multijogador**: o menu de pausa abre a sala como em qualquer mundo ("Abrir sala para amigos"); quem entra também é
  espectador (a sala avisa que é uma simulação: o convidado monta uma também) e cada um possui quem quiser.

## Como funciona

- `game/sim.js` (`installSim`, `simSystem`, ops / intents / mensagem de dono) e `ui/simUi.js` (a barra, o mapa, as dicas).
- **O relógio** (`Game.tick`, `main.js`): até 5x, **todos os sistemas** rodam essa quantidade de passos por quadro (as teclas
  só no primeiro passo; o espectador voa no próprio ritmo); acima de 5x um passo por quadro e o **relógio do mundo pula** o
  resto (`sim.ff`: hora, dia, tempo, `worldTime`) — reinos (marchas, cercos, diplomacia por números), mercados, estações,
  plantações, ataques da noite acompanham pelo relógio, como depois de um pulo de tempo. Sob o mapa nada do mundo é desenhado
  (`sim.noRender`).
- **Estado compartilhado** (op `sim.state`, do anfitrião, repetido a cada 3 s para quem entra depois): a velocidade e quem está
  num corpo. Intents: `sim.speed` (só o anfitrião; > 5x só sem ninguém num corpo), `sim.possess` (o anfitrião tira a pessoa
  do mundo — moradores pelo `people._drop` e marcados como `taken`, soldados com `warfare.desert`: a força conta a baixa sem
  morte nem notícia, saqueadores fora do acampamento — e manda o corpo ao jogador: mensagem de dono `sim.body`), `sim.leave`.
- **O espectador** (`p.ghost`, que vai na rede no estado do jogador: `gh`): não é desenhado nem recorta as construções; a IA o
  ignora (`ai.js pickTarget`: com só espectadores por perto, um "alvo" morto e longe; fauna, gigantes, andarilhos, moradores
  que olham ou desviam, projéteis, o gado), `dealDamage` não o fere; o zoom nunca trava "dentro de casa".
- Testes **SM1** (os dois espectadores, o mapa e a ida e volta da visão do jogo, nada o mira nem o fere), **SM2** (só o
  anfitrião muda; 3x ≈ 3× o tempo real; 100x: os dois no mapa, ≥ 40× e um dia em segundos, os reinos acompanham), **SM3**
  (o convidado possui um guarda: o lugar, o nível, a arma, a armadura, ≥ 5 pães, ferramenta; o anfitrião não passa de 5x;
  "Sair do corpo"; depois 10x leva o convidado ao mapa), **SM4** (o kit pelo nível: soldado, arqueiro, morador; só gente).
