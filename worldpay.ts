const BASE_URI = "https://try.access.worldpay.com/";

// credentials can be found here, under API section
// https://sokinteam.atlassian.net/wiki/spaces/SOKIN/pages/2276655105/Worldpay+integration

const MERCHANT_CODE = "SOKINEU";
const USER = "";
const PASS = "";

// https://developer.worldpay.com/products/access/fraudsight/device-data/web#details-required
export const TM_ORGANISATION_ID = "afevfjm6";
export const TM_PROFILING_DOMAIN = "ddc-test.worldpay.com";

const authorizationHeader = `Basic ${Buffer.from(`${USER}:${PASS}`).toString(
  "base64"
)}`;

export async function createToken(
  card: CardData
): Promise<TokenPaymentInstrument> {
  // https://developer.worldpay.com/products/access/tokens/create-a-token
  const response = await fetch(`${BASE_URI}tokens`, {
    method: "POST",
    body: JSON.stringify({
      merchant: {
        entity: MERCHANT_CODE,
      },
      paymentInstrument: {
        type: "card/front",
        cardHolderName: card.cardHolder.name,
        cardNumber: card.cardNumber,
        cardExpiryDate: {
          month: card.cardExpiryDate.month,
          year: card.cardExpiryDate.year,
        },
        billingAddress: {
          city: card.cardHolder.billingAddress.city, // 50 chars, required
          address1: card.cardHolder.billingAddress.address1, // 80 chars, required
          postalCode: card.cardHolder.billingAddress.postalCode, // 15 chars, required
          countryCode: card.cardHolder.billingAddress.countryCode, // 2 chars, required
          state: card.cardHolder.billingAddress.state, // 30 chars optional - Should only be provided following the ISO-3611-2 two character subdivision
          address2: card.cardHolder.billingAddress.address2, // 80 chars optional
          address3: card.cardHolder.billingAddress.address3, // 80 chars optional
        },
      },
    }),
    headers: {
      Authorization: authorizationHeader,
      Accept: "application/vnd.worldpay.tokens-v3.hal+json",
      "Content-Type": "application/vnd.worldpay.tokens-v3.hal+json",
    },
  });

  if (!response.ok) {
    console.log(
      `Token creation error: ${response.status}\n${JSON.stringify(
        await response.json(),
        undefined,
        2
      )}`
    );
    throw new Error("Could not create token");
  }

  const json = await response.json();
  return json.tokenPaymentInstrument;
}

export async function deleteToken(tokenHref: string) {
  // https://developer.worldpay.com/products/access/tokens/delete-a-token
  const response = await fetch(tokenHref, {
    method: "DELETE",
    headers: {
      Authorization: authorizationHeader,
    },
  });

  if (!response.ok) {
    console.log(
      `Token deletion error: ${response.status}\n${await response.text()}`
    );
    throw new Error("Could not delete token");
  }
}

export async function threeDsDeviceDataInit({
  token,
  reference,
}: Payment): Promise<DeviceDataCollection> {
  // https://developer.worldpay.com/products/access/3ds/openapi/other/devicedatainitialize
  const response = await fetch(
    `${BASE_URI}verifications/customers/3ds/deviceDataInitialization`,
    {
      method: "POST",
      body: JSON.stringify({
        transactionReference: reference,
        merchant: {
          entity: MERCHANT_CODE,
        },
        paymentInstrument: {
          type: "card/tokenized",
          href: token.href,
        },
      }),
      headers: {
        Authorization: authorizationHeader,
        Accept: "application/vnd.worldpay.verifications.customers-v3.hal+json",
        "Content-Type":
          "application/vnd.worldpay.verifications.customers-v3.hal+json",
      },
    }
  );

  const json = await response.json();
  return json.deviceDataCollection;
}

