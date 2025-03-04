import express from "express";
import bodyParser from "body-parser";
import open from "open";
import {
  customerInitiatedTransaction,
  CardData,
  DeviceDataCollection,
  OwnDeviceDataCollection,
  Payment,
  threeDsAuthentication,
  threeDsDeviceDataInit,
  threeDsVerification,
  ThreeDsAuthResultWithoutChallenge,
  createToken,
  TM_ORGANISATION_ID,
  TM_PROFILING_DOMAIN,
  fraudsightAssessment,
  FraudsightRiskResult,
  deleteToken,
} from "./worldpay";
import { readFile } from "node:fs/promises";

const PORT = 3000;

const transfers = new Map<
  string,
  {
    payment: Payment;
    ddc: DeviceDataCollection;
    auth?: ThreeDsAuthResultWithoutChallenge;
    threatMetrixSessionId: string;
    risk: FraudsightRiskResult;
  }
>();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", async (_req, res) => {
  const index = await readFile(__dirname + "/index.html").then((d) =>
    d.toString()
  );

  const html = index
    .replaceAll("{TM_PROFILING_DOMAIN}", TM_PROFILING_DOMAIN)
    .replaceAll("{TM_ORGANISATION_ID}", TM_ORGANISATION_ID)
    .replaceAll("{TM_SESSION_ID}", create_uuid());

  res.contentType("html").send(html);
});

app.get("/threatmetrix.js", (_, res) =>
  res.sendFile(__dirname + "/threatmetrix.js")
);

app.post("/", async (req, res) => {
  const reference = `TEST-${Math.random().toString(36).slice(2)}`;
  const tmSessionId = req.body.tmx_session_id;
  const card_number = req.body.card_number.replace(/\D/g, "");
  const [month, year] = req.body.card_expiry.split("/");
  const cvc = req.body.card_cvc;

  const card: CardData = {
    cardHolder: {
      name: req.body.card_holder_name,
      email: req.body.card_holder_email,
      billingAddress: {
        city: "London",
        address1: "221B Baker Street",
        postalCode: "NW1 6XE",
        countryCode: "GB",
        state: "LND",
      },
    },
    cardCvc: cvc,
    cardNumber: card_number,
    cardExpiryDate: {
      month: parseInt(month),
      year: 2000 + parseInt(year),
    },
  };

  const token = await createToken(card);

  const payment: Payment = {
    amount: 100,
    currency: "GBP",
    reference,
    token,
    cardCvc: cvc,
  };
  const [risk, ddc] = await Promise.all([
    fraudsightAssessment({
      payment,
      tmSessionId,
      browserIp: req.ip!,
      cardHolderEmail: card.cardHolder.email,
    }),
    threeDsDeviceDataInit(payment),
  ]);

  console.log("DDC", ddc);
  console.log("Risk", risk);

  transfers.set(reference, {
    payment,
    ddc,
    threatMetrixSessionId: tmSessionId,
    risk,
  });

  res.redirect("/ddc?reference=" + reference);
});

app.get("/ddc", async (req, res) => {
  const reference = req.query.reference as string;
  const transfer = transfers.get(reference);

  if (!transfer) {
    res.status(400).send("Invalid reference");
    return;
  }

  const template = await readFile(
    __dirname + "/device-data-collection.html"
  ).then((d) => d.toString());

  const url = new URL(`http://localhost:${PORT}/post-form`);
  url.searchParams.set(
    "p",
    JSON.stringify({ JWT: transfer.ddc.jwt, Bin: transfer.ddc.bin })
  );
  url.searchParams.set("url", transfer.ddc.url);

  const html = template
    .replaceAll("{URL}", url.toString())
    .replaceAll("{REFERENCE}", reference);
  res.contentType("text/html").send(html);
});

app.get("/post-form", (_req, res) => {
  res.sendFile(__dirname + "/post-form.html");
});

