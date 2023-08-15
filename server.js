/* server.js */
/*
  This is the main server that will handle the incoming requests (POST /twiml) on customer call,
  Twilio media stream and the AmiVoice transcription (through a websocket client)
*/

"use strict";

/* Libraries */
require("dotenv").config();
const env = process.env;
const Http = require("http");
const HttpDispatcher = require("httpdispatcher");
const WebSocketServer = require("websocket").server;

/* Third party services (AmiVoice, Twilio, OpenAI) */
const { AmiVoice } = require("./amivoice");
const twilioClient = require("twilio")(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/* HTTP and Websocket server */
const dispatcher = new HttpDispatcher();
const httpServer = Http.createServer(handleRequest);
const HTTP_SERVER_PORT = 3000;

const TWILIO_VOICE = "Polly.Takumi-Neural";
const TWILIO_LANGUAGE = "ja-JP";

/* Utility log function */
/* Will log the current date and time, followed by the message and any additional arguments */
/* Example: log("Hello", "World") */
/* Output: 2021-08-01T00:00:00.000Z Hello World */
function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

function handleRequest(request, response){
  try {
    dispatcher.dispatch(request, response);
  } catch(err) {
    console.error(err);
  }
}

/* POST /twiml */
/* This endpoint is called when the call is first connected */
/* This endpoint needs to be set on Twilio as the Voice Request URL */
/* Reference: https://www.twilio.com/docs/voice/tutorials/how-to-respond-to-incoming-phone-calls/node */
dispatcher.onPost("/twiml", (_request, response) => {
  const twilioVoiceResponse = new VoiceResponse();

  /* Setup the media stream from Twilio to our own websocket */
  twilioVoiceResponse.start().stream({
    url: `wss://${env.NGROK_DOMAIN}`,
  });

  /* Say the first message to the caller */
  twilioVoiceResponse.say({
              voice: TWILIO_VOICE,
              language: TWILIO_LANGUAGE,
            },
            "こんにちは。匠です。何でも聞いてください。"
  )

  /* Do not hangup the call for 40 seconds */
  twilioVoiceResponse.pause({ length: 40 });

  response.writeHead(200, { "Content-Type": "text/xml" });

  /* Send the TwiML twilioVoiceResponse back to Twilio */
  /* Example:
  <?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Start>
      <Stream name="VoiceStream from Twilio" url="wss://54de-126-36-198-149.ngrok-free.app"/>
    </Start>
    <Say language="ja-JP" voice="Polly.Kazuha-Neural">こんにちは。かずはです。何でも聞いてください。</Say>
    <Pause length="40"/>
  </Response>
  */
  log(`Twilio WS: TwiML response sent back: ${twilioVoiceResponse.toString()}`)
  response.end(twilioVoiceResponse.toString());
});

/* VoiceStream class that will store the Websocket connection [Twilio] <-> [Websocket server] */
/* This class will handle the media stream from Twilio */
/* It will also handle the transcription from AmiVoice */
class VoiceStream {
  constructor(connection) {
    // processMessage is called when a message is received from Twilio
    connection.on("message", (message) => {
      this.processMessage(message);
    });

    // close is called when the connection is closed by Twilio
    connection.on("close", () => {
      log("Twilio WS: Connection closed by Twillio");
      this.close();
    });

    this.messageCount = 0;
    this.amiVoiceConnection = null;
    this.callSid = ""; // unique call identifier from Twilio
  }

  /* This function is called when a message is received from Twilio */
  /* The message will be a JSON object */
  /* Reference: https://www.twilio.com/docs/voice/tutorials/consume-real-time-media-stream-using-websockets-python-and-flask */
  processMessage(message) {
    if (message.type === "utf8") {
      const data = JSON.parse(message.utf8Data);
      switch (data.event) {
        case "connected":
          // This event is received when the connection is first established
          // Example: { event: "connected", protocol: "Call", version: "0.2.0" }
          log("Twilio WS: Connected event received: ", data);
          break;
        case "start":
          // This event is received when the stream is started
          // We will store the callSid and create an AmiVoice connection
          // Example: {
          //   event: "start",
          //   sequenceNumber: "1",
          //   start: {
          //     accountSid: "AC0d7016bb1842a6b3e80d1d6d56036784",
          //     streamSid: "MZ639f5aaf9b0c0fe84f01b5e8478c7d52",
          //     callSid: "CAea9962c5d642db0576ffd21fa1b9d6ad",
          //     tracks: [ "inbound" ],
          //     mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }
          //   },
          //   streamSid: "MZ639f5aaf9b0c0fe84f01b5e8478c7d52"
          // }}
          log("Twilio WS: Start event received: ", data);

          this.callSid = data.start.callSid;
          this.amiVoiceConnection = new AmiVoice(env.AMIVOICE_API_KEY);

          // When the AmiVoice connection receives a transcription, we will process it with ChatGPT and send it back to Twilio
          this.amiVoiceConnection.on("transcription", (transcriptionData) => {
            this.receivedTranscription(transcriptionData, this.callSid);
          });
          break;
        case "media":
          // This event is received continuously while the stream is active
          // It contains the audio data from Twilio that we will send to AmiVoice
          // Example: {
          //   event: 'media',
          //   sequenceNumber: '256',
          //   media: {
          //     track: 'inbound',
          //     chunk: '255',
          //     timestamp: '5180',
          //     payload: 'fv//fv///37///////////////////////////9+//9+////fv///37/////fv////////////////9+//////////9+////fn7/////////////////////fv////9+//9+/////////////////37//////////37//////////37//////////////////37/////////////fv9+/w=='
          //   },
          //   streamSid: 'MZ1476190b98d7e720c314ecc9cde50b73'
          // }
          this.amiVoiceConnection.send(data.media.payload);
          break;
        case "closed":
          // This event is received when the stream is closed
          // Example: { event: "close", streamSid: "MZ639f5aaf9b0c0fe84f01b5e8478c7d52" }
          log("Twilio WS: Close event received: ", data);
          this.close();
          break;
      }

      this.messageCount++;
    } else if (message.type === "binary") {
      log("Twilio WS: binary message received (not supported)");
    }
  }

  // This function is called when the connection is closed
  // We will close the AmiVoice connection as well
  close(){
    log("Twilio WS: Closed. Received a total of [" + this.messageCount + "] messages");
    this.amiVoiceConnection.close();
  }

  // This function is called when a transcription is received from AmiVoice
  // We will send the transcription to ChatGPT and send the response back to Twilio via API
  // We can identify the call using the callSid that we stored earlier and pass the ChatGPT response to Twilio
  // Reference: https://www.twilio.com/docs/voice/tutorials/how-to-modify-calls-in-progress/node
  async receivedTranscription(data, callSid) {
    log(`Twilio WS: Received message from AmiVoice: ${data.body.text}`);

    // Send a <Say> message to Twilio that will be read back to the caller
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [{role: "user", content: data.body.text}],
    });

    // Update the call with the <Say> message
    const chatGptMessage = completion.data.choices[0].message.content;
    const twiml = new VoiceResponse();
    twiml.say({
      voice: TWILIO_VOICE,
      language: TWILIO_LANGUAGE,
    }, chatGptMessage);
    twiml.pause({ length: 40 });

    twilioClient.calls(callSid)
      .update({twiml: twiml.toString()})
      .then(_call => log(`Twilio WS: ChatGPT response sent back with TwiML: ${chatGptMessage}`));
  }
}

/* Setup the websocket server */
const websocketServer = new WebSocketServer({
  httpServer: httpServer,
  autoAcceptConnections: true,
});

websocketServer.on("connect", (connection) => {
  log("Twilio WS: Connection accepted");
  new VoiceStream(connection);
});

/* Start the HTTP server on localhost with port HTTP_SERVER_PORT */
httpServer.listen(HTTP_SERVER_PORT, () => {
  log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`);
});
