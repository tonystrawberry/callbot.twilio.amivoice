# Call Center powered by Twilio, AmiVoice API (Speech-to-Text) and ChatGPT (3.5)

## Overview
This is a application that uses Twilio Programmable Voice, AmiVoice API (Speech-to-Text) and ChatGPT (3.5) to create a call center that can respond to customer inquiries.

## Technologies
- Node.js
- Websocket
- [Twilio Programmable Voice](https://www.twilio.com/voice) with Twilio SDK for Node.js
- [AmiVoice API](https://docs.amivoice.com/amivoice-api/manual/) with AmiVoice Websocket API
- [ChatGPT](https://platform.openai.com/docs/guides/gpt) with OpenAI API library for Node.js

## Prerequisites
You need to set the following information in `.env` to run this application:

```
AMIVOICE_API_KEY=[Obtainable from AmiVoice Cloud Platform]
OPENAI_API_KEY=[Obtainable from OpenAI API]
TWILIO_ACCOUNT_SID=[Obtainable from Twilio Console]
TWILIO_AUTH_TOKEN=[Obtainable from Twilio Console]
TWILIO_PHONE_NUMBER=[Obtainable from Twilio Console]
NGROK_DOMAIN=[Obtainable from ngrok]
```

Also, for running this application locally and make it accessible from the Internet, you need to install [ngrok](https://ngrok.com/) and run it with the following command. You will get a temporary domain name that can be accessed from the Internet.
You will need to set this domain name (with https protocol and `/twiml` path) in the Twilio Console as the webhook URL for your phone number (example: https://54de-126-36-198-149.ngrok-free.app/twiml)
You will need to set it inside `.env` as `NGROK_DOMAIN`.

```
ngrok http 3000
```

### Installation
```
npm install (only once)

ngrok http 3000
node ./server.js
```
