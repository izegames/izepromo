# Zap Promo

Bot próprio para enviar promoções (Amazon, Mercado Livre, Shopee, AliExpress) em um grupo de WhatsApp, rodando no seu computador.

## Requisitos
- Node.js 18 ou superior (https://nodejs.org)
- Um **chip/número secundário** com WhatsApp (recomendado, para não arriscar seu número principal)

## Como usar
1. Abra o terminal na pasta do projeto e rode:
   ```
   npm install
   npm start
   ```
2. Na primeira vez aparece um **QR Code no terminal**. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.
3. Abra **http://localhost:3000**.
4. Em *Configurações*: clique em **Carregar**, escolha o grupo, informe sua tag da Amazon e salve.
5. Cole os links no painel, preencha título e preços, e adicione à fila. O bot envia sozinho, com intervalo aleatório entre as mensagens.

## Sobre os links de afiliado
- **Amazon:** a tag é aplicada automaticamente.
- **Mercado Livre, Shopee e AliExpress:** gere o link no painel de afiliados de cada um e cole aqui já pronto.

## Cuidados
- Este sistema usa uma biblioteca **não oficial** (Baileys). Isso vai contra os termos do WhatsApp e há risco de banimento do número. Mantenha intervalos de alguns minutos e evite volume excessivo.
- O computador precisa ficar ligado e conectado à internet para o envio acontecer.
- Para sair e voltar depois, a sessão fica salva na pasta `auth/` (não compartilhe essa pasta). Se der problema de login, apague `auth/` e leia o QR de novo.
- A fila e o histórico ficam em `data/db.json`.
- Informe nos posts que há links de afiliado, conforme as regras dos programas e a legislação de publicidade.

## Estrutura
```
src/index.js     inicia tudo
src/whatsapp.js  conexão e envio (Baileys)
src/queue.js     fila, intervalo e anti-repetição
src/format.js    detecção de loja, tag Amazon e texto da mensagem
src/server.js    API do painel (somente localhost)
public/index.html  painel
```
