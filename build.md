# Build e publicação

Todos os comandos rodam na raiz do projeto da extensão.

## Pré-requisitos

O `@vscode/vsce` já está em `devDependencies`, então não precisa instalar nada global — o `pnpm exec` resolve pelo node_modules local.

```bash
pnpm install
```

## Compilar

```bash
pnpm run build
```

Saída em `out/`. Durante o desenvolvimento, `pnpm run watch` deixa o `tsc` recompilando.

Para testar sem empacotar: `F5` no VSCode abre uma janela Extension Development Host com a versão do fonte carregada.

## Empacotar o .vsix

Antes de empacotar, subir o `version` no `package.json` — o Marketplace recusa uma versão já publicada, tanto pela CLI quanto pelo portal.

```bash
pnpm exec vsce package
```

Gera `vscode-alijunior-project-switcher-<versão>.vsix` na raiz.

Para conferir o que vai dentro do pacote:

```bash
pnpm exec vsce ls
```

Devem sair cinco arquivos: `package.json`, `readme.md`, `LICENSE`, `icon.png` e `out/extension.js`. O que fica de fora é controlado pelo `.vscodeignore`. O `.vsix` não deve ser commitado.

## Instalar localmente para testar

```bash
code --install-extension vscode-alijunior-project-switcher-<versão>.vsix
```

Depois recarregue a janela (`Developer: Reload Window`). Para voltar atrás:

```bash
code --uninstall-extension alijunior.vscode-alijunior-project-switcher
```

Vale testar com pelo menos duas janelas abertas — boa parte do comportamento (recentes, clique no último) só aparece com mais de um projeto registrado.

## Publicar pelo portal (upload do .vsix)

Caminho preferido: não precisa de PAT, não precisa de login na CLI e não é afetado pela aposentadoria dos PATs globais.

1. Abrir `https://marketplace.visualstudio.com/manage/publishers/alijunior` e entrar com a conta Microsoft do publisher
2. Localizar **Switch Projects** na lista de extensões
3. No menu `...` da linha da extensão, escolher **Update**
4. Selecionar (ou arrastar) o `.vsix` gerado
5. A extensão entra em **Verifying**; em alguns minutos a nova versão aparece publicada

Se for a primeira publicação de uma extensão nova, o botão é **New extension → Visual Studio Code**, no topo da mesma página.

A versão publicada é a que está dentro do `package.json` empacotado — o nome do arquivo é só consequência. Se o upload for recusado por versão duplicada, o `version` não foi incrementado antes do `vsce package`.

Pela mesma página dá para acompanhar downloads, editar a listagem, despublicar uma versão ou a extensão inteira.

## Publicar pela CLI

Alternativa, quando quiser publicar sem sair do terminal.

Autenticação uma vez por máquina:

```bash
pnpm exec vsce login alijunior
```

Ele pede o PAT (ver seção abaixo) e guarda a credencial.

Publicar a versão que está no `package.json`:

```bash
pnpm exec vsce publish
```

Ou deixar o próprio vsce subir a versão, commitar e criar a tag git:

```bash
pnpm exec vsce publish patch    # 1.1.0 -> 1.1.1
pnpm exec vsce publish minor    # 1.1.0 -> 1.2.0
pnpm exec vsce publish major    # 1.1.0 -> 2.0.0
```

Essa forma exige a árvore do git limpa.

Publicar sem login prévio (útil em CI):

```bash
pnpm exec vsce publish -p <PAT>
```

Despublicar:

```bash
pnpm exec vsce unpublish alijunior.vscode-alijunior-project-switcher
```

## O PAT

Necessário só para o caminho da CLI. O token sai do Azure DevOps, não do VSCode.

1. Entrar em `https://dev.azure.com` com a mesma conta Microsoft do publisher `alijunior`
2. Ícone do usuário (canto superior direito) → **Personal access tokens** → **New Token**
3. **Organization:** `All accessible organizations` — selecionar uma organização específica é o erro mais comum e faz o publish falhar
4. **Scopes:** `Custom defined` → `Show all scopes` → seção **Marketplace** → marcar **Manage**
5. Copiar o token na hora; o Azure não mostra de novo

Se a página ficar em loop de login, dá para criar o token direto pelo portal do publisher em `https://marketplace.visualstudio.com/manage`, em Security → Personal Access Tokens.

O PAT tem validade (máximo de um ano). Quando o publish começar a dar erro de autenticação sem motivo aparente, o token expirou — gerar outro e refazer o `vsce login`.

**Atenção para depois de 01/12/2026:** a Microsoft está aposentando os PATs globais (`All accessible organizations`) do Azure DevOps. A partir daí o token precisa ser escopado a uma organização, ou a autenticação migra para Microsoft Entra ID. O upload pelo portal não é afetado.

## Sequência de um release

1. Alterar o código e rodar `pnpm run build`
2. Testar com `F5` ou instalando o `.vsix` local
3. Subir o `version` no `package.json`
4. Atualizar o `readme.md` se mudou comportamento ou configuração
5. `pnpm exec vsce package`
6. Subir o `.vsix` pelo portal
7. Commitar e push