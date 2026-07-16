# Título

Um Overview nativo de produtividade para o Cinnamon: multitarefa mais rápida entre janelas, aplicativos, arquivos, web e áreas de trabalho

# Texto

Gostaria de apresentar uma prova de conceito funcional que amplia o Overview existente do Cinnamon e o transforma em um centro nativo de produtividade para multitarefa — sem substituir o desktop tradicional, o painel, o menu ou o modelo de gerenciamento de janelas que caracteriza o Cinnamon.

Não se trata apenas de um redesenho visual ou de uma ideia em forma de mock-up. O protótipo foi desenvolvido e testado no Cinnamon 6.6.7 em sessão X11. Ele reúne gerenciamento de janelas, abertura de aplicativos, localização de arquivos, cálculos rápidos, navegação na web e controle de áreas de trabalho em uma interface coerente, que pode ser operada com eficiência pelo teclado, mouse ou touchpad.

## Por que essa proposta pode gerar valor

Uma sessão de trabalho atual normalmente envolve várias tarefas simultâneas: navegador, documentos, planilhas, ferramentas de comunicação, terminais, gerenciador de arquivos e aplicativos distribuídos por diferentes áreas de trabalho. O Cinnamon já possui os componentes necessários para administrar tudo isso, mas o fluxo fica dividido entre painel, menu, Overview, atalhos, gerenciador de arquivos e navegador.

A proposta cria um único espaço temporário para responder rapidamente a perguntas comuns:

- O que já está aberto?
- Qual janela preciso acessar agora?
- Onde está o aplicativo, arquivo ou pasta de que preciso?
- Posso mover esta tarefa para outra área de trabalho?
- Posso fazer um cálculo sem interromper o que estou fazendo?
- Posso abrir um site ou pesquisar na web sem antes procurar uma janela do navegador?

O objetivo é reduzir trocas de contexto, deslocamentos do ponteiro e navegações repetitivas por menus. O usuário pressiona `Super`, conclui a ação e retorna ao trabalho.

## Fluxo proposto

### Janelas e Aplicativos como modos conectados

- `Super` abre o Overview de Janelas.
- `Super` duas vezes em até 400 ms abre diretamente Aplicativos.
- `Super` em Aplicativos retorna para Janelas.
- `Super` em Janelas fecha o Overview com animação visível e reversível.
- Um seletor visível entre Janelas e Aplicativos mantém o recurso fácil de descobrir para quem prefere usar o mouse.

Isso cria um caminho rápido pelo teclado sem remover o menu tradicional do Cinnamon nem modificar o desktop normal fora do Overview.

### Navegação realmente produtiva pelo teclado

A interface foi pensada para que tarefas rotineiras não dependam do mouse o tempo todo:

- navegação por setas entre as prévias de janelas com base na posição real delas na tela;
- comportamento espacial correto mesmo quando a última linha de janelas está incompleta;
- movimentação pelo teclado na grade de aplicativos e nos resultados de pesquisa;
- `Enter` para ativar a janela, aplicativo, arquivo ou ação selecionada;
- deslocamento previsível entre campo de pesquisa, resultados, visão de janelas e visão de aplicativos;
- ações de contexto dos aplicativos sem sair do Overview.

Isso é especialmente útil em longas sessões de multitarefa, para pessoas que preferem um fluxo orientado pelo teclado e em notebooks, nos quais movimentar repetidamente o touchpad tende a ser mais lento e cansativo do que usar uma sequência curta de teclas.

### Pesquisa unificada que faz mais do que abrir aplicativos

O campo de pesquisa funciona como uma superfície prática de comandos, e não apenas como filtro de aplicativos. O protótipo atual oferece:

- pesquisa de aplicativos com classificação por relevância e tolerância limitada a erros de digitação;
- localização local de arquivos e pastas, priorizando documentos recentes e diretórios comuns do usuário;
- busca assíncrona e cancelável no sistema de arquivos, com limites rígidos de tempo, profundidade e candidatos para manter a digitação responsiva;
- abertura direta de arquivos e pastas com seus aplicativos padrão;
- cálculos aritméticos com parênteses, precedência de operadores, potências, casas decimais e sinais unários;
- abertura da expressão em uma calculadora compatível ou cópia do resultado quando a calculadora instalada não aceita preenchimento automático;
- abertura de URLs e domínios diretamente no navegador padrão;
- conversão de texto comum em pesquisa web no navegador padrão;
- resultados agrupados e totalmente navegáveis pelo teclado.

Exemplos de tarefas que podem ser concluídas sem sair do Overview:

```text
2450 * 1.08
(128 + 64) / 3
linuxmint.com
https://github.com/linuxmint/cinnamon
relatório trimestral
Calculadora
```

O mais importante não é apenas a quantidade de provedores. É o fato de abrir um aplicativo, localizar um documento, calcular um valor e acessar um site seguirem o mesmo modelo de interação.

### Grade de aplicativos integrada ao estado real do sistema

O modo Aplicativos não é somente uma grade estática de ícones. O protótipo disponibiliza ações como:

- abrir ou focar um aplicativo;
- abrir nova janela quando houver suporte;
- mostrar uma ou várias janelas já abertas;
- exibir ações definidas no arquivo `.desktop`;
- iniciar com GPU dedicada quando o sistema oferecer offload;
- fechar as janelas do aplicativo quando houver suporte.

Isso une abertura de aplicativos e gerenciamento das tarefas em andamento, em vez de tratá-los como interfaces isoladas.

### Gerenciamento mais rápido das áreas de trabalho

O Overview também transforma as áreas de trabalho em parte central da multitarefa:

