# 日常 (Nichijou)

Caderno diário de tarefas para iPhone e iPad. Funciona como um caderno de papel: você anota o dia, marca o que fez, adia ou risca o resto. Tem também uma página solta, o **Dump**, para o que vier na cabeça.

É um PWA: abre no Safari e vai para a tela de início como um app. Não tem conta, não tem anúncio e não custa nada.

## Como usar

| Ação | Como |
|---|---|
| Nova tarefa | escreva na linha “escreva aqui…” e aperte Enter (o cursor continua lá para a próxima) |
| Marcar / desmarcar | toque na **caixinha** |
| Subtarefas | a primeira se cria pelo **⋯ → Adicionar subtarefa**; depois a tarefa ganha um **V** ao lado do ⋯ que abre e fecha as subtarefas (com uma linha para escrever mais) |
| Adiar, riscar, mandar pro dump, editar, excluir | botão **⋯** da linha |
| Reordenar | segure a linha e arraste (a tarefa vai com as subtarefas) |
| Outro dia | deslize a folha para os lados ou use ‹ › (tocar no nome do dia volta para hoje) |
| Dump | aba **Dump** no iPhone; no iPad, barra lateral à esquerda |

Marcas no papel: ✓ feita · → adiada (fica registrada no dia original) · — riscada. Uma tarefa que veio de outro dia ou do dump mostra a origem na margem vermelha (↩ ontem, ↩ dump).

**Ordem automática:** abertas em cima (na ordem que você escolher) → feitas → adiadas → riscadas no fim. Vale também dentro das subtarefas.

**Subtarefas:** marcar a principal marca todas; terminar a última marca a principal sozinha; reabrir uma subtarefa reabre a principal. “1/3” ao lado da tarefa mostra o progresso. Ao adiar, só as subtarefas que faltavam vão para o dia seguinte.

**Revisão da manhã:** ao abrir no dia seguinte, o app mostra o que ficou pendente e você escolhe o que vem para hoje. O que não vier continua no dia original (ou é riscado, se você marcar essa opção).

## Publicar (uma vez)

1. Faça merge desta branch na `main`.
2. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. O workflow `Publicar no GitHub Pages` roda a cada push na `main`. O endereço fica:
   `https://igor-boson.github.io/Nichijou-Mobile/`

## Instalar no iPhone e no iPad

1. Abra o endereço acima no **Safari**.
2. Compartilhar → **Adicionar à Tela de Início**.
3. Abra pelo ícone 日常. Depois da primeira abertura funciona sem internet.

## Sincronizar iPhone e iPad (GitHub Gist, grátis)

Os dados ficam no aparelho. Para ter o mesmo caderno nos dois, o app guarda uma cópia em um **gist secreto** na sua conta do GitHub.

1. Crie um token em [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - Nome: `日常`, validade à sua escolha.
   - Em **Permissions → Account**, adicione só **Gists: Read and write**.
2. No app: ajustes (ícone no canto) → cole o token → **Conectar**.
3. Repita no outro aparelho com o mesmo token. O segundo aparelho acha o gist sozinho.

Como funciona:
- Sincroniza ao abrir o app, ao voltar para ele, alguns segundos depois de cada mudança e a cada 30 s enquanto está aberto.
- Se você mexer nos dois aparelhos sem internet, ao reconectar as mudanças se juntam tarefa por tarefa (vence a edição mais recente de cada tarefa).
- O token fica salvo só no aparelho e só é enviado para `api.github.com`.
- Gist secreto não aparece em lugar nenhum, mas quem tiver o link exato consegue ler. Serve para tarefas; não anote senhas.

Por que não iCloud: um app da web não tem acesso ao iCloud sem uma conta de desenvolvedor Apple (US$ 99/ano).

## Backup

Ajustes → **Exportar** gera `nichijou-backup-AAAA-MM-DD.json` (no iPhone abre o Compartilhar: salve no Arquivos/iCloud Drive). **Importar** junta o backup com o que já está no aparelho.

## Lembrete diário (app Atalhos)

1. Atalhos → **Automação** → **+** → **Hora do Dia**: 8:00, Diariamente.
2. Escolha **Executar Imediatamente**.
3. Ação **Mostrar Notificação**: “Monte sua página de hoje”.

## Desenvolvimento

Sem build e sem dependências: HTML, CSS e JavaScript (módulos ES).

```
index.html             página
css/style.css          visual (papel bege, modo escuro, layout iPhone/iPad)
js/app.js              interface, gestos, folhas
js/model.js            dados puros: ações, revisão, mesclagem para o sync
js/store.js            salvar no aparelho, backup
js/sync.js             GitHub Gist
js/dates.js            datas no fuso local
sw.js                  offline (mude VERSION a cada publicação)
fonts/                 Klee One e Atkinson Hyperlegible (licença SIL OFL), só os caracteres usados
```

```sh
npm start        # servidor local em http://localhost:8080
npm test         # testes do modelo e da mesclagem (node --test)
npm run e2e      # teste no navegador (iPhone/iPad emulados, GitHub simulado) — precisa de Playwright
```

Ao publicar uma mudança, aumente `VERSION` em `sw.js` (e em `js/app.js`) para os aparelhos baixarem a versão nova.
