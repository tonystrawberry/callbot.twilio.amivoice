/* amivoice-service.js */
/*
  This class will store the connection to the AmiVoice API.
  It will also handle the connection and disconnection of the service.
  It will also handle the sending of audio to the service and the sending of the transcription to the server via EventEmitter.
*/

const EventEmitter = require("events");
const WebSocketClient = require("websocket").client;

const AMIVOICE_WEBSOCKET_URL = "wss://acp-api.amivoice.com/v1/";

/* Utility log function */
/* Will log the current date and time, followed by the message and any additional arguments */
/* Example: log("Hello", "World") */
/* Output: 2021-08-01T00:00:00.000Z Hello World */
function log(message, ...args) {
  console.log(new Date(), message, ...args);
}
class AmiVoice extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.isReady = false;
    this.connect();
  }

  /* connect() will create a new connection to the AmiVoice API. */
  /* All the listeners are set up here. */
  /* Reference: https://docs.amivoice.com/amivoice-api/manual/user-guide/request/websocket-interface */
  connect() {
    if (!this.isReady) {
      const client = new WebSocketClient();

      client.on("connectFailed", (error) => {
        log("AmiVoice: " + error.toString());
        this.isReady = false;
      });

      client.on("connect", (connection) => {
        this.connection = connection;
        log("AmiVoice: websocket client connected");

        connection.on("message", (message) => {
          if (message.type === "utf8") {
            // code is the first character of the message and is used to determine what the message is
            // Reference: https://docs.amivoice.com/amivoice-api/manual/reference/websocket/packet/packet-state-transition
            // s: connection established
            // e: connection closed
            // S: detection of start of speech segment (ignored)
            // E: detection of end of speech segment (ignored)
            // C: start of recognition processing (ignored)
            // U: recognition processing in progress (ignored)
            // A: recognition processing completed and recognition result accepted
            // G: action information generated by the server (ignored)
            const code = message.utf8Data.charAt(0);

            switch(code) {
              case "s":
                log("AmiVoice: [s] Connection established");
                this.isStarted = true
                break;
              case "A":
                const data = JSON.parse(message.utf8Data.substring(2));
                log(`AmiVoice: [A] ${data.text}`);
                this.emit("transcription", { body: data });
                break;
              case "e":
                log("AmiVoice: [e] Connection closed");
                this.isStarted = false;
                this.isReady = false;
                break;
            }
          }
        });

        connection.on("error", error => {
          log("Connection Error: " + error.toString());
        });

        connection.on("close", () => {
          this.isStarted = false;
          log("AmiVoice: connection closed");
        });

        this.isReady = true;
        this.start();
      });

      client.connect(AMIVOICE_WEBSOCKET_URL);
    }
  }

  // start() will send the start command to the AmiVoice API
  // Reference: https://docs.amivoice.com/amivoice-api/manual/reference/websocket/packet/packet-state-transition
  // Reference: https://docs.amivoice.com/amivoice-api/manual/reference/websocket/command/s-command-packet
  start() {
    if (!this.isReady) {
      this.connect();
      return;
    }

    if (this.isReady && !this.isStarted) {
      // This format is defined in the AmiVoice API documentation
      // s <audio_format> <grammar_file_names> <authorization>
      let command = `s mulaw -a-general authorization=${this.apiKey}`;
      this.connection.send(command);
    }
  }

  // send() will send the audio to the AmiVoice API
  // The audio is sent as a base64 encoded string in the payload so it must be decoded first
  // Then the payload is converted to a Uint8Array and the first byte is set to 0x70
  // Then the Uint8Array is converted to a Buffer and sent to the AmiVoice API
  // Reference: https://docs.amivoice.com/amivoice-api/manual/reference/websocket/command/p-command-packet
  // Format: p<audio_data>
  // According to the documentation:
  //   `<audio_data>は、セッション開始時の s コマンドで指定した音声フォーマットの音声データです。
  //   この音声データの先頭に、0x70（ 'p' のアスキーコード）を付け、バイナリフレームで送信します。`
  send(payload) {
    if (this.isStarted) {
      const buff = Buffer.from(payload, "base64");

      const outData = new Uint8Array(buff.length + 1);
      outData[ 0 ] = 0x70; // "p"
      for (let i = 0; i < buff.length; i++) {
        outData[ 1 + i ] = buff[ i ];
      }

      this.connection.send(Buffer.from(outData));
    }
  }

  // close() will send the close command to the AmiVoice API
  // Reference: https://docs.amivoice.com/amivoice-api/manual/reference/websocket/command/e-command-packet
  // Format: e
  close() {
    if (this.isStarted && this.isReady) {
      log("AmiVoice: send close command");
      const endCommand = "e";
      this.connection.send(endCommand);
      this.isStarted = false;
    }
  }
}

module.exports = {
  AmiVoice,
};
