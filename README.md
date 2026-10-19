# Turno · Gestor de escalas

Piloto navegável para apresentar o fluxo de planejamento de escalas de uma rede com **3 lojas e 320 pessoas fictícias** (40, 80 e 200). Nome de apresentação provisório: Turno.

## Executar

Requer Node.js 20 ou superior, sem instalação de dependências.

```sh
npm start
```

Abra o endereço local apresentado. Para verificar as regras e os importadores:

```sh
npm test
```

Também pode ser servido por qualquer hospedagem estática que entregue `.mjs` como JavaScript. Caminhos relativos permitem publicar sob uma subpasta.

## Roteiro para o cliente

1. Abra **Visão geral** e confira o tamanho das três equipes.
2. Em **Importar equipe**, clique em **Experimentar com arquivo fictício**. Confira registros novos, identificador repetido e cadastro pendente. Confirme a importação.
3. Em **Equipe**, complete setor e jornada da pessoa pendente. O piloto aceita contratos demonstrativos de 40h.
4. Abra **Escalas**. A loja Centro começa com conflitos intencionais: descanso insuficiente e trabalho além do perfil semanal.
5. Clique em um turno para editar. Veja o motivo de cada pendência e o recálculo das horas e da cobertura.
6. Clique em **Gerar sugestão**, confirme e confira as lacunas operacionais que permanecem.
7. Em **Revisar e publicar**, confirme a ciência sobre cobertura e escopo demonstrativo. Simule a publicação; nenhum aviso é enviado.
8. Clique em **Criar revisão**, altere um turno com justificativa e republique. Veja a atividade em **Visão geral**.
9. Use **Exportar escala CSV** para baixar os dados filtrados. **Reiniciar demonstração**, na barra lateral, restaura a base inicial.

## Importação

- **CSV:** `matricula` (ou `pis`), `nome`, `setor` e `horas_semanais`. As duas primeiras colunas são obrigatórias. Separadores vírgula ou ponto e vírgula; leitura UTF-8 ou Windows-1252.
- **AFD legado em TXT:** reconhece cabeçalho de 232 caracteres e registros cadastrais tipo 5 com 87 caracteres, identificador de 12 dígitos e nome de 52 caracteres. Considera inclusão, alteração e exclusão pelo último NSR de cada identificador. Não importa marcações. Não infere vínculo ativo no RH a partir do relógio; os cadastros precisam de conferência humana.
- **RB1:** leitura direta indisponível. O aplicativo informa essa limitação e não simula extração. Compatibilidade requer validação com o fabricante.
- AFDs de outros leiautes não são aceitos silenciosamente. Use o modelo CSV.
- Repetições são ignoradas; identificadores presentes em outra loja são apresentados para revisão. Registros inválidos não são importados.
- Nenhum arquivo do cliente está neste projeto. O processamento acontece no navegador, sem envio a servidor e sem armazenamento persistente. Recarregar reinicia a sessão.

O AFD do equipamento é uma fonte de eventos cadastrais, não uma garantia de quadro atual de funcionários. Após importar, o usuário confirma setor e jornada.

## Escopo e limites

O perfil de teste usa 40h semanais, até 8h diárias, 2 dias sem trabalho na semana, até 5 dias consecutivos, 11h entre jornadas e intervalos de referência. As semanas vizinhas carregadas entram na verificação de descanso. Férias/ausências de exemplo são respeitadas na geração.

O período navegável é de 12/10/2026 a 08/11/2026, com semanas de contexto antes e depois. A sugestão é uma heurística de distribuição de 5 dias de trabalho e 2 folgas, não um otimizador completo. Pode deixar lacunas de cobertura, sempre apresentadas.

Conformidade trabalhista completa depende de enquadramento, regras vigentes, convenções/acordos coletivos e condições de cada vínculo. Não estão implementadas regras completas de domingos, feriados, trabalho noturno, contratos diferentes, banco de horas ou transições legais. O produto não oferece homologação jurídica.

Não há login, banco de dados, colaboração entre dispositivos, notificações, folha de pagamento, conexão com o relógio nem tratamento oficial de ponto. Publicação e histórico são simulações locais à aba. O histórico não é uma trilha de auditoria de produção.

## GitHub e hospedagem

O repositório é **público**, conforme a orientação atual do usuário. Não adicionar RB1, AFD original, dados pessoais, senhas ou segredos. O fluxo de publicação inclui apenas `index.html`, `.nojekyll` e `assets/`.

O código e o site demonstrativo são públicos. A base inicial contém apenas dados fictícios; o importador não envia arquivos para o GitHub.

A automação valida o projeto em cada alteração e publica os arquivos estáticos via **GitHub Actions**. A origem do site deve estar configurada em **Settings → Pages → GitHub Actions**.

## Referências de formato

- [SDK e versões do Inner REP Plus](https://integrador.topdata.com.br/suporte/download-sdk-innerrep/)
- [Portaria 1510 — leiaute legado do AFD](https://acesso.trabalho.gov.br/data/files/8A7C812D32B088C70132D9A53F537D2C/p_20090921_1510.pdf)
- [GitHub Pages: criação e planos](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