export async function fraudsightAssessment({
  payment,
  tmSessionId,
  browserIp,
  cardHolderEmail,
}: {
  payment: Payment;
  tmSessionId: string;
  browserIp: string;
  cardHolderEmail: string;
}): Promise<FraudsightRiskResult> {
  // https://developer.worldpay.com/products/access/fraudsight/openapi/other/assessment
  const body = {
    transactionReference: payment.reference,
    merchant: {
      entity: MERCHANT_CODE,
    },
    instruction: {
      paymentInstrument: {
        type: "card/tokenized",
        href: payment.token.href,
      },
      value: {
        currency: payment.currency,
        amount: payment.amount,
      },
    },
    deviceData: {
      collectionReference: tmSessionId,
      ipAddress: browserIp,
    },
    riskData: {
      // all data optional, but the more the better
      account: {
        email: cardHolderEmail,
        //dateOfBirth: "1854-01-06",
        //shopperId: "id123",
      },
      // transaction: {
      //   firstName: "Sherlock",
      //   lastName: "Holmes",
      //   phoneNumber: "02031234321",
      // },
      // shipping: {
      //   firstName: "James",
      //   lastName: "Moriarty",
      //   address: {
      //     address1: "The Palatine Centre",
      //     address2: "Durham University",
      //     address3: "Stockton Road",
      //     postalCode: "DH1 3LE",
      //     city: "Durham",
      //     state: "County Durham",
      //     countryCode: "GB",
      //     phoneNumber: "01911234321",
      //   },
      // },
    },
  };

  const response = await fetch(`${BASE_URI}fraudsight/assessment`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      Authorization: authorizationHeader,
      Accept: "application/vnd.worldpay.fraudsight-v1.hal+json",
      "Content-Type": "application/vnd.worldpay.fraudsight-v1.hal+json",
    },
  });

  if (!response.ok) {
    console.log(
      `Fraudsight error: ${response.status}\n${await response.text()}`
    );
    throw new Error("Could not create fraudsight assessment");
  }

  const json = await response.json();
  return json;
}

export async function threeDsAuthentication({
  payment: { token, currency, amount, reference: transactionReference },
  browserData,
  collectionReference,
  challengeReturnUrl,
}: {
  challengeReturnUrl: string;
  payment: Payment;
  browserData: OwnDeviceDataCollection;
  collectionReference?: string;
}): Promise<ThreeDsAuthResult> {
  // https://developer.worldpay.com/products/access/3ds/openapi/other/authenticate
  const response = await fetch(
    `${BASE_URI}verifications/customers/3ds/authentication`,
    {
      method: "POST",
      body: JSON.stringify({
        transactionReference,
        merchant: {
          entity: MERCHANT_CODE,
          overrideName: "SubmerchName", //TODO: this is the submerchant name, max 25 chars
          //acquirerId: "01234567", //Instructs the issuer that the following authorization will be completed with an external acquirer
        },
        instruction: {
          paymentInstrument: {
            type: "card/tokenized",
            href: token.href,
          },
          value: {
            currency: currency,
            amount: amount,
          },
        },
        deviceData: {
          collectionReference,
          ...browserData,
        },
        challenge: {
          windowSize: "fullPage", // hint on the size of screen the challenge should be displayed in
          preference: "noPreference", // challenge preference - if we want to force a challenge
          returnUrl: challengeReturnUrl,
        },
        // riskData: {
        //   account: {
        //     previousSuspiciousActivity: false,
        //     type: "registeredUser",
        //     email: "sherlock.holmes@example.com",
        //     history: {
        //       createdAt: "2019-11-18",
        //       modifiedAt: "2019-11-18",
        //       passwordModifiedAt: "2019-10-15",
        //       paymentAccountEnrolledAt: "2019-11-18",
        //     },
        //   },
        //   transaction: {
        //     reorder: true,
        //     preOrderDate: "2019-11-18",
        //     firstName: "Sherlock",
        //     lastName: "Holmes",
        //     phoneNumber: "00000000000",
        //     history: {
        //       attemptsLastDay: 2,
        //       attemptsLastYear: 6,
        //       completedLastSixMonths: 6,
        //       addCardsLastDay: 5,
        //       shippingAddressFirstUsedAt: "2018-09-18",
        //     },
        //     giftCardsPurchase: {
        //       totalValue: {
        //         currency: "GBP",
        //         amount: 10,
        //       },
        //       quantity: 4,
        //     },
        //   },
        //   shipping: {
        //     nameMatchesAccountName: false,
        //     method: "verifiedAddress",
        //     timeFrame: "nextDay",
        //     email: "sherlock.holmes@example.com",
        //     address: {
        //       address1: "Disneyland",
        //       address2: "Disneyland Drive",
        //       address3: "Adventure Park",
        //       postalCode: "DL1 2CA",
        //       city: "Anaheim",
        //       stateCode: "CA",
        //       countryCode: "GB",
        //       phoneNumber: "01911234321",
        //     },
        //   },
        // },
      }),
      headers: {
        Authorization: authorizationHeader,
        Accept: "application/vnd.worldpay.verifications.customers-v3.hal+json",
        "Content-Type":
          "application/vnd.worldpay.verifications.customers-v3.hal+json",
      },
    }
  );

  const json = await response.json();
  return json;
}