app.post("/auth", async (req, res) => {
  const reference = req.body.reference as string;
  const transfer = transfers.get(reference);
  if (!transfer) {
    res.status(400).send("Invalid reference");
    return;
  }

  const sessionId = req.body.sessionId;

  const browserData: OwnDeviceDataCollection = {
    acceptHeader: req.headers["accept"] as string,
    userAgentHeader: req.headers["user-agent"] as string,
    browserLanguage: req.body.browserLanguage,
    browserJavaEnabled: req.body.browserJavaEnabled === "true",
    browserColorDepth: req.body.browserColorDepth,
    browserScreenHeight: parseInt(req.body.browserScreenHeight),
    browserScreenWidth: parseInt(req.body.browserScreenWidth),
    timeZone: req.body.browserTZ,
    browserJavascriptEnabled: req.body.browserJavascriptEnabled === "true",
    ipAddress: req.ip,
  };

  const result = await threeDsAuthentication({
    challengeReturnUrl: "http://localhost:3000/auth-callback",
    payment: transfer.payment,
    collectionReference: sessionId,
    browserData,
  });
  console.log("3DS Auth result", result);

  if (result.outcome === "challenged") {
    const url = new URL(`http://localhost:${PORT}/post-form`);
    url.searchParams.set(
      "p",
      JSON.stringify({
        JWT: result.challenge.jwt,
        MD: `reference=${reference}`,
      })
    );
    url.searchParams.set("url", result.challenge.url);

    //TODO: open challenge in a separate window?
    res.contentType("html").send(`<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <h1>Challenge required, using iframe</h1>
    <iframe height= "400" width= "390" src="${url.toString()}">
    </iframe>
    <script>
      window.addEventListener("message", (ev) => {
        if (ev.origin === location.origin && ev.data === "3ds-challenge-complete") {
          window.location = "/auth-complete?reference=${reference}";
        }
      });
    </script>
  </body>
</html>
`);
    return;
  }

  transfer.auth = result;
  res.redirect("/auth-complete?reference=" + reference);
});

app.get("/auth-complete", async (req, res) => {
  const reference = req.query.reference as string;
  const transfer = transfers.get(reference);
  if (!transfer || !transfer.auth) {
    res.status(400).send("Invalid reference");
    return;
  }
  try {
    if (
      transfer.auth.outcome === "authenticated" ||
      transfer.auth.outcome === "bypassed"
    ) {
      const paymentResult = await customerInitiatedTransaction({
        payment: transfer.payment,
        threeDsAuthentication: transfer.auth.authentication,
        riskProfileHref: transfer.risk.riskProfile.href,
      });

      console.log("Payment result", paymentResult);

      res.send(
        `Payment complete
        <br>
        <code style="white-space:pre">${JSON.stringify(
          paymentResult,
          undefined,
          2
        )}</code>`
      );

      return;
    }

    res.send(
      `Auth failed<br><code style="white-space:pre">${JSON.stringify(
        transfer.auth,
        undefined,
        2
      )}</code>`
    );
  } finally {
    // for testing purposes, delete the token. Otherwise we can't reuse the same card number with different names
    await deleteToken(transfer.payment.token.href);
  }
});

app.post("/auth-callback", async (req, res) => {
  const transactionId = req.body.TransactionId;
  const params = new URLSearchParams(req.body.MD);
  const reference = params.get("reference");
  if (!reference) {
    res.status(400).send("Reference missing");
    return;
  }

  const transfer = transfers.get(reference);
  if (!transfer) {
    res.status(400).send("Invalid reference");
    return;
  }

  const result = await threeDsVerification({
    transactionReference: reference,
    challengeReference: transactionId,
  });
  console.log("3DS Callback result", result);

  transfer.auth = result;

  //send back an html that informs the parent window that the challenge is complete
  res.contentType("html").send(`
      <h1>Challenge complete</h1>
      <script>
        parent.postMessage("3ds-challenge-complete", location.origin);
      </script>`);
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  open(`http://localhost:${PORT}`);
});

function create_uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
