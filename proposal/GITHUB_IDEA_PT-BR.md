# Título

Modernizar o Overview do Cinnamon como uma central unificada de janelas, aplicativos e áreas de trabalho

# Texto

## Resumo

Gostaria de propor uma evolução do Overview atual do Cinnamon para uma central nativa e unificada de produtividade, reunindo janelas, aplicativos, pesquisa e áreas de trabalho, sem abandonar a identidade tradicional do Cinnamon, seu painel e seu fluxo de uso familiar.

Não se trata apenas de um conceito visual. Foi desenvolvido e testado um protótipo funcional no Cinnamon 6.6.7 em sessão X11. O arquivo anexado contém os códigos modificados, patch cumulativo, capturas de tela, validações e resumo técnico.

## Por que isso agrega valor

O Cinnamon já possui componentes sólidos: painel tradicional, visão de janelas, áreas de trabalho, menu de aplicativos e mecanismos de pesquisa. Porém, essas funções ainda exigem mudanças frequentes de contexto.

Um Overview unificado reduz os passos necessários para:

- localizar uma janela aberta;
- mover uma janela entre áreas de trabalho;
- abrir um aplicativo;
- pesquisar aplicativos e arquivos;
- realizar cálculos rápidos e pesquisas na web;
- navegar somente pelo teclado;
- utilizar o painel como dock familiar durante o gerenciamento de janelas.

A proposta não busca transformar o Cinnamon em outro ambiente. O objetivo é modernizar sua camada de produtividade mantendo o desktop tradicional e o painel exatamente como os usuários esperam fora do Overview.

## Modelo de interação proposto

- Modo **Janelas** para janelas abertas e áreas de trabalho.
- Modo **Aplicativos** para grade e pesquisa de aplicativos.
- `Super` abre Janelas.
- `Super` duas vezes em até 400 ms abre Aplicativos.
- `Super` em Aplicativos retorna para Janelas.
- `Super` em Janelas fecha com animação visível e reversível.
- Pesquisa unificada para aplicativos, arquivos, web, calculadora e provedores existentes.
- Arraste do fundo para trocar de área de trabalho.
- Arraste de janelas entre áreas de trabalho.
- Navegação por setas baseada na posição visual real das janelas.
- Painel auto-oculto ou inteligente aparece temporariamente como dock no Overview.

## Benefícios

- Menos mudanças de contexto.
- Fluxo mais rápido por teclado e mouse.
- Melhor descoberta das áreas de trabalho.
- Grade de aplicativos acessível sem substituir o menu tradicional.
- Reaproveitamento do painel e dos applets existentes.
- Transições mais consistentes e menor sensação de atraso.
- Experiência moderna sem perder a identidade do Cinnamon.

## Situação do protótipo

O protótipo foi testado em Cinnamon 6.6.7/X11 e inclui 32 verificações estáticas e comportamentais, além de validação da aplicação dos patches.

Antes de qualquer integração oficial, ainda seriam necessários rebase para o master atual, revisão de arquitetura e estilo, testes em Wayland, múltiplos monitores, diferentes painéis, escalas, temas, RTL e acessibilidade.

A proposta não solicita que o patch atual seja incorporado sem alterações. O objetivo é verificar se esse modelo de interação é interessante para o projeto e quais mudanças os mantenedores considerariam necessárias para uma implementação adequada ao upstream.
