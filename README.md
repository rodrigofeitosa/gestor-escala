# Turno · Gestor de escalas

Piloto para planejar quadro, cobertura e escalas de supermercados. O código é público; os cadastros operacionais ficam no Supabase e exigem autenticação e autorização por rede/unidade.

- [Abrir piloto](https://rodrigofeitosa.github.io/gestor-escala/)
- [Abrir demo fictícia, sem conta](https://rodrigofeitosa.github.io/gestor-escala/demo.html)

## Primeiro uso

1. Use **Primeiro acesso** com o e-mail previamente liberado pelo administrador. Confirme o e-mail e entre. Criar uma conta sem liberação não dá acesso à operação.
2. Em **Operação e cadastros**, revise funcionamento, turnos e perfil de jornada.
3. Em **Equipe**, confira contratos, dias disponíveis, início/fim do vínculo e quem pode abrir a loja. Cadastre habilitações adicionais somente após confirmação. Registre ausências pelo período necessário ao planejamento.
4. Em **Mínimos de cobertura**, confirme quantidades e interpretações provisórias. Diferencie pessoas distintas no dia de presença simultânea em uma faixa de horário. Defina exceções por data e vigência. Mínimos confirmados podem bloquear a publicação.
5. Abra **Cobertura e quadro**. A disponibilidade cadastral é diferente da cobertura efetivamente prevista nos turnos. Uma vaga aberta não aumenta a capacidade da equipe. Compare hipóteses de contratação/habilitação sem alterar o quadro real.
6. Em **Escalas**, gere uma sugestão, ajuste os turnos e salve. Fixe turnos/folgas que devem ser preservados na próxima sugestão. A revisão final valida no servidor antes de publicar.
7. Consulte versões anteriores em **Histórico** e exporte CSV. Alterar uma escala publicada exige abrir uma revisão; a versão anterior é preservada.
8. O administrador pode criar unidades com parâmetros próprios e liberar perfis de gerente ou consulta em **Acessos**. A liberação não envia convite automaticamente: compartilhe o link por seu canal habitual.

## E-mail e autenticação

O projeto foi configurado com o endereço publicado como Site URL e retorno exato para `index.html`. O proprietário inicial é cadastrado na base privada por e-mail, sem credenciais no fonte.

**Pendente por decisão do responsável: configurar um provedor SMTP antes de liberar o primeiro acesso do gerente externo.** O envio padrão do Supabase atende apenas endereços autorizados da organização e tem limites de teste. Não desative a confirmação de e-mail para contornar essa limitação. O administrador define a própria senha na tela de primeiro acesso; nenhuma senha inicial é distribuída pelo código.

Configure o provedor em Authentication → Emails → SMTP Settings no projeto. Insira credenciais diretamente no painel, nunca neste repositório. Após configurar, teste confirmação e recuperação com um destinatário autorizado antes de liberar o gerente.

## Premissas e limites do piloto

Horários iniciais: segunda a sábado, 07h–21h; domingo, 08h–20h. Os modelos de turno incluem preparação e fechamento. O perfil inicial considera 40h semanais, até 8h de trabalho/dia, 11h entre jornadas e até 5 dias de trabalho na semana e consecutivos. Esses valores são editáveis e estão sinalizados para revisão; não representam afirmação de mudança legal já vigente.

Cada dia pode ter um fechamento opcional durante o expediente, com início e reabertura dentro do horário de funcionamento. Unidades sem essa interrupção mantêm a opção desmarcada. A cobertura por faixa de horário desconsidera o período fechado; faixas totalmente fechadas ficam suspensas. Mínimos diários, horas trabalhadas e intervalos individuais continuam sendo tratados separadamente. Publicações anteriores preservam os horários daquela versão.

A sugestão é uma heurística de apoio, sem garantia de solução ótima. Mínimos diários não comprovam cobertura durante todo o funcionamento. Dias/funções sem mínimo cadastrado permanecem como demanda a definir. Confirmações de interpretação, jornada contratual e horários precisam ser feitas pelo responsável.

A revisão verifica carga semanal, dias, sequência entre semanas, disponibilidade, ausência, habilitação, intervalo, sobreposição, descanso e mínimos cadastrados. O servidor considera vínculos da mesma pessoa em outras unidades, inclusive a última versão publicada enquanto outra revisão está aberta. A prévia local dispõe apenas dos dados visíveis ao usuário; a decisão final é do servidor. A vinculação administrativa de uma mesma pessoa a outra unidade e a migração de contratos especiais precisam de evolução específica na interface.

Não há cálculo completo de regras de domingos, feriados, trabalho noturno, regimes especiais, banco de horas ou todas as cláusulas de convenções/acordos coletivos. O piloto não certifica conformidade jurídica e requer revisão das regras aplicáveis antes do uso operacional definitivo. Os turnos desta versão começam e terminam no mesmo dia.

Publicar registra uma versão interna e permite exportar; não envia mensagens aos funcionários. Não há folha de pagamento, tratamento oficial do ponto ou integração direta com o relógio. Planejamento e marcações reais continuam sendo fontes distintas.

## Importação

- **CSV:** `matricula` (ou `pis`) e `nome` obrigatórios; `horas_semanais` opcional. Selecione setor/função iniciais por grupo e confira os dados depois. UTF-8 ou Windows-1252, separador vírgula ou ponto e vírgula.
- **AFD legado TXT:** cabeçalho de 232 caracteres e registros cadastrais tipo 5 com 87 caracteres, identificador de 12 dígitos e nome de 52 caracteres. Considera o último evento por NSR, sem importar marcações. O cadastro do relógio precisa de conciliação com o quadro atual.
- **RB1:** leitura direta ainda indisponível. O sistema rejeita o arquivo sem simular extração. Use exportação compatível ou CSV após conversão validada com o fabricante.
- Limites: 5 MB e 500 registros. A prévia ocorre no navegador; somente os registros confirmados são enviados ao Supabase. Identificadores já existentes na rede são ignorados, sem unir pessoas pelo nome. Cadastros iniciais sem identificador devem ser conciliados antes de nova importação.

Os arquivos originais e os dados reais não são incluídos nas migrações, no repositório ou nos arquivos publicados. A demo mantém dados fictícios somente na memória da aba.

## Desenvolvimento e publicação

Requer Node.js 22 ou superior.

```sh
npm ci
npm test
npm start
```

A prévia é servida em `http://127.0.0.1:4173/`. `npm run build` prepara `dist/` com o piloto, a demo e os arquivos estáticos. O GitHub Actions executa testes e publica apenas essa pasta no GitHub Pages.

`assets/pilot-config.mjs` contém somente a URL e a chave **publishable**, próprias para cliente público. A chave não concede acesso aos cadastros sem sessão autorizada. Nunca inclua chave secret/service_role, credenciais, RB1, AFD original ou documentos da operação.

As migrações em `supabase/migrations/` criam a estrutura vazia e as permissões. A carga inicial e as liberações reais são mantidas exclusivamente no ambiente privado. O histórico remoto foi alinhado às versões locais após a aplicação e validação da estrutura inicial. O `config.toml` descreve desenvolvimento local e não deve ser enviado integralmente à produção sem revisar as diferenças.

Gravações passam por operações transacionais com verificação de permissão e revisão dos dados. Todas as tabelas expostas usam RLS; visitantes não podem consultar a base. Publicações preservam dados e regras da versão. A auditoria registra autor, ação e referência do registro, sem copiar cadastros completos para o log.

`npm test` cobre os importadores, a demo e o motor de planejamento. `supabase/tests/pilot_access.sql` verifica isolamento, perfis, gravação atômica, concorrência, publicações e carga compartilhada usando registros fictícios em transação com **rollback**. Execute somente como administrador em ambiente controlado. Faça backup e teste restauração antes de ampliar o uso operacional.

## Referências

- [Segurança da API do Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Configuração de envio de e-mail](https://supabase.com/docs/guides/auth/auth-smtp)
- [SDK do Inner REP Plus](https://integrador.topdata.com.br/suporte/download-sdk-innerrep/)
