# Registro de Hora Extra

Projeto pessoal de MVP para controlar sua própria jornada de trabalho, com:

- login pessoal;
- registro de hora extra;
- opção de contabilizar como banco de horas ou pagamento no final do mês;
- controle de horários e almoço por dia da semana;
- feedback sobre a sua rotina e uso do sistema.

## Como executar

O cadastro e o login precisam do servidor Flask ativo. No terminal, execute:

```bash
cd /home/c1b3r/Área de trabalho/testes-com-ia/teste-resgistrodehoraextra
.venv/bin/python app.py
```

Depois acesse:

```text
http://localhost:8000
```

Não abra `index.html` diretamente nem use `python3 -m http.server`, pois esses servidores não possuem as rotas `/api`.

## Instalação limpa

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

## Produção

Defina uma chave secreta forte no ambiente e use HTTPS:

```bash
export FLASK_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export FLASK_HTTPS=1
.venv/bin/gunicorn --workers 2 --bind 127.0.0.1:8000 wsgi:app
```

No painel da hospedagem, salve essa mesma `FLASK_SECRET_KEY` como variável
permanente. Não gere uma chave nova a cada deploy: ela assina os cookies de
sessão e precisa ser igual em todos os workers.

### Banco persistente

Não use o SQLite dentro da pasta do código em produção: essa pasta pode ser apagada a cada deploy. Configure `DATABASE_PATH` para um disco persistente da hospedagem, por exemplo:

```bash
export DATABASE_PATH=/var/data/database.sqlite3
```

O app usa automaticamente `/var/data/database.sqlite3` quando esse diretório
persistente existe, mas configurar `DATABASE_PATH` explicitamente no painel é
recomendado.

No Render, adicione um **Persistent Disk** com o mount path `/var/data` e configure a variável `DATABASE_PATH` com `/var/data/database.sqlite3`. Sem Persistent Disk, os usuários serão apagados no próximo deploy. Em ambiente com múltiplas instâncias, use PostgreSQL em vez de SQLite.

Se `DATABASE_PATH` apontar para um diretório inexistente ou sem permissão, o app interrompe o deploy com uma mensagem clara. Isso evita que o site suba usando um banco temporário e perca usuários no próximo deploy.

### Opção gratuita sem Persistent Disk

Use um PostgreSQL externo gratuito, como Supabase ou Neon:

1. Crie um projeto gratuito no Supabase ou Neon.
2. Copie a **connection string** PostgreSQL.
3. No Render, abra **Environment** e crie `DATABASE_URL` com essa string.
4. Remova `DATABASE_PATH` do Render, pois ele não será usado com PostgreSQL.
5. Faça um novo deploy.

Quando `DATABASE_URL` estiver configurado, o app cria a tabela `users` no PostgreSQL e deixa de depender do disco do Render. Não publique a connection string no GitHub.

### Corrigir um site já publicado

Não apague o serviço atual. Faça nesta ordem:

1. Se os usuários atuais ainda aparecem, abra o **Shell** da hospedagem e faça uma cópia do banco atual antes do deploy.
2. Adicione o Persistent Disk com mount path `/var/data`.
3. Configure `DATABASE_PATH=/var/data/database.sqlite3`.
4. Mantenha a mesma `FLASK_SECRET_KEY` que já está configurada.
5. Faça um novo deploy.

O app copia automaticamente o `database.sqlite3` antigo para o caminho persistente quando o destino ainda não existe. Depois do primeiro deploy com o disco, o banco passa a sobreviver aos próximos deploys.

Antes de publicar, faça backup do arquivo do banco no volume persistente. O arquivo `.gitignore` já impede o envio acidental do banco, do ambiente virtual e de segredos.

## Privacidade

O app armazena nome, e-mail, senha protegida, salário, jornada, registros e feedback para oferecer o controle pessoal de horas extras. Os dados ficam associados à conta e podem ser removidos em **Configurações > Excluir minha conta**.

## Segurança implementada

- Senhas com hash seguro do Werkzeug.
- Migração automática de usuários antigos que usavam o hash legado.
- Sessão HTTP-only e proteção do estado por usuário autenticado.
- Sem senha ou salário persistidos no `localStorage`.
- Validação de e-mail, nome e senha mínima de 8 caracteres.
- Debug desligado por padrão.
- Endpoint de saúde em `/api/health`.

## Usuário demo

Não existe mais usuário demo. Crie uma conta pela tela de cadastro.

## Funcionalidades

- Dashboard com resumo de horas extras e saldo de banco.
- Registro de horas extras com data, tipo, início/fim e almoço.
- Ajuste do horário semanal por dia.
- Feedback com nota e categoria.
- Persistência no SQLite por conta autenticada.
