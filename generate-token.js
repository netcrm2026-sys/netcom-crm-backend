const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

const credentials = require("./client_secret.json");

const { client_secret, client_id, redirect_uris } =
  credentials.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const SCOPES = ["https://www.googleapis.com/auth/drive"];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
});

console.log("\nAuthorize this app by visiting this URL:\n");
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nEnter the code from that page here: ", async (code) => {
  rl.close();

  const { tokens } = await oAuth2Client.getToken(code);

  console.log("\nREFRESH TOKEN:\n");
  console.log(tokens.refresh_token);
});