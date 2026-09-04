# Plano de Desenvolvimento — navegador-custom

Navegador desktop com interface própria sobre o Electron/Chromium, com abas via
`BrowserView`, barra de endereço e busca padrão no DuckDuckGo.

---

## Milestone 1 — MVP (foundation)

Base funcional já implementada em `main.js` / `preload.js` / `renderer.js` / `index.html`.

### Issue #1 — Project scaffolding & Electron setup
**Labels:** setup

- [x] `package.json` com script `start` (`electron .`)
- [x] Electron instalado como devDependency
- [x] Estrutura mínima de arquivos (`main.js`, `preload.js`, `index.html`, `renderer.js`)
- [x] `contextIsolation` habilitado na janela principal

### Issue #2 — Basic BrowserWindow shell
**Labels:** setup, ui

- [x] `BrowserWindow` criada com tamanho padrão (1280x800)
- [x] `index.html` carregado como shell da UI
- [x] Preload script exposto via `contextBridge`
- [x] Layout reserva altura fixa (`UI_HEIGHT`) para a barra de abas/endereço

### Issue #3 — Tab management core (create/close/activate)
**Labels:** core

- [x] Criar nova aba (`tabs:new`) instanciando um `BrowserView` isolado (`sandbox: true`)
- [x] Fechar aba (`tabs:close`) destruindo o `webContents` e reatribuindo a aba ativa
- [x] Ativar aba (`tabs:activate`) trocando o `BrowserView` exibido
- [x] Sempre manter ao menos uma aba aberta (recria uma nova ao fechar a última)

### Issue #4 — Navigation controls (back/forward/reload/address bar)
**Labels:** core, ui

- [x] Ir para URL ou termo de busca (`nav:go`), detectando URL vs. texto livre
- [x] Voltar / avançar no histórico da aba ativa (`nav:back`, `nav:forward`)
- [x] Recarregar página ativa (`nav:reload`)
- [x] Estado de habilitação de voltar/avançar refletido na UI via `tabs:update`

### Issue #5 — Default search engine integration (DuckDuckGo)
**Labels:** feature

- [x] Nova aba abre `https://duckduckgo.com` por padrão
- [x] Texto que não parece URL é enviado como busca (`https://duckduckgo.com/?q=...`)
- [x] Texto com domínio (`exemplo.com`) é tratado como URL, não como busca

---

## Milestone 2 — Everyday usability

### Issue #6 — Keyboard shortcuts
**Labels:** ux, feature

- [ ] `Ctrl+T` abre nova aba
- [ ] `Ctrl+W` fecha aba ativa
- [ ] `Ctrl+Tab` / `Ctrl+Shift+Tab` alterna entre abas
- [ ] `Ctrl+L` foca a barra de endereço
- [ ] `Ctrl+R` / `F5` recarrega a aba ativa

### Issue #7 — Tab reordering via drag & drop
**Labels:** ux, ui

- [ ] Arrastar uma aba para reordenar na barra de abas
- [ ] Ordem refletida no array `tabs` do processo principal
- [ ] Indicador visual de posição durante o arraste

### Issue #8 — New tab page
**Labels:** ui, feature

- [ ] Página interna (não uma URL externa) exibida ao abrir nova aba vazia
- [ ] Atalhos rápidos para sites frequentes/favoritos
- [ ] Campo de busca centralizado que usa o mesmo fluxo de `nav:go`

### Issue #9 — Bookmarks
**Labels:** feature, persistence

- [ ] Adicionar/remover favorito da aba ativa
- [ ] Lista de favoritos persistida em disco (JSON local)
- [ ] Acesso rápido aos favoritos pela UI

### Issue #10 — History
**Labels:** feature, persistence

- [ ] Histórico de navegação persistido por aba/sessão
- [ ] Tela de histórico com busca por título/URL
- [ ] Opção de limpar histórico

### Issue #11 — Find in page
**Labels:** feature, ui

- [ ] `Ctrl+F` abre busca na página ativa
- [ ] Navegação entre ocorrências (próxima/anterior)
- [ ] Contador de resultados encontrados

---

## Milestone 3 — Performance & footprint

### Issue #12 — Lazy-load inactive tabs
**Labels:** performance

- [ ] Abas em background não consomem CPU de renderização ativamente
- [ ] Conteúdo é recarregado ao reativar uma aba descarregada
- [ ] Sem perda perceptível de estado de navegação (URL mantida)

### Issue #13 — Memory usage monitoring/dev tool
**Labels:** performance, dev-tool

- [ ] Painel interno (dev) exibindo uso de memória por aba
- [ ] Atualização periódica das métricas
- [ ] Acessível apenas em modo desenvolvimento

### Issue #14 — Process/resource cleanup on tab close
**Labels:** performance, core

- [ ] `webContents.destroy()` chamado corretamente ao fechar aba (já parcialmente coberto no #3)
- [ ] Nenhum processo renderer órfão após fechar todas as abas de um teste de estresse
- [ ] Listeners de eventos removidos ao destruir a aba

### Issue #15 — Startup time optimization
**Labels:** performance

- [ ] Tempo entre `app.whenReady()` e primeira janela visível medido
- [ ] Redução de trabalho síncrono no caminho de inicialização
- [ ] Meta documentada (ex: janela visível em menos de 1s em hardware de referência)

---

## Milestone 4 — Polish

### Issue #16 — Dark mode / theming
**Labels:** ui, nice-to-have

- [ ] Tema escuro para a barra de abas/endereço
- [ ] Alternância manual entre claro/escuro
- [ ] Seguir preferência do sistema operacional por padrão

### Issue #17 — Settings/preferences panel
**Labels:** ui, feature

- [ ] Tela de configurações acessível pela UI
- [ ] Opção de trocar motor de busca padrão
- [ ] Preferências persistidas em disco

### Issue #18 — Error pages (offline, DNS fail, etc.)
**Labels:** ui, ux

- [ ] Página de erro amigável para falha de DNS
- [ ] Página de erro amigável para "sem conexão"
- [ ] Botão de "tentar novamente" que recarrega a aba

---

## Milestone 5 — Packaging & distribution

### Issue #19 — App icon & branding
**Labels:** build, nice-to-have

- [ ] Ícone do aplicativo definido para Linux (.png/.icns/.ico conforme plataforma)
- [ ] Nome de exibição e metadados em `package.json` revisados
- [ ] Ícone aplicado corretamente na barra de tarefas/janela

### Issue #20 — Build & package for Linux (AppImage/deb)
**Labels:** build

- [ ] Configuração de empacotamento (ex: `electron-builder` ou `electron-forge`)
- [ ] Geração de artefato `.AppImage`
- [ ] Geração de artefato `.deb`
- [ ] Instruções de build documentadas no README
