# IzePromo

Bot próprio para enviar promoções (Amazon, Mercado Livre, Shopee, AliExpress) em **grupos de WhatsApp** e **canais do Telegram**, rodando no seu computador.

## Requisitos
- Node.js 20 ou superior (https://nodejs.org)
- Um **chip/número secundário** com WhatsApp (recomendado, para não arriscar seu número principal)
- Opcional, para o Telegram: um bot criado no [@BotFather](https://t.me/BotFather)

## Como usar
1. Abra o terminal na pasta do projeto e rode:
   ```
   npm install
   npm start
   ```
2. Na primeira vez aparece um **QR Code no terminal**. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.
3. Abra **http://localhost:3000**.
4. Em *Destinos*: clique em **Carregar**, escolha um grupo do WhatsApp e **Adicionar**. Pode adicionar vários grupos.
5. Em *Configurações*: informe sua tag da Amazon e salve.
6. Cole os links no painel, preencha título e preços e adicione à fila. O bot envia sozinho, com intervalo aleatório entre as ofertas, para **todos os destinos ativos**.

### Telegram
1. No Telegram, fale com o @BotFather, envie `/newbot` e copie o token.
2. Adicione o bot como **administrador** do seu canal (ou grupo).
3. No painel, cole o token em *Configurações*, salve e clique em **Testar Telegram**.
4. Em *Destinos*, adicione o canal (`@meucanal`) ou o id numérico do chat.

### Agendamento
No formulário de nova oferta, o campo **Agendar para** define data e hora (no horário do seu computador). A oferta só sai a partir desse horário, respeitando o intervalo entre envios. Sem agendamento, ela entra no fim da fila.

## Sobre os links de afiliado
- **Amazon:** a tag é aplicada automaticamente em links completos. Links curtos `amzn.to` são enviados como você colou.
- **Mercado Livre, Shopee e AliExpress:** gere o link no painel de afiliados de cada um e cole aqui já pronto.
- A antirrepetição reconhece o produto mesmo com links diferentes (inclusive links curtos, que são seguidos só para identificar o produto).

## Se algo falhar
- Uma oferta que falha é tentada até 3 vezes e depois vai para **Falhas**, sem travar o resto da fila. Use **Tentar de novo** depois de corrigir o problema.
- Se o envio funcionou em alguns destinos e falhou em outros, os destinos que já receberam **não recebem de novo**.
- Se o WhatsApp ou o Telegram estiver desconectado, o bot espera, sem gastar tentativas.

## Cuidados
- O WhatsApp usa uma biblioteca **não oficial** (Baileys). Isso vai contra os termos do WhatsApp e há risco de banimento do número. Mantenha intervalos de alguns minutos e evite volume excessivo. O Telegram usa a API oficial.
- O computador precisa ficar ligado e conectado à internet para o envio acontecer.
- A sessão do WhatsApp fica na pasta `auth/` e o token do Telegram no banco; não compartilhe nenhum dos dois. Se der problema de login no WhatsApp, apague `auth/` e leia o QR de novo.
- O painel só aceita conexões do próprio computador e recusa requisições vindas de outros sites.
- Informe nos posts que há links de afiliado, conforme as regras dos programas e a legislação de publicidade.

## Dados
Tudo fica em `data/izepromo.db` (SQLite): configurações, destinos, fila, falhas e histórico. Se você usava a versão anterior, o `data/db.json` é **importado automaticamente** na primeira execução e renomeado para `db.json.migrado`.

## Testes
```
npm test
```

## Estrutura
```
src/index.js             inicia tudo
src/db.js                banco SQLite e migração do db.json antigo
src/queue.js             fila, agendamento, tentativas e intervalo
src/format.js            lojas, tag Amazon, preços, chave anti-repetição e textos
src/links.js             segue links curtos para identificar o produto
src/channels/whatsapp.js conexão e envio (Baileys)
src/channels/telegram.js envio pela Bot API do Telegram
src/server.js            API do painel (somente localhost)
public/index.html        painel
test/                    testes automatizados
```
