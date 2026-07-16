# Auditoria técnica — v19

## Causa

`WorkspaceMonitor.selectAnotherWindow()` calculava `numCols = ceil(sqrt(n))` e delegava todas as setas ao `GridNavigator`. Esse modelo supõe linhas alinhadas ao mesmo início horizontal. O layout visual do Overview centraliza linhas incompletas, então o índice lógico não representa esquerda e direita na última linha.

Com três janelas, os índices eram tratados como uma grade 2x2 (`0, 1 / 2`), embora a janela 2 esteja visualmente centralizada. A navegação horizontal a partir dela podia selecionar o lado oposto ao comando.

## Correção

A v19 adiciona navegação espacial:

1. obtém centro transformado de cada clone;
2. filtra somente candidatos no semiplano da seta pressionada;
3. pontua distância no eixo principal e penaliza deslocamento transversal;
4. prioriza a mesma linha ou coluna;
5. usa `GridNavigator` apenas como fallback.

Somente `workspace.js` mudou em relação à v18.