- arrastar horizontalmente o fundo vazio para trocar de área de trabalho;
- arrastar prévias de janelas para outra área;
- trocar pela borda enquanto uma janela está sendo arrastada;
- manter a ativação lógica da área sincronizada com a animação visual;
- navegar entre janelas pela posição espacial, sem depender de um índice que pode parecer invertido em layouts irregulares.

Isso torna a organização por projeto, atividade ou contexto mais compreensível e rápida.

### O painel existente do Cinnamon funciona como dock do Overview

Quando o painel está configurado para auto-ocultar ou ocultar inteligentemente, o protótipo revela temporariamente esse mesmo painel enquanto o Overview está aberto. Ele passa a funcionar como um dock familiar, sem criar uma segunda implementação de dock.

O usuário mantém acesso aos elementos que já configurou:

- lançadores;
- lista de janelas agrupadas;
- bandeja do sistema;
- relógio e calendário;
- indicadores de estado;
- applets personalizados.

Ao fechar o Overview, o painel retorna ao comportamento original de auto-ocultação ou ocultação inteligente. Painéis configurados para permanecer visíveis continuam aparecendo durante toda a transição, eliminando o espaço vazio que antes surgia enquanto o painel reaparecia.

## Por que essa abordagem combina com o Cinnamon

A proposta não é transformar o Cinnamon em uma cópia do GNOME Shell. A experiência normal permanece intacta:

- o painel tradicional continua existindo;
- o menu de aplicativos continua existindo;
- ícones da área de trabalho e janelas normais continuam funcionando como esperado;
- o Overview aparece apenas quando o usuário o aciona deliberadamente.

A diferença é que o Cinnamon ganha uma camada opcional de alta eficiência para quem trabalha com muitas tarefas simultâneas. Quem não precisa dela pode continuar usando o sistema exatamente como usa hoje. Quem precisa passa a ter um fluxo mais rápido e coerente sem instalar separadamente um launcher, dock, alternador de janelas ou ferramenta de pesquisa.

A implementação também reaproveita a própria infraestrutura do Cinnamon — Overview, áreas de trabalho, painéis, applets, provedores de pesquisa, atalhos e arraste — em vez de criar um shell paralelo dentro do desktop.

## Benefícios práticos

### Para trabalho com múltiplas tarefas

Janelas, aplicativos, arquivos, ações rápidas e áreas de trabalho ficam reunidos em um único lugar. Isso reduz o custo mental e mecânico de alternar entre ferramentas durante atividades simultâneas.

### Para quem prefere o teclado

Ações frequentes ficam acessíveis por `Super`, setas e `Enter`, reduzindo a dependência do ponteiro e acelerando alternâncias repetitivas entre tarefas.

### Para notebooks

Telas menores e touchpads se beneficiam de uma visão única na qual é possível inspecionar, selecionar, reorganizar e abrir tarefas sem percorrer repetidamente painel, menu e desktop. O gesto de troca de áreas também combina naturalmente com o uso de touchpad.

### Para usuários novos e antigos do Cinnamon

O seletor Janelas/Aplicativos torna a função fácil de compreender, enquanto painel e desktop continuam familiares. A curva de aprendizado é baixa porque a proposta amplia conceitos que já existem no Cinnamon, em vez de substituí-los.

### Para o projeto Cinnamon

Várias melhorias possuem valor independente mesmo que a proposta completa não seja incorporada de uma só vez:

- navegação espacial por teclado em layouts irregulares;
- swipe estável e arraste de janelas entre áreas de trabalho;
- correções de restauração e ocultação inteligente do painel;
- modo de painel reutilizável dentro do Overview;
- melhorias na grade e nas ações de contexto dos aplicativos;
- pesquisa local assíncrona de arquivos;
- cálculos e tratamento de URLs na pesquisa;
- transições reversíveis e de baixa latência.

## Estado do protótipo

O pacote anexo inclui:

- arquivos JavaScript modificados do Cinnamon;
- patch cumulativo;
- patch incremental final;
- capturas de tela;
- changelog completo do desenvolvimento;
- documentação técnica;
- ferramentas de instalação e restauração;
- saída de validação e testes de comportamento.

Ele foi testado em uma sessão real do Cinnamon 6.6.7 em X11. A suíte contém 32 verificações estáticas e comportamentais, mas o trabalho ainda deve ser considerado uma prova de conceito, e não um pull request pronto para integração. Uma iniciativa formal para upstream ainda precisaria de rebase, revisão de estilo do Cinnamon, avaliação de acessibilidade, testes em Wayland, mais combinações de temas e monitores e testes de desempenho em outros hardwares.

## Perguntas para a comunidade e os mantenedores

1. Isso melhoraria seu fluxo diário quando várias janelas e tarefas estão abertas?
2. O modelo `Super` / `Super` duplo parece rápido e compreensível?
3. Aplicativos, arquivos, cálculos, URLs e ações web deveriam compartilhar o mesmo campo ou alguns provedores deveriam ser opcionais?
4. Revelar o painel auto-ocultável como dock dentro do Overview parece natural?
5. Quais partes deveriam ser propostas primeiro como mudanças menores e mais fáceis de revisar no upstream?
6. Há comportamentos de teclado, touchpad, acessibilidade ou múltiplos monitores que deveriam ser considerados antes de formalizar o design?

Acredito que essa proposta pode oferecer ao Cinnamon um ganho perceptível de produtividade, mantendo a experiência tradicional que seus usuários valorizam. O objetivo desta discussão é verificar se a comunidade enxerga o mesmo potencial e como o trabalho pode ser organizado em uma direção adequada para upstream.