export async function threeDsVerification(opts: {
  transactionReference: string;
  challengeReference: string;
}): Promise<ThreeDsAuthResultWithoutChallenge> {
  // https://developer.worldpay.com/products/access/3ds/openapi/other/verify
  const response = await fetch(
    `${BASE_URI}verifications/customers/3ds/verification`,
    {
      method: "POST",
      headers: {
        Authorization: authorizationHeader,
        Accept: "application/vnd.worldpay.verifications.customers-v3.hal+json",
        "Content-Type":
          "application/vnd.worldpay.verifications.customers-v3.hal+json",
      },
      body: JSON.stringify({
        transactionReference: opts.transactionReference,
        merchant: { entity: MERCHANT_CODE },
        challenge: { reference: opts.challengeReference },
      }),
    }
  );

  const json = await response.json();
  return json;
}

export async function customerInitiatedTransaction({
  payment: { reference, amount, token, cardCvc, currency },
  threeDsAuthentication,
  riskProfileHref,
}: {
  payment: Payment;
  threeDsAuthentication;
  riskProfileHref: string;
}) {
  // https://developer.worldpay.com/products/access/card-payments/openapi/other/authorize
  const body = {
    transactionReference: reference,
    merchant: {
      entity: MERCHANT_CODE,
      paymentFacilitator: {
        // TODO: do we have all these fields? capture them for each corporate setup
        // also, they are not really detailed in the API schema
        schemeId: "1000", // 1-11 digits
        independentSalesOrganizationId: "1", // 1-11 digits
        subMerchant: {
          name: "Mind Palace",
          reference: "1", // 1-15 digits
          address: {
            postalCode: "W1A 1AA",
            street: "W1A 1AA",
            city: "London",
            state: "LND", // 1-3 alphanumeric chars and space
            countryCode: "GB",
          },
          phoneNumber: "+40721234567",
          email: "random@test.org",
          taxReference: "1234567890",
        },
      },
    },
    instruction: {
      requestAutoSettlement: {
        enabled: true, // saves another call to settle the transaction
      },
      narrative: {
        line1: "Test payment",
      },
      value: {
        currency: currency,
        amount: amount,
      },
      paymentInstrument: {
        type: "card/token", //for some reason the type must be different here!
        href: token.href,
        cvc: cardCvc, // this is optional
      },
    },
    channel: "ecom",
    authentication: {
      threeDS: threeDsAuthentication,
    },
    riskProfile: riskProfileHref,
  };

  const response = await fetch(
    `${BASE_URI}cardPayments/customerInitiatedTransactions`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Authorization: authorizationHeader,
        Accept: "application/vnd.worldpay.payments-v7+json",
        "Content-Type": "application/vnd.worldpay.payments-v7+json",
      },
    }
  );

  const json = await response.json();

  return json;
}

export interface Payment {
  reference: string;
  token: TokenPaymentInstrument;
  amount: number;
  currency: string;
  cardCvc: string;
}

export interface CardData {
  cardHolder: {
    name: string;
    email: string;
    billingAddress: {
      city: string;
      state?: string;
      address1: string;
      address2?: string;
      address3?: string;
      postalCode: string;
      countryCode: string;
    };
  };
  cardCvc: string;
  cardNumber: string;
  cardExpiryDate: {
    month: number;
    year: number;
  };
}

export interface OwnDeviceDataCollection {
  acceptHeader: string;
  userAgentHeader: string;
  browserLanguage?: string;
  browserJavaEnabled?: boolean;
  browserColorDepth?: "1" | "4" | "8" | "15" | "16" | "24" | "32" | "48";
  browserScreenHeight?: number;
  browserScreenWidth?: number;
  timeZone?: string;
  browserJavascriptEnabled?: boolean;
  ipAddress?: string;
}

export interface DeviceDataCollection {
  bin: string;
  jwt: string;
  url: string;
}

export type ThreeDsAuthResultWithoutChallenge =
  | {
      outcome: "authenticated" | "bypassed";
      transactionReference: string;
      acsTransactionId: string;
      status: string;
      enrolled: string;
      authentication: {
        version: string;
        authenticationValue: string;
        eci: string;
        transactionId: string;
      };
    }
  | { outcome: "authenticationFailed" | "unavailable" };

export type ThreeDsAuthResult =
  | ThreeDsAuthResultWithoutChallenge
  | {
      outcome: "challenged";
      transactionReference: string;
      authentication: {
        version: string;
      };
      challenge: {
        reference: string;
        url: string;
        jwt: string;
        payload: string;
      };
    };

export type TokenPaymentInstrument = {
  type: string;
  href: string;
};

export type FraudsightRiskResult = {
  outcome: "lowRisk" | "highRisk" | "review";
  transactionReference: string;
  score: number;
  riskProfile: {
    href: string;
  };
};
